import { randomUUID } from "node:crypto";
import {
  CreatePaymentResponseSchema,
  CreatePaymentRequestSchema,
  PaymentSummarySchema,
  type PaymentMethod,
  type PaymentSummary
} from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { resolveSiteBaseUrl } from "../lib/env";
import { stableJsonHash } from "../lib/security";
import { AsaasClient } from "../services/asaas/client";
import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { initialPaymentStatus, resolveGiftSelection, type ResolvedGiftSelection } from "./payment-state";
import type { CreateCheckoutInput } from "../services/asaas/client";

function toBrlDecimal(valueInCents: number) {
  return valueInCents / 100;
}

function groupQuotaValues(quotaValuesCents: number[]) {
  const groups: Array<{ quantity: number; valueCents: number }> = [];

  for (const valueCents of quotaValuesCents) {
    const last = groups[groups.length - 1];
    if (last && last.valueCents === valueCents) {
      last.quantity += 1;
      continue;
    }

    groups.push({ quantity: 1, valueCents });
  }

  return groups;
}

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
  return resolveSiteBaseUrl();
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
    let reservationReleased = false;
    let checkoutMayExist = false;

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
      const checkoutExpiresAt = buildCheckoutExpiresAt(checkoutExpirationMinutes);
      const reservedGiftSelection = await this.repository.reserveGiftSelection({
        gift,
        paymentId,
        quantity: giftSelection.quantity,
        expiresAt: checkoutExpiresAt
      });
      const now = new Date().toISOString();
      await this.repository.putPaymentShell({
        paymentId,
        giftId: gift.id,
        amountCents: reservedGiftSelection.amountCents,
        quotaValuesCents: reservedGiftSelection.quotaValuesCents,
        paymentMethod: parsed.paymentMethod,
        externalReference: paymentId,
        shellStatus: "CHECKOUT_CREATING",
        createdAt: now,
        updatedAt: now
      });
      const billingTypes: ("PIX" | "CREDIT_CARD")[] =
        parsed.paymentMethod === "HOSTED"
          ? ["PIX", "CREDIT_CARD"]
          : [parsed.paymentMethod];
      const checkoutStartedAt = Date.now();
      const asaasCheckout = await this.createHostedCheckout({
        billingTypes,
        checkoutExpirationMinutes,
        giftName: gift.name,
        giftSelection: reservedGiftSelection,
        paymentId
      });
      timings.asaasCheckoutMs = Date.now() - checkoutStartedAt;
      checkoutMayExist = true;
      const checkoutUrl = this.asaasClient.buildCheckoutUrl(asaasCheckout);
      const payment: PaymentSummary = {
        paymentId,
        paymentMethod: parsed.paymentMethod,
        status: initialPaymentStatus(),
        amountCents: reservedGiftSelection.amountCents,
        currency: "BRL",
        gift: {
          id: gift.id,
          name: gift.name,
          image: gift.image,
          fractional: gift.fractional,
          quantity: reservedGiftSelection.quantity,
          unitAmountCents: reservedGiftSelection.unitAmountCents,
          amountCents: reservedGiftSelection.amountCents,
          quotaValuesCents:
            reservedGiftSelection.unitAmountCents === null
              ? reservedGiftSelection.quotaValuesCents
              : undefined
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

      try {
        const persistStartedAt = Date.now();
        await this.repository.finalizeCreatePayment({
          idempotencyKey,
          payment: {
            ...payment,
            asaasCheckoutId: asaasCheckout.id
          },
          asaasCheckoutId: asaasCheckout.id
        });
        timings.persistPaymentMs = Date.now() - persistStartedAt;
        timings.idempotencyCompleteMs = timings.persistPaymentMs;
      } catch (finalizeError) {
        await this.repository.markCheckoutAmbiguous({
          paymentId,
          asaasCheckoutId: asaasCheckout.id
        });
        reservationReleased = true;
        throw finalizeError;
      }

      timings.totalDurationMs = Date.now() - totalStartedAt;
      this.logCreatePaymentTiming("success", requestContext, timings);

      return CreatePaymentResponseSchema.parse({
        ok: true,
        payment
      });
    } catch (error) {
      if (paymentId && !reservationReleased && !checkoutMayExist) {
        await this.repository.releaseReservationAfterCheckoutFailure(paymentId).catch(() => undefined);
      }
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
      items: groupQuotaValues(input.giftSelection.quotaValuesCents ?? [input.giftSelection.amountCents]).map((group) => ({
        name: input.giftName,
        description: `Brimax payment ${input.paymentId}`,
        quantity: group.quantity,
        value: toBrlDecimal(group.valueCents)
      })),
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
    const shell = await this.repository.getPaymentShell(paymentId);
    const reservation = await this.repository.getPaymentReservation(paymentId);

    if (shell || reservation) {
      return null;
    }

    return null;
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
