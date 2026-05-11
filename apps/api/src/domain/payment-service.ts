import { randomUUID } from "node:crypto";
import {
  CreatePaymentResponseSchema,
  CreatePaymentRequestSchema,
  PaymentSummarySchema,
  type CreatePaymentRequest,
  type PaymentSummary
} from "@brimax/contracts";
import { PAYMENT_GIFTS_BY_ID } from "@brimax/config";
import { AppError } from "../lib/errors";
import { hashValue, maskCpf, normalizeCpf, stableJsonHash } from "../lib/security";
import { AsaasClient } from "../services/asaas/client";
import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { initialPaymentStatus, resolveGiftSelection } from "./payment-state";

function toBrlDecimal(valueInCents: number) {
  return valueInCents / 100;
}

const DEFAULT_SITE_BASE_URL = "https://brimax.life";
const DEFAULT_CHECKOUT_EXPIRATION_MINUTES = 60;

function getSiteBaseUrl() {
  return process.env.PAYMENTS_SITE_BASE_URL?.trim() || DEFAULT_SITE_BASE_URL;
}

function getCheckoutExpirationMinutes() {
  const rawValue = process.env.PAYMENTS_CHECKOUT_EXPIRATION_MINUTES?.trim();
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : DEFAULT_CHECKOUT_EXPIRATION_MINUTES;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CHECKOUT_EXPIRATION_MINUTES;
  }

  return parsed;
}

function buildCheckoutCallbackUrls(paymentId: string) {
  const baseUrl = getSiteBaseUrl();

  return {
    successUrl: `${baseUrl}/?paymentId=${encodeURIComponent(paymentId)}&paymentStatus=success`,
    cancelUrl: `${baseUrl}/?paymentId=${encodeURIComponent(paymentId)}&paymentStatus=cancel`,
    expiredUrl: `${baseUrl}/?paymentId=${encodeURIComponent(paymentId)}&paymentStatus=expired`
  };
}

function buildCheckoutExpiresAt(minutesToExpire: number) {
  return new Date(Date.now() + minutesToExpire * 60_000).toISOString();
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
      const existing = await this.resolveExistingPayment(
        reservation.reservation.paymentId,
        reservation.reservation.paymentSnapshot
      );

      if (existing) {
        return CreatePaymentResponseSchema.parse({
          ok: true,
          payment: existing
        });
      }

      throw new AppError("Existing idempotent payment could not be recovered safely.", 409);
    }

    const paymentId = reservation.reservation?.paymentId ?? reservedPaymentId;
    const customer = await this.findOrCreateCustomer(parsed, normalizedCpf, paymentId);
    const checkoutExpirationMinutes = getCheckoutExpirationMinutes();
    const asaasCheckout = await this.asaasClient.createCheckout({
      customer: customer.id,
      billingTypes: [parsed.paymentMethod],
      callback: buildCheckoutCallbackUrls(paymentId),
      chargeTypes: ["DETACHED"],
      items: [
        {
          name: gift.name,
          description: `Brimax payment ${paymentId}`,
          quantity: giftSelection.quantity,
          value: toBrlDecimal(giftSelection.amountCents)
        }
      ],
      minutesToExpire: checkoutExpirationMinutes
    });
    const checkoutUrl = this.asaasClient.buildCheckoutUrl(asaasCheckout);
    const checkoutExpiresAt = buildCheckoutExpiresAt(checkoutExpirationMinutes);

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
      checkout: {
        sessionId: asaasCheckout.id,
        url: checkoutUrl,
        expiresAt: checkoutExpiresAt
      },
      createdAt: now,
      updatedAt: now
    };

    await this.repository.putPayment({
      ...payment,
      asaasCheckoutId: asaasCheckout.id,
      payerCpfHash: hashValue(normalizedCpf),
      payerCpfMasked: maskCpf(normalizedCpf),
      payerEmail: parsed.payer.email.trim().toLowerCase(),
      payerName: parsed.payer.name.trim()
    });

    await this.repository.completeCreatePayment(idempotencyKey, payment);

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

  private async resolveExistingPayment(paymentId: string, paymentSnapshot?: PaymentSummary) {
    const existingPayment = await this.repository.getPayment(paymentId);

    if (existingPayment) {
      return PaymentSummarySchema.parse(existingPayment);
    }

    if (paymentSnapshot) {
      return PaymentSummarySchema.parse(paymentSnapshot);
    }

    const existingAsaasPayments = await this.asaasClient.listPaymentsByExternalReference(paymentId);
    const existingAsaas = existingAsaasPayments[0];

    if (!existingAsaas) {
      return null;
    }

    const amountCents = Math.round(existingAsaas.value * 100);

    if (amountCents <= 0) {
      return null;
    }

    const now = new Date().toISOString();
    const recovered: PaymentSummary = {
      paymentId,
      paymentMethod: existingAsaas.billingType,
      status: initialPaymentStatus(existingAsaas.billingType),
      amountCents,
      currency: "BRL",
      gift: {
        id: "recovered",
        name: existingAsaas.description ?? "Recovered payment",
        fractional: false,
        quantity: 1,
        unitAmountCents: null,
        amountCents
      },
      checkout: existingAsaas.checkoutSession
        ? {
            sessionId: existingAsaas.checkoutSession,
            url: this.asaasClient.buildCheckoutUrl({ id: existingAsaas.checkoutSession })
          }
        : undefined,
      createdAt: now,
      updatedAt: now
    };

    return PaymentSummarySchema.parse(recovered);
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
