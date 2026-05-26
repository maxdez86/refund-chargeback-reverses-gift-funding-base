import { randomUUID } from "node:crypto";
import {
  CreatePaymentResponseSchema,
  CreatePaymentRequestSchema,
  PaymentSummarySchema,
  type PaymentMethod,
  type PaymentSummary
} from "@brimax/contracts";
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

type NormalizedCreatePaymentRequest = {
  giftId: string;
  paymentMethod: PaymentMethod;
  quantity?: number;
};

type CreatePaymentTimingContext = {
  giftId?: string;
  idempotencyKeyPresent: boolean;
  paymentId?: string;
  paymentMethod?: string;
};

type CreatePaymentTimings = {
  asaasCheckoutMs?: number;
  idempotencyCompleteMs?: number;
  normalizeRequestMs?: number;
  persistPaymentMs?: number;
  reservePaymentMs?: number;
  totalDurationMs?: number;
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
  const id = encodeURIComponent(paymentId);

  return {
    successUrl: `${baseUrl}/#paymentId=${id}&paymentStatus=success`,
    cancelUrl: `${baseUrl}/#paymentId=${id}&paymentStatus=cancel`,
    expiredUrl: `${baseUrl}/#paymentId=${id}&paymentStatus=expired`
  };
}

function buildCheckoutExpiresAt(minutesToExpire: number) {
  return new Date(Date.now() + minutesToExpire * 60_000).toISOString();
}

function shouldEnableHostedInstallments(billingTypes: ("PIX" | "CREDIT_CARD")[]) {
  return billingTypes.includes("PIX") && billingTypes.includes("CREDIT_CARD");
}

export class PaymentService {
  constructor(
    private readonly repository = new PaymentRepository(),
    private readonly asaasClient = new AsaasClient()
  ) {}

