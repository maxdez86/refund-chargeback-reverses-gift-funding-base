import { randomUUID } from "node:crypto";
import {
  CreatePaymentResponseSchema,
  CreatePaymentRequestSchema,
  PaymentSummarySchema,
  type CreatePaymentRequest,
  type PaymentMethod,
  type PaymentSummary
} from "@brimax/contracts";
import { PAYMENT_GIFTS_BY_ID } from "@brimax/config";
import { AppError } from "../lib/errors";
import { hashValue, maskCpf, normalizeCpf, stableJsonHash } from "../lib/security";
import { AsaasClient } from "../services/asaas/client";
import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { initialPaymentStatus, resolveGiftSelection } from "./payment-state";

function buildDueDate() {
  return new Date().toISOString().slice(0, 10);
}

function toBrlDecimal(valueInCents: number) {
  return valueInCents / 100;
}

export class PaymentService {
  constructor(
    private readonly repository = new PaymentRepository(),
    private readonly asaasClient = new AsaasClient()
  ) {}

  async createPayment(request: CreatePaymentRequest, idempotencyKeyHeader?: string) {
    const parsed = CreatePaymentRequestSchema.parse(request);
    const gift = PAYMENT_GIFTS_BY_ID.get(parsed.giftId);

    if (!gift) {
      throw new AppError("Unknown gift id.", 400);
    }

    const giftSelection = resolveGiftSelection(gift, parsed.quantity);
    const normalizedCpf = normalizeCpf(parsed.payer.cpf);
    const idempotencyKey = idempotencyKeyHeader?.trim() || randomUUID();
    const fingerprint = stableJsonHash({
      giftId: parsed.giftId,
      paymentMethod: parsed.paymentMethod,
      quantity: giftSelection.quantity,
      payer: {
        cpf: normalizedCpf,
        email: parsed.payer.email.trim().toLowerCase(),
        name: parsed.payer.name.trim(),
        phone: parsed.payer.phone?.trim()
      }
    });

    const reservedPaymentId = randomUUID();
    const reservation = await this.repository.reserveCreatePayment(
      idempotencyKey,
      fingerprint,
      reservedPaymentId
    );

    if (!reservation.accepted && reservation.reservation) {
      const existing = await this.resolveExistingPayment(reservation.reservation.paymentId, parsed.paymentMethod);

      if (existing) {
        return CreatePaymentResponseSchema.parse({
          ok: true,
          payment: existing
        });
      }
    }

    const paymentId = reservation.reservation?.paymentId ?? reservedPaymentId;
    const customer = await this.findOrCreateCustomer(parsed, normalizedCpf, paymentId);
    const asaasPayment = await this.asaasClient.createPayment({
      customer: customer.id,
      billingType: parsed.paymentMethod,
      value: toBrlDecimal(giftSelection.amountCents),
      dueDate: buildDueDate(),
      description: gift.name,
      externalReference: paymentId
    });

    const now = new Date().toISOString();
    const payment: PaymentSummary = {
      paymentId,
      paymentMethod: parsed.paymentMethod,
      status: initialPaymentStatus(parsed.paymentMethod),
      amountCents: giftSelection.amountCents,
      currency: "BRL",
      gift: {
        id: gift.id,
        name: gift.name,
        fractional: gift.fractional,
        quantity: giftSelection.quantity,
        unitAmountCents: giftSelection.unitAmountCents,
        amountCents: giftSelection.amountCents
      },
      invoiceUrl: parsed.paymentMethod === "CREDIT_CARD" ? asaasPayment.invoiceUrl : undefined,
      createdAt: now,
      updatedAt: now
    };

    if (parsed.paymentMethod === "PIX") {
      const pixQrCode = await this.asaasClient.getPixQrCode(asaasPayment.id);
      payment.pix = {
        copyPaste: pixQrCode.payload,
        qrCodeBase64: pixQrCode.encodedImage,
        expiresAt: pixQrCode.expirationDate
      };
    }

    await this.repository.putPayment({
      ...payment,
      asaasPaymentId: asaasPayment.id,
      externalReference: paymentId,
      payerCpfHash: hashValue(normalizedCpf),
      payerCpfMasked: maskCpf(normalizedCpf),
      payerEmail: parsed.payer.email.trim().toLowerCase(),
      payerName: parsed.payer.name.trim()
    });

    await this.repository.completeCreatePayment(idempotencyKey);

    return CreatePaymentResponseSchema.parse({
      ok: true,
      payment
    });
  }

  async getPayment(paymentId: string) {
    const payment = await this.repository.getPayment(paymentId);

    if (!payment) {
      throw new AppError("Payment not found.", 404);
    }

    return PaymentSummarySchema.parse(payment);
  }

  private async resolveExistingPayment(paymentId: string, paymentMethod: PaymentMethod) {
    const existingPayment = await this.repository.getPayment(paymentId);

    if (existingPayment) {
      return PaymentSummarySchema.parse(existingPayment);
    }

    const existingAsaasPayments = await this.asaasClient.listPaymentsByExternalReference(paymentId);
    const existingAsaasPayment = existingAsaasPayments[0];

    if (!existingAsaasPayment) {
      return null;
    }

    const now = new Date().toISOString();
    const recoveredPayment: PaymentSummary = {
      paymentId,
      paymentMethod,
      status: initialPaymentStatus(paymentMethod),
      amountCents: Math.round(existingAsaasPayment.value * 100),
      currency: "BRL",
      gift: {
        id: "recovered",
        name: existingAsaasPayment.description ?? "Recovered payment",
        fractional: false,
        quantity: 1,
        unitAmountCents: null,
        amountCents: Math.round(existingAsaasPayment.value * 100)
      },
      invoiceUrl: existingAsaasPayment.invoiceUrl,
      createdAt: now,
      updatedAt: now
    };

    if (paymentMethod === "PIX") {
      const pixQrCode = await this.asaasClient.getPixQrCode(existingAsaasPayment.id);
      recoveredPayment.pix = {
        copyPaste: pixQrCode.payload,
        qrCodeBase64: pixQrCode.encodedImage,
        expiresAt: pixQrCode.expirationDate
      };
    }

    return recoveredPayment;
  }

  private async findOrCreateCustomer(
    request: CreatePaymentRequest,
    normalizedCpf: string,
    paymentId: string
  ) {
    const existing = await this.asaasClient.findCustomerByCpf(normalizedCpf);

    if (existing) {
      return existing;
    }

    return this.asaasClient.createCustomer({
      name: request.payer.name.trim(),
      email: request.payer.email.trim().toLowerCase(),
      cpfCnpj: normalizedCpf,
      mobilePhone: request.payer.phone?.trim(),
      externalReference: paymentId
    });
  }
}
