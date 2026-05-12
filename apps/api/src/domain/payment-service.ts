import { randomUUID } from "node:crypto";
import {
  CreatePaymentResponseSchema,
  CreatePaymentRequestSchema,
  PaymentPayerSchema,
  PaymentSummarySchema,
  type PaymentMethod,
  type PaymentSummary
} from "@brimax/contracts";
import { PAYMENT_GIFTS_BY_ID } from "@brimax/config";
import { AppError } from "../lib/errors";
import { stableJsonHash } from "../lib/security";
import { AsaasClient } from "../services/asaas/client";
import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { initialPaymentStatus, resolveGiftSelection, type ResolvedGiftSelection } from "./payment-state";
import type { CreateCheckoutInput } from "../services/asaas/client";

function toBrlDecimal(valueInCents: number) {
  return valueInCents / 100;
}

const DEFAULT_SITE_BASE_URL = "https://brimax.life";
const DEFAULT_CHECKOUT_EXPIRATION_MINUTES = 60;

const LegacyCreatePaymentRequestSchema = CreatePaymentRequestSchema.extend({
  payer: PaymentPayerSchema
}).omit({
  payerEmail: true
});

type NormalizedCreatePaymentRequest = {
  giftId: string;
  paymentMethod: PaymentMethod;
  payerEmail: string;
  quantity?: number;
};

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

  async createPayment(request: unknown, idempotencyKeyHeader?: string) {
    const parsed = this.normalizeCreatePaymentRequest(request);
    const gift = PAYMENT_GIFTS_BY_ID.get(parsed.giftId);

    if (!gift) {
      throw new AppError("Unknown gift id.", 400);
    }

    const giftSelection = resolveGiftSelection(gift, parsed.quantity);
    const idempotencyKey = idempotencyKeyHeader?.trim() || randomUUID();
    const fingerprint = stableJsonHash({
      giftId: parsed.giftId,
      paymentMethod: parsed.paymentMethod,
      quantity: giftSelection.quantity,
      payerEmail: parsed.payerEmail
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
    const checkoutExpirationMinutes = getCheckoutExpirationMinutes();
    const billingTypes: ("PIX" | "CREDIT_CARD")[] =
      parsed.paymentMethod === "HOSTED"
        ? ["PIX", "CREDIT_CARD"]
        : [parsed.paymentMethod];
    const asaasCheckout = await this.createHostedCheckout({
      billingTypes,
      checkoutExpirationMinutes,
      giftName: gift.name,
      giftSelection,
      payerEmail: parsed.payerEmail,
      paymentId
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
      payerEmail: parsed.payerEmail
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

  private normalizeCreatePaymentRequest(request: unknown): NormalizedCreatePaymentRequest {
    const parsed = CreatePaymentRequestSchema.safeParse(request);

    if (parsed.success) {
      return {
        ...parsed.data,
        payerEmail: parsed.data.payerEmail.trim().toLowerCase()
      };
    }

    const legacyParsed = LegacyCreatePaymentRequestSchema.parse(request);

    return {
      giftId: legacyParsed.giftId,
      paymentMethod: legacyParsed.paymentMethod,
      payerEmail: legacyParsed.payer.email.trim().toLowerCase(),
      quantity: legacyParsed.quantity
    };
  }

  private async createHostedCheckout(input: {
    billingTypes: ("PIX" | "CREDIT_CARD")[];
    checkoutExpirationMinutes: number;
    giftName: string;
    giftSelection: ResolvedGiftSelection;
    payerEmail: string;
    paymentId: string;
  }) {
    const checkoutInput: CreateCheckoutInput = {
      billingTypes: input.billingTypes,
      callback: buildCheckoutCallbackUrls(input.paymentId),
      chargeTypes: ["DETACHED"],
      customerData: {
        email: input.payerEmail
      },
      externalReference: input.paymentId,
      items: [
        {
          name: input.giftName,
          description: `Brimax payment ${input.paymentId}`,
          quantity: input.giftSelection.quantity,
          value: toBrlDecimal(input.giftSelection.amountCents)
        }
      ],
      minutesToExpire: input.checkoutExpirationMinutes
    };

    try {
      return await this.asaasClient.createCheckout(checkoutInput);
    } catch (error) {
      if (
        error instanceof AppError &&
        /customerdata|customer data|unknown field|campo/i.test(error.message)
      ) {
        return this.asaasClient.createCheckout({
          ...checkoutInput,
          customerData: undefined
        });
      }

      throw error;
    }
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
}
