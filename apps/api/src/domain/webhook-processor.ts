import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { mapAsaasWebhookToPaymentStatus, shouldApplyStatusTransition } from "./payment-state";
import { AppError } from "../lib/errors";
import { resolveSiteLabel, resolveSiteOrigin } from "../lib/env";
import { normalizeSettlementDate } from "./payment-settlement-date";
import { AsaasClient } from "../services/asaas/client";
import { EmailService } from "../services/email/client";
import { annotateTrace } from "../lib/xray";
import {
  escapeHtml,
  renderDetailLine,
  renderEmailCard,
  renderEmailDocument,
  renderEmailImage,
  renderEmailSection
} from "../services/email/html";

type AsaasWebhookPayload = {
  event?: string;
  checkout?: {
    id?: string;
    externalReference?: string;
    callback?: {
      successUrl?: string;
      cancelUrl?: string;
      expiredUrl?: string;
    };
  };
  payment?: {
    id?: string;
    customer?: string;
    checkoutSession?: string;
    status?: string;
    externalReference?: string;
    confirmedDate?: string | null;
    clientPaymentDate?: string | null;
    paymentDate?: string | null;
  };
  id?: string;
  status?: string;
  externalReference?: string;
};

type WebhookPaymentReference = {
  asaasPaymentId?: string;
  asaasCheckoutId?: string;
  externalReference?: string;
};

type WebhookPaymentResolutionSource =
  | "asaas_payment_id"
  | "asaas_checkout_id"
  | "external_reference"
  | "asaas_fallback_external_reference"
  | "asaas_fallback_checkout_session"
  | "unresolved";

type WebhookPaymentResolutionDiagnostics = {
  asaasFallbackAttempted: boolean;
  localLookupMatches: {
    asaasPaymentId: boolean;
    asaasCheckoutId: boolean;
    externalReference: boolean;
  };
  recoveredAsaasCheckoutId?: string;
  recoveredExternalReference?: string;
  resolutionSource: WebhookPaymentResolutionSource;
};

type WebhookPaymentResolution = {
  diagnostics: WebhookPaymentResolutionDiagnostics;
  payment: Awaited<ReturnType<PaymentRepository["getPayment"]>>;
};

type WebhookPaymentLookupResult = {
  matches: WebhookPaymentResolutionDiagnostics["localLookupMatches"];
  payment: Awaited<ReturnType<PaymentRepository["getPayment"]>>;
  source: WebhookPaymentResolutionSource;
};

function getFirstName(fullName: string | undefined) {
  if (!fullName) {
    return undefined;
  }

  const first = fullName.trim().split(/\s+/)[0];
  return first || undefined;
}

function toDisplayNameCase(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1))
    .join(" ");
}

function getSiteOrigin() {
  return resolveSiteOrigin();
}

function getGiftImageUrl(imageSlug: string | undefined) {
  if (!imageSlug) {
    return undefined;
  }

  return `${getSiteOrigin()}/media/presentes/${encodeURIComponent(imageSlug)}/480.jpeg`;
}

function parsePaymentIdFromCallbackUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const params = new URLSearchParams(hash);
    return params.get("paymentId") ?? undefined;
  } catch {
    return undefined;
  }
}

export class WebhookProcessor {
  constructor(
    private readonly repository = new PaymentRepository(),
    private readonly asaasClient = new AsaasClient(),
    private readonly emailService = new EmailService()
  ) {}