  async createPayment(request: unknown, idempotencyKeyHeader?: string) {
    const requestContext = this.extractRequestContext(request, idempotencyKeyHeader);
    const timings: CreatePaymentTimings = {};
    const totalStartedAt = Date.now();
    let paymentId: string | undefined;

    try {
      const normalizeStartedAt = Date.now();
      const parsed = this.normalizeCreatePaymentRequest(request);
      timings.normalizeRequestMs = Date.now() - normalizeStartedAt;
      requestContext.giftId = parsed.giftId;
      requestContext.paymentMethod = parsed.paymentMethod;

      const gift = await this.repository.getGift(parsed.giftId);

      if (!gift) {
        throw new AppError("Unknown gift id.", 400);
      }

      const giftSelection = resolveGiftSelection(gift, parsed.quantity);
      const idempotencyKey = idempotencyKeyHeader?.trim() || randomUUID();
      const fingerprint = stableJsonHash({
        giftId: parsed.giftId,
        paymentMethod: parsed.paymentMethod,
        quantity: giftSelection.quantity
      });

      const reservedPaymentId = randomUUID();
      const reserveStartedAt = Date.now();
      const reservation = await this.repository.reserveCreatePayment(
        idempotencyKey,
        fingerprint,
        reservedPaymentId
      );
      timings.reservePaymentMs = Date.now() - reserveStartedAt;

      if (!reservation.accepted && reservation.reservation) {
        const existing = await this.resolveExistingPayment(
          reservation.reservation.paymentId,
          reservation.reservation.paymentSnapshot
        );

        if (existing) {
          paymentId = existing.paymentId;
          requestContext.paymentId = paymentId;
          timings.totalDurationMs = Date.now() - totalStartedAt;
          this.logCreatePaymentTiming("success", requestContext, timings);

          return CreatePaymentResponseSchema.parse({
            ok: true,
            payment: existing
          });
        }

        throw new AppError("Existing idempotent payment could not be recovered safely.", 409);
      }

      paymentId = reservation.reservation?.paymentId ?? reservedPaymentId;
      requestContext.paymentId = paymentId;
      const checkoutExpirationMinutes = getCheckoutExpirationMinutes();
      const billingTypes: ("PIX" | "CREDIT_CARD")[] =
        parsed.paymentMethod === "HOSTED"
          ? ["PIX", "CREDIT_CARD"]
          : [parsed.paymentMethod];
      const checkoutStartedAt = Date.now();
      const asaasCheckout = await this.createHostedCheckout({
        billingTypes,
        checkoutExpirationMinutes,
        giftName: gift.name,
        giftSelection,
        paymentId
      });
      timings.asaasCheckoutMs = Date.now() - checkoutStartedAt;
      const checkoutUrl = this.asaasClient.buildCheckoutUrl(asaasCheckout);
      const checkoutExpiresAt = buildCheckoutExpiresAt(checkoutExpirationMinutes);

      const now = new Date().toISOString();
      const payment: PaymentSummary = {
        paymentId,
        paymentMethod: parsed.paymentMethod,
        status: initialPaymentStatus(),
        amountCents: giftSelection.amountCents,
        currency: "BRL",
        gift: {
          id: gift.id,
          name: gift.name,
          image: gift.image,
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
        updatedAt: now,
        customerProfileStatus: "PENDING"
      };

      const persistStartedAt = Date.now();
      await this.repository.putPayment({
        ...payment,
        asaasCheckoutId: asaasCheckout.id
      });
      timings.persistPaymentMs = Date.now() - persistStartedAt;

      const idempotencyCompleteStartedAt = Date.now();
      await this.repository.completeCreatePayment(idempotencyKey, payment);
      timings.idempotencyCompleteMs = Date.now() - idempotencyCompleteStartedAt;

      timings.totalDurationMs = Date.now() - totalStartedAt;
      this.logCreatePaymentTiming("success", requestContext, timings);

      return CreatePaymentResponseSchema.parse({
        ok: true,
        payment
      });
    } catch (error) {
      requestContext.paymentId = requestContext.paymentId ?? paymentId;
      timings.totalDurationMs = Date.now() - totalStartedAt;
      this.logCreatePaymentTiming("failure", requestContext, timings, error);
      throw error;
    }
  }

  async getPayment(paymentId: string) {
    const payment = await this.repository.getPayment(paymentId);

    if (!payment) {
      throw new AppError("Payment not found.", 404);
    }

    return PaymentSummarySchema.parse(payment);
  }

  private normalizeCreatePaymentRequest(request: unknown): NormalizedCreatePaymentRequest {
    return CreatePaymentRequestSchema.parse(request);
  }

  private async createHostedCheckout(input: {
    billingTypes: ("PIX" | "CREDIT_CARD")[];
    checkoutExpirationMinutes: number;
    giftName: string;
    giftSelection: ResolvedGiftSelection;
    paymentId: string;
  }) {
    const checkoutInput: CreateCheckoutInput = {
      billingTypes: input.billingTypes,
      callback: buildCheckoutCallbackUrls(input.paymentId),
      chargeTypes: shouldEnableHostedInstallments(input.billingTypes)
        ? ["DETACHED", "INSTALLMENT"]
        : ["DETACHED"],
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

    if (shouldEnableHostedInstallments(input.billingTypes)) {
      checkoutInput.installment = {
        maxInstallmentCount: 10
      };
    }

    return this.asaasClient.createCheckout(checkoutInput);
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
      status: initialPaymentStatus(),
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

  private extractRequestContext(
    request: unknown,
    idempotencyKeyHeader?: string
  ): CreatePaymentTimingContext {
    const input =
      typeof request === "object" && request !== null ? (request as Record<string, unknown>) : undefined;

    return {
      giftId: typeof input?.giftId === "string" ? input.giftId : undefined,
      idempotencyKeyPresent: Boolean(idempotencyKeyHeader?.trim()),
      paymentMethod: typeof input?.paymentMethod === "string" ? input.paymentMethod : undefined
    };
  }

  private logCreatePaymentTiming(
    outcome: "success" | "failure",
    context: CreatePaymentTimingContext,
    timings: CreatePaymentTimings,
    error?: unknown
  ) {
    console.info(
      JSON.stringify({
        metric: "PAYMENT_CREATE_SERVICE_TIMING",
        outcome,
        paymentId: context.paymentId,
        idempotencyKeyPresent: context.idempotencyKeyPresent,
        giftId: context.giftId,
        paymentMethod: context.paymentMethod,
        durationMs: timings.totalDurationMs,
        normalizeRequestMs: timings.normalizeRequestMs,
        reservePaymentMs: timings.reservePaymentMs,
        asaasCheckoutMs: timings.asaasCheckoutMs,
        persistPaymentMs: timings.persistPaymentMs,
        idempotencyCompleteMs: timings.idempotencyCompleteMs,
        errorMessage: error instanceof Error ? error.message : undefined
      })
    );
  }
}