  async processEvent(eventId: string) {
    const storedEvent = await this.repository.getWebhookEvent(eventId);

    if (!storedEvent) {
      throw new AppError("Webhook event not found.", 404);
    }

    if (storedEvent.processedAt) {
      return { duplicate: true };
    }

    const payload = JSON.parse(storedEvent.payload) as AsaasWebhookPayload;
    const eventType = String(payload.event ?? storedEvent.eventType ?? "UNKNOWN").toUpperCase();
    const asaasPaymentId = payload.payment?.id ?? storedEvent.asaasPaymentId;
    const asaasCheckoutId = payload.payment?.checkoutSession ?? payload.checkout?.id ?? storedEvent.asaasCheckoutId;
    const externalReference =
      payload.payment?.externalReference ??
      payload.checkout?.externalReference ??
      parsePaymentIdFromCallbackUrl(payload.checkout?.callback?.successUrl) ??
      parsePaymentIdFromCallbackUrl(payload.checkout?.callback?.cancelUrl) ??
      parsePaymentIdFromCallbackUrl(payload.checkout?.callback?.expiredUrl) ??
      storedEvent.externalReference;
    const asaasCustomerIdFromPayload = payload.payment?.customer;

    if (eventType.startsWith("CHECKOUT_")) {
      const result = await this.processCheckoutEvent({
        asaasCheckoutId,
        eventId,
        eventType,
        externalReference
      });
      return result;
    }

    if (!asaasPaymentId && !asaasCheckoutId && !externalReference) {
      throw new AppError("Webhook payload does not contain a payment reference.", 400);
    }

    const resolution = await this.resolvePaymentForWebhook({
      asaasPaymentId,
      asaasCheckoutId,
      externalReference
    });
    const payment = resolution.payment;

    annotateResolutionTrace({
      ...resolution.diagnostics,
      asaasCheckoutId,
      asaasPaymentId,
      eventId,
      externalReference
    });

    if (!payment) {
      console.error(
        JSON.stringify({
          metric: "WEBHOOK_PAYMENT_NOT_FOUND",
          eventId,
          asaasPaymentId,
          asaasCheckoutId,
          externalReference,
          resolutionSource: resolution.diagnostics.resolutionSource,
          asaasFallbackAttempted: resolution.diagnostics.asaasFallbackAttempted,
          localLookupMatches: resolution.diagnostics.localLookupMatches,
          recoveredExternalReference: resolution.diagnostics.recoveredExternalReference,
          recoveredAsaasCheckoutId: resolution.diagnostics.recoveredAsaasCheckoutId
        })
      );
      throw new AppError("Payment not found for webhook event.", 404);
    }

    const nextStatus = mapAsaasWebhookToPaymentStatus(payload);
    if (!shouldApplyStatusTransition(payment.status, nextStatus)) {
      await this.repository.markWebhookProcessed(eventId, "ignored_stale");
      return { duplicate: false, updated: false };
    }

    const applied = await this.repository.applyWebhookUpdate({
      eventId,
      paymentId: payment.paymentId,
      expectedCurrentStatus: payment.status,
      nextStatus,
      confirmedOn: normalizeSettlementDate(payload.payment?.confirmedDate ?? undefined, "confirmedOn"),
      receivedOn: normalizeSettlementDate(
        payload.payment?.clientPaymentDate ?? payload.payment?.paymentDate ?? undefined,
        "receivedOn"
      ),
      asaasPaymentId: asaasPaymentId ?? payment.asaasPaymentId,
      asaasCheckoutId: asaasCheckoutId ?? payment.asaasCheckoutId
    });

    if (applied && (nextStatus === "CONFIRMED" || nextStatus === "RECEIVED")) {
      await this.enrichCustomerProfile({
        asaasCustomerIdFromPayload,
        asaasPaymentId: asaasPaymentId ?? payment.asaasPaymentId,
        paymentId: payment.paymentId
      });
    }

    return { duplicate: false, updated: applied };
  }

  private async processCheckoutEvent(input: {
    eventId: string;
    eventType: string;
    asaasCheckoutId?: string;
    externalReference?: string;
  }) {
    const paymentId = input.externalReference;
    if (!paymentId) {
      throw new AppError("Checkout webhook payload does not contain a payment reference.", 400);
    }

    const existingPayment = await this.repository.getPayment(paymentId);
    const reservation = await this.repository.getPaymentReservation(paymentId);

    if (input.eventType === "CHECKOUT_CANCELED" || input.eventType === "CHECKOUT_EXPIRED") {
      // No reservation means there is nothing to release — e.g. a sandbox
      // event from another environment. Throwing here would only poison the
      // queue into the DLQ, so acknowledge and move on.
      if (!reservation) {
        await this.repository.markWebhookProcessed(input.eventId, "ignored_stale");
        return { duplicate: false, updated: false };
      }

      if (existingPayment) {
        if (existingPayment.status !== "CREATED" && existingPayment.status !== "AWAITING_PAYMENT") {
          await this.repository.markWebhookProcessed(input.eventId, "ignored_stale");
          return { duplicate: false, updated: false };
        }

        const applied = await this.repository.applyWebhookUpdate({
          eventId: input.eventId,
          paymentId,
          expectedCurrentStatus: existingPayment.status,
          nextStatus: input.eventType === "CHECKOUT_CANCELED" ? "CANCELED" : "EXPIRED",
          asaasCheckoutId: input.asaasCheckoutId
        });

        if (!applied) {
          await this.repository.markWebhookProcessed(input.eventId, "ignored_stale");
          return { duplicate: false, updated: false };
        }

        return { duplicate: false, updated: true };
      }

      await this.repository.releaseReservationAfterCheckoutFailure(paymentId);
      await this.repository.markWebhookProcessed(input.eventId, "updated");
      return { duplicate: false, updated: true };
    }

    const shell = await this.repository.getPaymentShell(paymentId);

    // A created/paid checkout with no local state is a real inconsistency
    // (money may be involved) — keep throwing so SQS retries and the DLQ alerts.
    if (!shell || !reservation) {
      throw new AppError("Checkout webhook could not resolve shell or reservation state.", 404);
    }

    if (input.eventType === "CHECKOUT_CREATED" || input.eventType === "CHECKOUT_PAID") {
      if (!existingPayment) {
        if (
          input.eventType === "CHECKOUT_CREATED" &&
          (reservation.status === "RELEASED" || reservation.status === "CONSUMED")
        ) {
          await this.repository.markWebhookProcessed(input.eventId, "ignored_stale");
          return { duplicate: false, updated: false };
        }

        const repairedPayment = await this.buildPaymentFromShell(paymentId, shell, reservation, input.asaasCheckoutId);
        const checkoutId = input.asaasCheckoutId ?? repairedPayment.checkout?.sessionId;
        if (!checkoutId) {
          throw new AppError("Checkout recovery is missing the Asaas checkout id.", 400);
        }
        await this.repository.repairFinalizedPayment({
          payment: {
            ...repairedPayment,
            asaasCheckoutId: checkoutId
          },
          asaasCheckoutId: checkoutId,
          reservationStatus: reservation.status
        });
      }

      await this.repository.markWebhookProcessed(input.eventId, "updated");
      return { duplicate: false, updated: true };
    }

    await this.repository.markWebhookProcessed(input.eventId, "ignored_stale");
    return { duplicate: false, updated: false };
  }

  private async buildPaymentFromShell(
    paymentId: string,
    shell: Awaited<ReturnType<PaymentRepository["getPaymentShell"]>>,
    reservation: Awaited<ReturnType<PaymentRepository["getPaymentReservation"]>>,
    asaasCheckoutId?: string
  ) {
    if (!shell || !reservation) {
      throw new AppError("Payment shell is missing for checkout recovery.", 404);
    }

    const gift = await this.repository.getGift(shell.giftId);
    if (!gift) {
      throw new AppError("Gift metadata not found for checkout recovery.", 404);
    }

    const now = new Date().toISOString();
    const uniqueQuotaValues = new Set(shell.quotaValuesCents);

    return {
      paymentId,
      paymentMethod: shell.paymentMethod,
      status: "CREATED" as const,
      amountCents: shell.amountCents,
      currency: "BRL" as const,
      gift: {
        id: gift.id,
        name: gift.name,
        image: gift.image,
        fractional: gift.fractional,
        quantity: reservation.quantity,
        unitAmountCents: uniqueQuotaValues.size === 1 ? shell.quotaValuesCents[0] ?? null : null,
        amountCents: shell.amountCents,
        quotaValuesCents: uniqueQuotaValues.size === 1 ? undefined : shell.quotaValuesCents
      },
      checkout: asaasCheckoutId
        ? {
            sessionId: asaasCheckoutId,
            url: shell.checkoutUrl ?? this.asaasClient.buildCheckoutUrl({ id: asaasCheckoutId }),
            expiresAt: shell.checkoutExpiresAt
          }
        : undefined,
      createdAt: shell.createdAt ?? now,
      updatedAt: now,
      customerProfileStatus: "PENDING" as const
    };
  }

  private async resolvePaymentForWebhook(reference: WebhookPaymentReference): Promise<WebhookPaymentResolution> {
    const initialLookup = await this.lookupPayment(reference, "initial");

    if (initialLookup.payment) {
      return {
        payment: initialLookup.payment,
        diagnostics: {
          asaasFallbackAttempted: false,
          localLookupMatches: initialLookup.matches,
          resolutionSource: initialLookup.source
        }
      };
    }

    if (reference.externalReference) {
      const shell = await this.repository.getPaymentShell(reference.externalReference);
      const reservation = await this.repository.getPaymentReservation(reference.externalReference);

      if (shell && reservation && reference.asaasCheckoutId) {
        const repairedPayment = await this.buildPaymentFromShell(
          reference.externalReference,
          shell,
          reservation,
          reference.asaasCheckoutId
        );
        await this.repository.repairFinalizedPayment({
          payment: {
            ...repairedPayment,
            asaasCheckoutId: reference.asaasCheckoutId
          },
          asaasCheckoutId: reference.asaasCheckoutId,
          reservationStatus: reservation.status
        });

        return {
          payment: await this.repository.getPayment(reference.externalReference),
          diagnostics: {
            asaasFallbackAttempted: false,
            localLookupMatches: initialLookup.matches,
            resolutionSource: "external_reference"
          }
        };
      }
    }

    if (!reference.asaasPaymentId && !reference.asaasCheckoutId) {
      return {
        payment: null,
        diagnostics: {
          asaasFallbackAttempted: false,
          localLookupMatches: initialLookup.matches,
          resolutionSource: "unresolved"
        }
      };
    }

    const asaasPayment = reference.asaasPaymentId
      ? await this.asaasClient.getPaymentById(reference.asaasPaymentId)
      : null;
    let recoveredExternalReference = reference.externalReference ?? asaasPayment?.externalReference;
    const recoveredAsaasCheckoutId = reference.asaasCheckoutId ?? asaasPayment?.checkoutSession;

    let fallbackLookup = await this.lookupPayment(
      {
        asaasPaymentId: reference.asaasPaymentId,
        asaasCheckoutId: recoveredAsaasCheckoutId,
        externalReference: recoveredExternalReference
      },
      "fallback"
    );

    if (!fallbackLookup.payment && !recoveredExternalReference && recoveredAsaasCheckoutId) {
      // Payments spawned from a checkout session don't inherit its
      // externalReference, so both the webhook payload and GET /payments can
      // come back without our paymentId. The checkout session still carries it
      // (externalReference + callback URLs), so fetch it to recover the local key.
      const asaasCheckout = await this.asaasClient.getCheckoutById(recoveredAsaasCheckoutId);
      recoveredExternalReference =
        asaasCheckout.externalReference ??
        parsePaymentIdFromCallbackUrl(asaasCheckout.callback?.successUrl) ??
        parsePaymentIdFromCallbackUrl(asaasCheckout.callback?.cancelUrl) ??
        parsePaymentIdFromCallbackUrl(asaasCheckout.callback?.expiredUrl);

      if (recoveredExternalReference) {
        fallbackLookup = await this.lookupPayment(
          {
            asaasPaymentId: reference.asaasPaymentId,
            asaasCheckoutId: recoveredAsaasCheckoutId,
            externalReference: recoveredExternalReference
          },
          "fallback"
        );
      }
    }

    if (!fallbackLookup.payment && recoveredExternalReference && recoveredAsaasCheckoutId) {
      const shell = await this.repository.getPaymentShell(recoveredExternalReference);
      const reservation = await this.repository.getPaymentReservation(recoveredExternalReference);

      if (shell && reservation) {
        const repairedPayment = await this.buildPaymentFromShell(
          recoveredExternalReference,
          shell,
          reservation,
          recoveredAsaasCheckoutId
        );
        await this.repository.repairFinalizedPayment({
          payment: {
            ...repairedPayment,
            asaasCheckoutId: recoveredAsaasCheckoutId
          },
          asaasCheckoutId: recoveredAsaasCheckoutId,
          reservationStatus: reservation.status
        });

        return {
          payment: await this.repository.getPayment(recoveredExternalReference),
          diagnostics: {
            asaasFallbackAttempted: true,
            localLookupMatches: fallbackLookup.matches,
            recoveredAsaasCheckoutId,
            recoveredExternalReference,
            resolutionSource: "asaas_fallback_external_reference"
          }
        };
      }
    }

    return {
      payment: fallbackLookup.payment,
      diagnostics: {
        asaasFallbackAttempted: true,
        localLookupMatches: fallbackLookup.matches,
        recoveredAsaasCheckoutId,
        recoveredExternalReference,
        resolutionSource: fallbackLookup.source
      }
    };
  }

  private async lookupPayment(
    reference: WebhookPaymentReference,
    mode: "initial" | "fallback"
  ): Promise<WebhookPaymentLookupResult> {
    const paymentByAsaasPaymentId = reference.asaasPaymentId
      ? await this.repository.getPaymentByAsaasPaymentId(reference.asaasPaymentId)
      : null;
    if (paymentByAsaasPaymentId) {
      return {
        payment: paymentByAsaasPaymentId,
        matches: {
          asaasPaymentId: true,
          asaasCheckoutId: false,
          externalReference: false
        },
        source: "asaas_payment_id" as const
      };
    }

    const paymentByAsaasCheckoutId = reference.asaasCheckoutId
      ? await this.repository.getPaymentByAsaasCheckoutId(reference.asaasCheckoutId)
      : null;
    if (paymentByAsaasCheckoutId) {
      return {
        payment: paymentByAsaasCheckoutId,
        matches: {
          asaasPaymentId: false,
          asaasCheckoutId: true,
          externalReference: false
        },
        source: mode === "fallback" ? "asaas_fallback_checkout_session" : "asaas_checkout_id"
      };
    }

    const paymentByExternalReference = reference.externalReference
      ? await this.repository.getPayment(reference.externalReference)
      : null;
    if (paymentByExternalReference) {
      return {
        payment: paymentByExternalReference,
        matches: {
          asaasPaymentId: false,
          asaasCheckoutId: false,
          externalReference: true
        },
        source: mode === "fallback" ? "asaas_fallback_external_reference" : "external_reference"
      };
    }

    return {
      payment: null,
      matches: {
        asaasPaymentId: false,
        asaasCheckoutId: false,
        externalReference: false
      },
      source: "unresolved" as const
    };
  }

  private async enrichCustomerProfile(input: {
    asaasCustomerIdFromPayload?: string;
    asaasPaymentId?: string;
    paymentId: string;
  }) {
    const currentPayment = await this.repository.getPayment(input.paymentId);

    if (!currentPayment) {
      throw new AppError("Payment not found during customer enrichment.", 404);
    }

    if (
      currentPayment.customerProfileStatus === "READY" &&
      currentPayment.payerEmail &&
      currentPayment.payerFirstName
    ) {
      await this.sendPayerConfirmationEmailIfNeeded(currentPayment);
      return;
    }

    let asaasCustomerId = input.asaasCustomerIdFromPayload ?? currentPayment.asaasCustomerId;

    if (!asaasCustomerId && input.asaasPaymentId) {
      const asaasPayment = await this.asaasClient.getPaymentById(input.asaasPaymentId);
      asaasCustomerId = asaasPayment.customer;
    }

    if (!asaasCustomerId) {
      await this.repository.updatePaymentCustomerProfile({
        paymentId: input.paymentId,
        customerProfileStatus: "FAILED"
      });
      return;
    }

    const customer = await this.asaasClient.getCustomerById(asaasCustomerId);
    const payerName = toDisplayNameCase(customer.name);
    const payerEmail = customer.email?.trim().toLowerCase();
    const payerFirstName = toDisplayNameCase(getFirstName(payerName));

    await this.repository.updatePaymentCustomerProfile({
      paymentId: input.paymentId,
      asaasCustomerId,
      payerEmail,
      payerFirstName,
      payerName,
      customerProfileStatus: payerEmail && payerFirstName ? "READY" : "FAILED"
    });

    const enrichedPayment = await this.repository.getPayment(input.paymentId);
    if (enrichedPayment) {
      await this.sendPayerConfirmationEmailIfNeeded(enrichedPayment);
    }
  }

  private async sendPayerConfirmationEmailIfNeeded(payment: Awaited<ReturnType<PaymentRepository["getPayment"]>>) {
    if (!payment?.payerEmail || !payment.payerFirstName) {
      return;
    }

    const accepted = await this.repository.acquireNotificationSend({
      paymentId: payment.paymentId,
      type: "PAYER_CONFIRMATION",
      payload: {
        payerEmail: payment.payerEmail
      }
    });

    if (!accepted) {
      return;
    }

    const amount = (payment.amountCents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });

    try {
      const siteLabel = resolveSiteLabel();
      const giftImageSlug = payment.gift.image ?? (await this.repository.getGift(payment.gift.id))?.image;
      const giftImageUrl = getGiftImageUrl(giftImageSlug);

      await this.emailService.sendEmail({
        to: payment.payerEmail,
        subject: "Confirmacao do seu presente para Brida & Max",
        text:
          `Oi, ${payment.payerFirstName}!\n\n` +
          "Confirmamos o recebimento do seu presente para Brida & Max.\n\n" +
          `Presente: ${payment.gift.name}\n` +
          `Valor: ${amount}\n\n` +
          "Se precisar de ajuda, basta responder este e-mail.\n" +
          `${siteLabel}\n`,
        html: buildPayerConfirmationHtml({
          amount,
          giftName: payment.gift.name,
          giftImageUrl,
          payerFirstName: payment.payerFirstName,
          siteLabel
        })
      });
      await this.repository.markNotificationSent({
        paymentId: payment.paymentId,
        type: "PAYER_CONFIRMATION",
        payload: {
          payerEmail: payment.payerEmail
        }
      });
    } catch (error) {
      await this.repository.releaseNotificationSend(payment.paymentId, "PAYER_CONFIRMATION");
      throw error;
    }
  }
}

function annotateResolutionTrace(
  input: WebhookPaymentResolutionDiagnostics &
    WebhookPaymentReference & {
      eventId: string;
    }
) {
  annotateTrace({
    entity_id: input.eventId,
    webhook_asaas_fallback_attempted: input.asaasFallbackAttempted,
    webhook_has_asaas_checkout_id: Boolean(input.asaasCheckoutId),
    webhook_has_asaas_payment_id: Boolean(input.asaasPaymentId),
    webhook_has_external_reference: Boolean(input.externalReference),
    webhook_lookup_match_asaas_checkout_id: input.localLookupMatches.asaasCheckoutId,
    webhook_lookup_match_asaas_payment_id: input.localLookupMatches.asaasPaymentId,
    webhook_lookup_match_external_reference: input.localLookupMatches.externalReference,
    webhook_recovered_asaas_checkout_id: Boolean(input.recoveredAsaasCheckoutId),
    webhook_recovered_external_reference: Boolean(input.recoveredExternalReference),
    webhook_resolution_source: input.resolutionSource
  });
}

function buildPayerConfirmationHtml(input: {
  amount: string;
  giftName: string;
  giftImageUrl?: string;
  payerFirstName: string;
  siteLabel: string;
}) {
  return renderEmailDocument(
    renderEmailSection(
      '<p style="margin:0;color:#6b7280;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Brida &amp; Max</p>' +
        `<p style="margin:8px 0 0;font-size:14px;color:#6b7280;">${escapeHtml(input.siteLabel)}</p>`
    ) +
      renderEmailSection(
        `<p style="margin:0 0 12px;font-size:18px;color:#111827;">Oi, ${escapeHtml(input.payerFirstName)}!</p>` +
          '<p style="margin:0;font-size:16px;color:#1f2937;">Confirmamos o recebimento do seu presente para Brida &amp; Max.</p>'
      ) +
      (input.giftImageUrl
        ? renderEmailImage({
            alt: input.giftName,
            src: input.giftImageUrl
          })
        : "") +
      renderEmailCard(
        renderDetailLine("Presente", input.giftName) +
          renderDetailLine("Valor", input.amount) +
          '<p style="margin:16px 0 0;color:#4b5563;font-size:14px;">Se precisar de ajuda, basta responder este e-mail.</p>'
      ) +
      `<p style="margin:0;color:#6b7280;font-size:14px;">Enviado por ${escapeHtml(input.siteLabel)}.</p>`,
    {
      preheader: "Confirmamos o recebimento do seu presente para Brida & Max."
    }
  );
}
