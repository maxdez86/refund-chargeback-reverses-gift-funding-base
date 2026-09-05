import { describe, expect, it, vi } from "vitest";
const { annotateTrace } = vi.hoisted(() => ({
  annotateTrace: vi.fn()
}));

type XrayModule = typeof import("../src/lib/xray");

vi.mock("../src/lib/xray", async (importOriginal) => ({
  ...(await importOriginal<XrayModule>()),
  annotateTrace
}));

import { WebhookProcessor } from "../src/domain/webhook-processor";

process.env.CONTACT_EMAIL = "casamento@brimax.life";
process.env.WEDDING_TABLE_NAME = "test-wedding-table";

describe("WebhookProcessor", () => {
  it("normalizes settlement dates and enriches the payer profile after confirmation", async () => {
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_RECEIVED",
          payment: {
            id: "pay_asaas_1",
            customer: "cus_1",
            checkoutSession: "checkout_1",
            externalReference: "payment-1",
            status: "RECEIVED",
            confirmedDate: "2026-05-10",
            clientPaymentDate: "2026-05-10"
          }
        }),
        asaasPaymentId: "pay_asaas_1",
        asaasCheckoutId: "checkout_1",
        externalReference: "payment-1"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue({
        paymentId: "payment-1",
        status: "AWAITING_PAYMENT",
        asaasPaymentId: "pay_asaas_1",
        asaasCheckoutId: "checkout_1",
        gift: { id: "g-batedeira", name: "Batedeira", quantity: 1 }
      }),
      getPaymentByAsaasCheckoutId: vi.fn(),
      getGift: vi.fn().mockResolvedValue({
        id: "g-batedeira",
        image: "batedeira"
      }),
      getPayment: vi
        .fn()
        .mockResolvedValueOnce({
          paymentId: "payment-1",
          status: "RECEIVED",
          amountCents: 500,
          payerEmail: undefined,
          payerFirstName: undefined,
          customerProfileStatus: "PENDING",
          gift: { id: "g-batedeira", name: "Batedeira", quantity: 1 }
        })
        .mockResolvedValueOnce({
          paymentId: "payment-1",
          status: "RECEIVED",
          amountCents: 500,
          payerEmail: "maria@example.com",
          payerFirstName: "Maria",
          payerName: "Maria Clara",
          customerProfileStatus: "READY",
          gift: { id: "g-batedeira", name: "Batedeira", quantity: 1 }
      }),
      applyWebhookUpdate: vi.fn().mockResolvedValue(true),
      incrementGiftFunding: vi.fn().mockResolvedValue(undefined),
      updatePaymentCustomerProfile: vi.fn().mockResolvedValue(undefined),
      acquireNotificationSend: vi.fn().mockResolvedValue(true),
      markNotificationSent: vi.fn().mockResolvedValue(undefined),
      releaseNotificationSend: vi.fn().mockResolvedValue(undefined),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const asaasClient = {
      getCustomerById: vi.fn().mockResolvedValue({
        id: "cus_1",
        name: "MARIA CLARA",
        email: "Maria@example.com"
      })
    };
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-1" })
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, emailService as never);
    const result = await processor.processEvent("event-1");

    expect(result).toEqual({ duplicate: false, updated: true });
    expect(repository.applyWebhookUpdate).toHaveBeenCalledWith({
      eventId: "event-1",
      paymentId: "payment-1",
      expectedCurrentStatus: "AWAITING_PAYMENT",
      nextStatus: "RECEIVED",
      confirmedOn: "2026-05-10",
      receivedOn: "2026-05-10",
      asaasPaymentId: "pay_asaas_1",
      asaasCheckoutId: "checkout_1"
    });
    expect(asaasClient.getCustomerById).toHaveBeenCalledWith("cus_1");
    expect(repository.updatePaymentCustomerProfile).toHaveBeenCalledWith({
      paymentId: "payment-1",
      asaasCustomerId: "cus_1",
      payerEmail: "maria@example.com",
      payerFirstName: "Maria",
      payerName: "Maria Clara",
      customerProfileStatus: "READY"
    });
    expect(repository.acquireNotificationSend).toHaveBeenCalledWith({
      paymentId: "payment-1",
      type: "PAYER_CONFIRMATION",
      payload: {
        payerEmail: "maria@example.com"
      }
    });
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "maria@example.com",
        subject: "Confirmacao do seu presente para Brida & Max"
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "casamento@brimax.life",
        subject: "Novo presente recebido no site do casamento 🤍",
        text: expect.stringContaining("Pagamento: payment-1"),
        html: expect.stringContaining("Enviado automaticamente por brimax.life.")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "casamento@brimax.life",
        text: expect.stringContaining("Enviado por: Maria Clara")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("Confirmamos o recebimento do seu presente para Brida &amp; Max.")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("https://brimax.life/media/presentes/batedeira/480.jpeg")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Se precisar de ajuda, basta responder este e-mail.")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining("Pagamento: payment-1")
      })
    );
    expect(repository.markNotificationSent).toHaveBeenCalledWith({
      paymentId: "payment-1",
      type: "PAYER_CONFIRMATION",
      payload: {
        payerEmail: "maria@example.com"
      }
    });
    expect(repository.markWebhookProcessed).not.toHaveBeenCalled();
  });

  it("falls back to payment lookup when the webhook payload does not include customer id", async () => {
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_CONFIRMED",
          payment: {
            id: "pay_asaas_2",
            checkoutSession: "checkout_2",
            externalReference: "payment-2",
            status: "CONFIRMED",
            confirmedDate: "2026-05-11"
          }
        }),
        asaasPaymentId: "pay_asaas_2",
        asaasCheckoutId: "checkout_2",
        externalReference: "payment-2"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue({
        paymentId: "payment-2",
        status: "PROCESSING",
        asaasPaymentId: "pay_asaas_2",
        asaasCheckoutId: "checkout_2",
        gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
      }),
      getPaymentByAsaasCheckoutId: vi.fn(),
      getGift: vi.fn().mockResolvedValue({
        id: "g-test-pix",
        image: "pix-teste"
      }),
      getPayment: vi
        .fn()
        .mockResolvedValueOnce({
          paymentId: "payment-2",
          status: "CONFIRMED",
          amountCents: 500,
          customerProfileStatus: "PENDING",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        })
        .mockResolvedValueOnce({
          paymentId: "payment-2",
          status: "CONFIRMED",
          amountCents: 500,
          payerEmail: "joao@example.com",
          payerFirstName: "João",
          customerProfileStatus: "READY",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
      }),
      applyWebhookUpdate: vi.fn().mockResolvedValue(true),
      incrementGiftFunding: vi.fn().mockResolvedValue(undefined),
      updatePaymentCustomerProfile: vi.fn().mockResolvedValue(undefined),
      acquireNotificationSend: vi.fn().mockResolvedValue(true),
      markNotificationSent: vi.fn().mockResolvedValue(undefined),
      releaseNotificationSend: vi.fn().mockResolvedValue(undefined),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const asaasClient = {
      getPaymentById: vi.fn().mockResolvedValue({
        id: "pay_asaas_2",
        customer: "cus_2"
      }),
      getCustomerById: vi.fn().mockResolvedValue({
        id: "cus_2",
        name: "João Pedro",
        email: "joao@example.com"
      })
    };
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-2" })
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, emailService as never);
    const result = await processor.processEvent("event-2");

    expect(result).toEqual({ duplicate: false, updated: true });
    expect(asaasClient.getPaymentById).toHaveBeenCalledWith("pay_asaas_2");
    expect(asaasClient.getCustomerById).toHaveBeenCalledWith("cus_2");
  });

  it("recovers the local payment via Asaas external reference when the webhook only has an Asaas payment id", async () => {
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_CONFIRMED",
          payment: {
            id: "pay_asaas_external_only",
            status: "CONFIRMED",
            confirmedDate: "2026-05-12"
          }
        }),
        asaasPaymentId: "pay_asaas_external_only"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
      getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue(null),
      getGift: vi.fn().mockResolvedValue({
        id: "g-test-pix",
        image: "pix-teste"
      }),
      getPayment: vi
        .fn()
        .mockResolvedValueOnce({
          paymentId: "payment-123",
          status: "PROCESSING",
          asaasPaymentId: "pay_asaas_external_only",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        })
        .mockResolvedValueOnce({
          paymentId: "payment-123",
          status: "CONFIRMED",
          amountCents: 500,
          customerProfileStatus: "PENDING",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        })
        .mockResolvedValueOnce({
          paymentId: "payment-123",
          status: "CONFIRMED",
          amountCents: 500,
          payerEmail: "buyer@example.com",
          payerFirstName: "Buyer",
          customerProfileStatus: "READY",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        }),
      applyWebhookUpdate: vi.fn().mockResolvedValue(true),
      incrementGiftFunding: vi.fn().mockResolvedValue(undefined),
      updatePaymentCustomerProfile: vi.fn().mockResolvedValue(undefined),
      acquireNotificationSend: vi.fn().mockResolvedValue(true),
      markNotificationSent: vi.fn().mockResolvedValue(undefined),
      releaseNotificationSend: vi.fn().mockResolvedValue(undefined),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const asaasClient = {
      getPaymentById: vi.fn().mockResolvedValue({
        id: "pay_asaas_external_only",
        customer: "cus_external",
        externalReference: "payment-123"
      }),
      getCustomerById: vi.fn().mockResolvedValue({
        id: "cus_external",
        name: "Buyer Person",
        email: "buyer@example.com"
      })
    };
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-ext" })
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, emailService as never);
    const result = await processor.processEvent("event-external");

    expect(result).toEqual({ duplicate: false, updated: true });
    expect(asaasClient.getPaymentById).toHaveBeenCalledWith("pay_asaas_external_only");
    expect(repository.getPayment).toHaveBeenCalledWith("payment-123");
    expect(annotateTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook_asaas_fallback_attempted: true,
        webhook_resolution_source: "asaas_fallback_external_reference"
      })
    );
    expect(repository.applyWebhookUpdate).toHaveBeenCalledWith({
      eventId: "event-external",
      paymentId: "payment-123",
      expectedCurrentStatus: "PROCESSING",
      nextStatus: "CONFIRMED",
      confirmedOn: "2026-05-12",
      receivedOn: undefined,
      asaasPaymentId: "pay_asaas_external_only",
      asaasCheckoutId: undefined
    });
  });

  it("recovers the local payment via Asaas checkout session when external reference is absent", async () => {
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_CONFIRMED",
          payment: {
            id: "pay_asaas_checkout_only",
            status: "CONFIRMED"
          }
        }),
        asaasPaymentId: "pay_asaas_checkout_only"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
      getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue({
        paymentId: "payment-checkout",
        status: "PROCESSING",
        asaasCheckoutId: "checkout-recovered",
        gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
      }),
      getGift: vi.fn().mockResolvedValue({
        id: "g-test-pix",
        image: "pix-teste"
      }),
      getPayment: vi
        .fn()
        .mockResolvedValueOnce({
          paymentId: "payment-checkout",
          status: "CONFIRMED",
          amountCents: 500,
          customerProfileStatus: "PENDING",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        })
        .mockResolvedValueOnce({
          paymentId: "payment-checkout",
          status: "CONFIRMED",
          amountCents: 500,
          payerEmail: "checkout@example.com",
          payerFirstName: "Checkout",
          customerProfileStatus: "READY",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        }),
      applyWebhookUpdate: vi.fn().mockResolvedValue(true),
      incrementGiftFunding: vi.fn().mockResolvedValue(undefined),
      updatePaymentCustomerProfile: vi.fn().mockResolvedValue(undefined),
      acquireNotificationSend: vi.fn().mockResolvedValue(true),
      markNotificationSent: vi.fn().mockResolvedValue(undefined),
      releaseNotificationSend: vi.fn().mockResolvedValue(undefined),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const asaasClient = {
      getPaymentById: vi.fn().mockResolvedValue({
        id: "pay_asaas_checkout_only",
        customer: "cus_checkout",
        checkoutSession: "checkout-recovered"
      }),
      getCustomerById: vi.fn().mockResolvedValue({
        id: "cus_checkout",
        name: "Checkout Person",
        email: "checkout@example.com"
      })
    };
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-checkout" })
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, emailService as never);
    const result = await processor.processEvent("event-checkout");

    expect(result).toEqual({ duplicate: false, updated: true });
    expect(asaasClient.getPaymentById).toHaveBeenCalledWith("pay_asaas_checkout_only");
    expect(repository.getPaymentByAsaasCheckoutId).toHaveBeenCalledWith("checkout-recovered");
    expect(repository.applyWebhookUpdate).toHaveBeenCalledWith({
      eventId: "event-checkout",
      paymentId: "payment-checkout",
      expectedCurrentStatus: "PROCESSING",
      nextStatus: "CONFIRMED",
      confirmedOn: undefined,
      receivedOn: undefined,
      asaasPaymentId: "pay_asaas_checkout_only",
      asaasCheckoutId: "checkout-recovered"
    });
  });

  it("recovers the external reference from the Asaas checkout session when the payment carries none", async () => {
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_CONFIRMED",
          payment: {
            id: "pay_no_external_ref",
            customer: "cus_9",
            checkoutSession: "checkout-session-9",
            status: "CONFIRMED",
            confirmedDate: "2026-06-12"
          }
        }),
        asaasPaymentId: "pay_no_external_ref",
        asaasCheckoutId: "checkout-session-9"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
      getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue(null),
      getGift: vi.fn().mockResolvedValue({
        id: "g-test-pix",
        image: "pix-teste"
      }),
      getPayment: vi
        .fn()
        .mockResolvedValueOnce({
          paymentId: "payment-9",
          status: "PROCESSING",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        })
        .mockResolvedValueOnce({
          paymentId: "payment-9",
          status: "CONFIRMED",
          amountCents: 500,
          customerProfileStatus: "PENDING",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        })
        .mockResolvedValueOnce({
          paymentId: "payment-9",
          status: "CONFIRMED",
          amountCents: 500,
          payerEmail: "buyer@example.com",
          payerFirstName: "Buyer",
          customerProfileStatus: "READY",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        }),
      applyWebhookUpdate: vi.fn().mockResolvedValue(true),
      updatePaymentCustomerProfile: vi.fn().mockResolvedValue(undefined),
      acquireNotificationSend: vi.fn().mockResolvedValue(true),
      markNotificationSent: vi.fn().mockResolvedValue(undefined),
      releaseNotificationSend: vi.fn().mockResolvedValue(undefined),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const asaasClient = {
      getPaymentById: vi.fn().mockResolvedValue({
        id: "pay_no_external_ref",
        customer: "cus_9",
        checkoutSession: "checkout-session-9"
      }),
      getCheckoutById: vi.fn().mockResolvedValue({
        id: "checkout-session-9",
        externalReference: "payment-9"
      }),
      getCustomerById: vi.fn().mockResolvedValue({
        id: "cus_9",
        name: "Buyer Person",
        email: "buyer@example.com"
      })
    };
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-9" })
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, emailService as never);
    const result = await processor.processEvent("event-checkout-session");

    expect(result).toEqual({ duplicate: false, updated: true });
    expect(asaasClient.getCheckoutById).toHaveBeenCalledWith("checkout-session-9");
    expect(repository.getPayment).toHaveBeenCalledWith("payment-9");
    expect(annotateTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook_asaas_fallback_attempted: true,
        webhook_recovered_external_reference: true,
        webhook_resolution_source: "asaas_fallback_external_reference"
      })
    );
    expect(repository.applyWebhookUpdate).toHaveBeenCalledWith({
      eventId: "event-checkout-session",
      paymentId: "payment-9",
      expectedCurrentStatus: "PROCESSING",
      nextStatus: "CONFIRMED",
      confirmedOn: "2026-06-12",
      receivedOn: undefined,
      asaasPaymentId: "pay_no_external_ref",
      asaasCheckoutId: "checkout-session-9"
    });
  });

  it("recovers the external reference from the checkout session callback url", async () => {
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_CONFIRMED",
          payment: {
            id: "pay_callback_only",
            checkoutSession: "checkout-session-10",
            status: "CONFIRMED"
          }
        }),
        asaasPaymentId: "pay_callback_only",
        asaasCheckoutId: "checkout-session-10"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
      getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue(null),
      getPayment: vi.fn().mockResolvedValue({
        paymentId: "payment-10",
        status: "RECEIVED",
        gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
      }),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const asaasClient = {
      getPaymentById: vi.fn().mockResolvedValue({
        id: "pay_callback_only",
        checkoutSession: "checkout-session-10"
      }),
      getCheckoutById: vi.fn().mockResolvedValue({
        id: "checkout-session-10",
        callback: {
          successUrl: "https://brimax.life/presentes#paymentId=payment-10&status=success"
        }
      })
    };
    const emailService = {
      sendEmail: vi.fn()
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, emailService as never);
    const result = await processor.processEvent("event-callback-url");

    expect(result).toEqual({ duplicate: false, updated: false });
    expect(asaasClient.getCheckoutById).toHaveBeenCalledWith("checkout-session-10");
    expect(repository.getPayment).toHaveBeenCalledWith("payment-10");
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-callback-url", "ignored_stale");
  });

  it("keeps failing when payment resolution still fails after Asaas recovery", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_CONFIRMED",
          payment: {
            id: "pay_asaas_missing",
            status: "CONFIRMED"
          }
        }),
        asaasPaymentId: "pay_asaas_missing"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
      getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue(null),
      getPayment: vi.fn().mockResolvedValue(null)
    };
    const asaasClient = {
      getPaymentById: vi.fn().mockResolvedValue({
        id: "pay_asaas_missing"
      })
    };
    const emailService = {
      sendEmail: vi.fn()
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, emailService as never);

    await expect(processor.processEvent("event-missing")).rejects.toThrow("Payment not found for webhook event.");
    expect(asaasClient.getPaymentById).toHaveBeenCalledWith("pay_asaas_missing");
    expect(annotateTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook_asaas_fallback_attempted: true,
        webhook_resolution_source: "unresolved"
      })
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      JSON.stringify({
        metric: "WEBHOOK_PAYMENT_NOT_FOUND",
        eventId: "event-missing",
        asaasPaymentId: "pay_asaas_missing",
        asaasCheckoutId: undefined,
        externalReference: undefined,
        resolutionSource: "unresolved",
        asaasFallbackAttempted: true,
        localLookupMatches: {
          asaasPaymentId: false,
          asaasCheckoutId: false,
          externalReference: false
        },
        recoveredExternalReference: undefined,
        recoveredAsaasCheckoutId: undefined
      })
    );
    consoleErrorSpy.mockRestore();
  });

  it("acknowledges the event when Asaas says the referenced payment no longer exists", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_CONFIRMED",
          payment: {
            id: "pay_asaas_purged",
            status: "CONFIRMED"
          }
        }),
        asaasPaymentId: "pay_asaas_purged"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
      getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue(null),
      getPayment: vi.fn().mockResolvedValue(null),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const asaasClient = {
      // The sandbox purged this payment: the client maps Asaas 404 to null.
      getPaymentById: vi.fn().mockResolvedValue(null)
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, {} as never);
    const result = await processor.processEvent("event-purged");

    expect(result).toEqual({ duplicate: false, updated: false });
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-purged", "ignored_unresolvable");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"WEBHOOK_PAYMENT_UNRESOLVABLE\"")
    );
    expect(annotateTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook_unresolvable_remotely: true
      })
    );
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it("acknowledges the event when both the payment and its checkout session are gone from Asaas", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_CONFIRMED",
          payment: {
            id: "pay_asaas_purged_2",
            checkoutSession: "checkout-purged",
            status: "CONFIRMED"
          }
        }),
        asaasPaymentId: "pay_asaas_purged_2",
        asaasCheckoutId: "checkout-purged"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(null),
      getPaymentByAsaasCheckoutId: vi.fn().mockResolvedValue(null),
      getPayment: vi.fn().mockResolvedValue(null),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const asaasClient = {
      getPaymentById: vi.fn().mockResolvedValue(null),
      getCheckoutById: vi.fn().mockResolvedValue(null)
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, {} as never);
    const result = await processor.processEvent("event-purged-2");

    expect(result).toEqual({ duplicate: false, updated: false });
    expect(asaasClient.getCheckoutById).toHaveBeenCalledWith("checkout-purged");
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-purged-2", "ignored_unresolvable");
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it("skips re-enrichment when the payment already has a ready customer profile", async () => {
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_CONFIRMED",
          payment: {
            id: "pay_asaas_3",
            externalReference: "payment-3",
            status: "CONFIRMED"
          }
        }),
        asaasPaymentId: "pay_asaas_3",
        externalReference: "payment-3"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue({
        paymentId: "payment-3",
        status: "PROCESSING",
        asaasPaymentId: "pay_asaas_3",
        gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
      }),
      getPaymentByAsaasCheckoutId: vi.fn(),
      getGift: vi.fn().mockResolvedValue({
        id: "g-test-pix",
        image: "pix-teste"
      }),
      getPayment: vi.fn().mockResolvedValue({
        paymentId: "payment-3",
        status: "CONFIRMED",
        amountCents: 500,
        payerEmail: "ana@example.com",
        payerFirstName: "Ana",
        customerProfileStatus: "READY",
        gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
      }),
      applyWebhookUpdate: vi.fn().mockResolvedValue(true),
      incrementGiftFunding: vi.fn(),
      updatePaymentCustomerProfile: vi.fn(),
      acquireNotificationSend: vi.fn().mockResolvedValue(false),
      markNotificationSent: vi.fn(),
      releaseNotificationSend: vi.fn(),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const asaasClient = {
      getPaymentById: vi.fn(),
      getCustomerById: vi.fn()
    };
    const emailService = {
      sendEmail: vi.fn()
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, emailService as never);
    await processor.processEvent("event-3");

    expect(repository.updatePaymentCustomerProfile).not.toHaveBeenCalled();
    expect(repository.incrementGiftFunding).not.toHaveBeenCalled();
    expect(asaasClient.getPaymentById).not.toHaveBeenCalled();
    expect(asaasClient.getCustomerById).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it("releases the notification lock when SES send fails", async () => {
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_CONFIRMED",
          payment: {
            id: "pay_asaas_4",
            customer: "cus_4",
            externalReference: "payment-4",
            status: "CONFIRMED"
          }
        }),
        asaasPaymentId: "pay_asaas_4",
        externalReference: "payment-4"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue({
        paymentId: "payment-4",
        status: "PROCESSING",
        asaasPaymentId: "pay_asaas_4",
        gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
      }),
      getPaymentByAsaasCheckoutId: vi.fn(),
      getGift: vi.fn().mockResolvedValue({
        id: "g-test-pix",
        image: "pix-teste"
      }),
      getPayment: vi
        .fn()
        .mockResolvedValueOnce({
          paymentId: "payment-4",
          status: "CONFIRMED",
          amountCents: 500,
          customerProfileStatus: "PENDING",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        })
        .mockResolvedValueOnce({
          paymentId: "payment-4",
          status: "CONFIRMED",
          amountCents: 500,
          payerEmail: "buyer@example.com",
          payerFirstName: "Buyer",
          customerProfileStatus: "READY",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        }),
      applyWebhookUpdate: vi.fn().mockResolvedValue(true),
      incrementGiftFunding: vi.fn().mockResolvedValue(undefined),
      updatePaymentCustomerProfile: vi.fn().mockResolvedValue(undefined),
      acquireNotificationSend: vi.fn().mockResolvedValue(true),
      markNotificationSent: vi.fn(),
      releaseNotificationSend: vi.fn().mockResolvedValue(undefined),
      markWebhookProcessed: vi.fn()
    };
    const asaasClient = {
      getCustomerById: vi.fn().mockResolvedValue({
        id: "cus_4",
        name: "Buyer Person",
        email: "buyer@example.com"
      })
    };
    const emailService = {
      sendEmail: vi.fn().mockImplementation(({ to }: { to: string }) => {
        if (to === "casamento@brimax.life") {
          return Promise.reject(new Error("sandbox rejection"));
        }

        return Promise.resolve({ ok: true, messageId: "payer-message" });
      })
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, emailService as never);

    await expect(processor.processEvent("event-4")).rejects.toThrow("sandbox rejection");
    expect(repository.releaseNotificationSend).toHaveBeenCalledWith("payment-4", "COUPLE_GIFT_CONFIRMATION");
    expect(repository.markNotificationSent).toHaveBeenCalledWith({
      paymentId: "payment-4",
      type: "PAYER_CONFIRMATION",
      payload: { payerEmail: "buyer@example.com" }
    });
  });

  it("does not increment gift funding again when a confirmed payment later becomes received", async () => {
    const repository = {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: "PAYMENT_RECEIVED",
          payment: {
            id: "pay_asaas_5",
            customer: "cus_5",
            externalReference: "payment-5",
            status: "RECEIVED"
          }
        }),
        asaasPaymentId: "pay_asaas_5",
        externalReference: "payment-5"
      }),
      getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue({
        paymentId: "payment-5",
        status: "CONFIRMED",
        asaasPaymentId: "pay_asaas_5",
        gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
      }),
      getPaymentByAsaasCheckoutId: vi.fn(),
      getGift: vi.fn().mockResolvedValue({
        id: "g-test-pix",
        image: "pix-teste"
      }),
      getPayment: vi.fn().mockResolvedValue({
        paymentId: "payment-5",
        status: "RECEIVED",
        amountCents: 500,
        payerEmail: "maria@example.com",
        payerFirstName: "Maria",
        customerProfileStatus: "READY",
        gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
      }),
      applyWebhookUpdate: vi.fn().mockResolvedValue(true),
      incrementGiftFunding: vi.fn(),
      updatePaymentCustomerProfile: vi.fn(),
      acquireNotificationSend: vi.fn().mockResolvedValue(false),
      markNotificationSent: vi.fn(),
      releaseNotificationSend: vi.fn(),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };
    const asaasClient = {
      getPaymentById: vi.fn(),
      getCustomerById: vi.fn()
    };
    const emailService = {
      sendEmail: vi.fn()
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, emailService as never);
    await processor.processEvent("event-5");

    expect(repository.incrementGiftFunding).not.toHaveBeenCalled();
  });
});

describe("WebhookProcessor checkout events", () => {
  function createCheckoutEventRepository(input: {
    eventType: string;
    payment?: Record<string, unknown> | null;
    reservation?: Record<string, unknown> | null;
    shell?: Record<string, unknown> | null;
    applyWebhookUpdateResult?: boolean;
  }) {
    return {
      getWebhookEvent: vi.fn().mockResolvedValue({
        payload: JSON.stringify({
          event: input.eventType,
          checkout: {
            id: "checkout-1",
            externalReference: "payment-1"
          }
        }),
        asaasCheckoutId: "checkout-1",
        externalReference: "payment-1"
      }),
      getPayment: vi.fn().mockResolvedValue(input.payment ?? null),
      getPaymentReservation: vi.fn().mockResolvedValue(input.reservation ?? null),
      getPaymentShell: vi.fn().mockResolvedValue(input.shell ?? null),
      getGift: vi.fn().mockResolvedValue({
        id: "g-travesseiros",
        name: "Travesseiros",
        image: "travesseiros",
        totalValueCents: 10_000,
        fractional: false,
        partValueCents: null,
        totalParts: null
      }),
      applyWebhookUpdate: vi.fn().mockResolvedValue(input.applyWebhookUpdateResult ?? true),
      releaseReservationAfterCheckoutFailure: vi.fn().mockResolvedValue(undefined),
      repairFinalizedPayment: vi.fn().mockResolvedValue(undefined),
      markWebhookProcessed: vi.fn().mockResolvedValue(undefined)
    };
  }

  const activeReservation = {
    paymentId: "payment-1",
    giftId: "g-travesseiros",
    quantity: 1,
    quotaValuesCents: [10_000],
    amountCents: 10_000,
    status: "ACTIVE",
    expiresAt: "2026-06-12T12:00:00.000Z",
    createdAt: "2026-06-12T11:00:00.000Z",
    updatedAt: "2026-06-12T11:00:00.000Z"
  };

  it("marks CHECKOUT_EXPIRED as ignored_stale instead of throwing when the reservation is missing", async () => {
    const repository = createCheckoutEventRepository({
      eventType: "CHECKOUT_EXPIRED",
      reservation: null
    });

    const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
    const result = await processor.processEvent("event-checkout-stale");

    expect(result).toEqual({ duplicate: false, updated: false });
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-checkout-stale", "ignored_stale");
    expect(repository.releaseReservationAfterCheckoutFailure).not.toHaveBeenCalled();
    expect(repository.applyWebhookUpdate).not.toHaveBeenCalled();
  });

  it("expires a pending payment atomically on CHECKOUT_EXPIRED", async () => {
    const repository = createCheckoutEventRepository({
      eventType: "CHECKOUT_EXPIRED",
      payment: { paymentId: "payment-1", status: "AWAITING_PAYMENT" },
      reservation: activeReservation
    });

    const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
    const result = await processor.processEvent("event-checkout-expired");

    expect(result).toEqual({ duplicate: false, updated: true });
    expect(repository.applyWebhookUpdate).toHaveBeenCalledWith({
      eventId: "event-checkout-expired",
      paymentId: "payment-1",
      expectedCurrentStatus: "AWAITING_PAYMENT",
      nextStatus: "EXPIRED",
      asaasCheckoutId: "checkout-1"
    });
    expect(repository.releaseReservationAfterCheckoutFailure).not.toHaveBeenCalled();
    expect(repository.markWebhookProcessed).not.toHaveBeenCalled();
  });

  it("cancels a pending payment on CHECKOUT_CANCELED", async () => {
    const repository = createCheckoutEventRepository({
      eventType: "CHECKOUT_CANCELED",
      payment: { paymentId: "payment-1", status: "CREATED" },
      reservation: activeReservation
    });

    const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
    const result = await processor.processEvent("event-checkout-canceled");

    expect(result).toEqual({ duplicate: false, updated: true });
    expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedCurrentStatus: "CREATED",
        nextStatus: "CANCELED"
      })
    );
  });

  it("releases the reservation directly when the payment record is missing", async () => {
    const repository = createCheckoutEventRepository({
      eventType: "CHECKOUT_EXPIRED",
      payment: null,
      reservation: activeReservation
    });

    const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
    const result = await processor.processEvent("event-checkout-orphan");

    expect(result).toEqual({ duplicate: false, updated: true });
    expect(repository.releaseReservationAfterCheckoutFailure).toHaveBeenCalledWith("payment-1");
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-checkout-orphan", "updated");
    expect(repository.applyWebhookUpdate).not.toHaveBeenCalled();
  });

  it("ignores CHECKOUT_EXPIRED for a payment that already confirmed", async () => {
    const repository = createCheckoutEventRepository({
      eventType: "CHECKOUT_EXPIRED",
      payment: { paymentId: "payment-1", status: "CONFIRMED" },
      reservation: { ...activeReservation, status: "CONSUMED" }
    });

    const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
    const result = await processor.processEvent("event-checkout-late");

    expect(result).toEqual({ duplicate: false, updated: false });
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-checkout-late", "ignored_stale");
    expect(repository.releaseReservationAfterCheckoutFailure).not.toHaveBeenCalled();
    expect(repository.applyWebhookUpdate).not.toHaveBeenCalled();
  });

  it("ignores a later CHECKOUT_CANCELED event after discard already released the checkout", async () => {
    const repository = createCheckoutEventRepository({
      eventType: "CHECKOUT_CANCELED",
      payment: { paymentId: "payment-1", status: "CANCELED" },
      reservation: { ...activeReservation, status: "RELEASED" },
      shell: {
        paymentId: "payment-1",
        shellStatus: "CHECKOUT_RELEASED"
      }
    });

    const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
    const result = await processor.processEvent("event-checkout-discarded");

    expect(result).toEqual({ duplicate: false, updated: false });
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith(
      "event-checkout-discarded",
      "ignored_stale"
    );
    expect(repository.applyWebhookUpdate).not.toHaveBeenCalled();
  });

  it("marks the event ignored_stale when the atomic update loses the race", async () => {
    const repository = createCheckoutEventRepository({
      eventType: "CHECKOUT_EXPIRED",
      payment: { paymentId: "payment-1", status: "AWAITING_PAYMENT" },
      reservation: activeReservation,
      applyWebhookUpdateResult: false
    });

    const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
    const result = await processor.processEvent("event-checkout-race");

    expect(result).toEqual({ duplicate: false, updated: false });
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-checkout-race", "ignored_stale");
  });

  it("does not repair a payment from CHECKOUT_CREATED when the reservation was already released", async () => {
    const repository = createCheckoutEventRepository({
      eventType: "CHECKOUT_CREATED",
      payment: null,
      reservation: { ...activeReservation, status: "RELEASED" },
      shell: {
        paymentId: "payment-1",
        giftId: "g-travesseiros",
        amountCents: 10_000,
        quotaValuesCents: [10_000],
        paymentMethod: "PIX",
        externalReference: "payment-1",
        shellStatus: "CHECKOUT_RELEASED",
        createdAt: "2026-06-12T11:00:00.000Z",
        updatedAt: "2026-06-12T11:00:00.000Z"
      }
    });

    const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
    const result = await processor.processEvent("event-checkout-created-late");

    expect(result).toEqual({ duplicate: false, updated: false });
    expect(repository.repairFinalizedPayment).not.toHaveBeenCalled();
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-checkout-created-late", "ignored_stale");
  });

  it("still fails CHECKOUT_PAID when shell and reservation are both missing", async () => {
    const repository = createCheckoutEventRepository({
      eventType: "CHECKOUT_PAID",
      payment: null,
      reservation: null,
      shell: null
    });

    const processor = new WebhookProcessor(repository as never, {} as never, {} as never);

    await expect(processor.processEvent("event-checkout-paid-missing")).rejects.toThrow(
      "Checkout webhook could not resolve shell or reservation state."
    );
    expect(repository.markWebhookProcessed).not.toHaveBeenCalled();
  });

  describe("refund and chargeback processing", () => {
    it("applies full reversal on PAYMENT_REFUNDED webhook", async () => {
      const payment = {
        paymentId: "payment-ref",
        status: "CONFIRMED",
        amountCents: 10_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-refund",
          eventType: "PAYMENT_REFUNDED",
          payload: JSON.stringify({
            event: "PAYMENT_REFUNDED",
            payment: {
              id: "pay_refund_1",
              status: "REFUNDED",
              externalReference: "payment-ref"
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-refund");

      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "event-refund",
          paymentId: "payment-ref",
          expectedCurrentStatus: "CONFIRMED",
          nextStatus: "REFUNDED"
        })
      );
    });

    it("applies full reversal on PAYMENT_CHARGEBACK_REQUESTED webhook", async () => {
      const payment = {
        paymentId: "payment-cb",
        status: "CONFIRMED",
        amountCents: 10_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-cb",
          eventType: "PAYMENT_CHARGEBACK_REQUESTED",
          payload: JSON.stringify({
            event: "PAYMENT_CHARGEBACK_REQUESTED",
            payment: {
              id: "pay_cb_1",
              status: "CHARGEBACK",
              externalReference: "payment-cb"
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-cb");

      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "event-cb",
          paymentId: "payment-cb",
          expectedCurrentStatus: "CONFIRMED",
          nextStatus: "CHARGEBACK"
        })
      );
    });

    it("keeps the payment status on a partial refund and hands the cumulative refunded cents to the repository", async () => {
      const payment = {
        paymentId: "payment-part",
        status: "CONFIRMED",
        amountCents: 10_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-partial",
          eventType: "PAYMENT_PARTIALLY_REFUNDED",
          payload: JSON.stringify({
            event: "PAYMENT_PARTIALLY_REFUNDED",
            payment: {
              id: "pay_part_1",
              status: "PARTIALLY_REFUNDED",
              externalReference: "payment-part",
              refunds: [{ value: 30 }]
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-partial");

      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "event-partial",
          paymentId: "payment-part",
          expectedCurrentStatus: "CONFIRMED",
          nextStatus: "CONFIRMED",
          refundedAmountCents: 3_000
        })
      );
      const callArgs = repository.applyWebhookUpdate.mock.calls[0][0];
      expect(callArgs.isPartialRefund).toBeUndefined();
    });

    it("treats a partial-refund event whose cumulative refunds reach the full amount as a full refund", async () => {
      const payment = {
        paymentId: "payment-part-sum",
        status: "RECEIVED",
        amountCents: 10_000,
        refundedAmountCents: 4_000,
        gift: { id: "g-pratos", name: "Jogo de Pratos", quantity: 2 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-partial-sum",
          eventType: "PAYMENT_PARTIALLY_REFUNDED",
          payload: JSON.stringify({
            event: "PAYMENT_PARTIALLY_REFUNDED",
            payment: {
              id: "pay_part_sum",
              status: "RECEIVED",
              externalReference: "payment-part-sum",
              refunds: [{ value: 40 }, { value: 60 }]
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-partial-sum");

      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedCurrentStatus: "RECEIVED",
          nextStatus: "REFUNDED",
          refundedAmountCents: 10_000
        })
      );
    });

    it.each([
      ["PAYMENT_CONFIRMED", "CONFIRMED"],
      ["PAYMENT_RECEIVED", "RECEIVED"]
    ])(
      "ignores a %s arriving after a chargeback instead of re-funding the gift",
      async (event, status) => {
        // The webhook queue is a standard SQS queue with redelivery, so this is
        // a stale copy of the original confirmation, not a won dispute.
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const payment = {
          paymentId: "payment-dispute",
          status: "CHARGEBACK",
          amountCents: 10_000,
          gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
        };
        const repository = {
          getWebhookEvent: vi.fn().mockResolvedValue({
            eventId: "event-stale-confirmation",
            eventType: event,
            payload: JSON.stringify({
              event,
              payment: { id: "pay_dispute_1", status, externalReference: "payment-dispute" }
            })
          }),
          getPayment: vi.fn().mockResolvedValue(payment),
          getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
          getGift: vi.fn().mockResolvedValue({ id: "g-travesseiros", image: "travesseiros" }),
          markWebhookProcessed: vi.fn().mockResolvedValue(undefined),
          applyWebhookUpdate: vi.fn().mockResolvedValue(true)
        };

        const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
        const result = await processor.processEvent("event-stale-confirmation");

        expect(result).toEqual({ duplicate: false, updated: false });
        expect(repository.applyWebhookUpdate).not.toHaveBeenCalled();
        expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-stale-confirmation", "ignored_stale");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('"metric":"CHARGEBACK_CONFIRMATION_IGNORED"')
        );
      }
    );

    it("still lets a refund finalise a charged-back payment", async () => {
      const payment = {
        paymentId: "payment-dispute-lost",
        status: "CHARGEBACK",
        amountCents: 10_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-chargeback-refund",
          eventType: "PAYMENT_REFUNDED",
          payload: JSON.stringify({
            event: "PAYMENT_REFUNDED",
            payment: {
              id: "pay_dispute_2",
              status: "REFUNDED",
              externalReference: "payment-dispute-lost"
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        markWebhookProcessed: vi.fn().mockResolvedValue(undefined),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-chargeback-refund");

      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ expectedCurrentStatus: "CHARGEBACK", nextStatus: "REFUNDED" })
      );
    });

    it("treats a PAYMENT_REFUNDED whose refunds sum below the payment amount as partial", async () => {
      const payment = {
        paymentId: "payment-full-sum-mismatch",
        status: "CONFIRMED",
        amountCents: 10_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-full-mismatch",
          eventType: "PAYMENT_REFUNDED",
          payload: JSON.stringify({
            event: "PAYMENT_REFUNDED",
            payment: {
              id: "pay_full_1",
              status: "REFUNDED",
              externalReference: "payment-full-sum-mismatch",
              refunds: [{ value: 40 }] // sums to 4000 < 10000
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-full-mismatch");

      // Asaas labels a partial refund PAYMENT_REFUNDED too. Taking the label
      // over the amount would wipe a gift the guest only partly got back.
      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "event-full-mismatch",
          paymentId: "payment-full-sum-mismatch",
          expectedCurrentStatus: "CONFIRMED",
          nextStatus: "CONFIRMED",
          refundedAmountCents: 4_000
        })
      );
      const callArgs = repository.applyWebhookUpdate.mock.calls[0][0];
      expect(callArgs.isPartialRefund).toBeUndefined();
    });

    it("still treats a PAYMENT_REFUNDED with no refund breakdown as a full refund", async () => {
      const payment = {
        paymentId: "payment-no-breakdown",
        status: "CONFIRMED",
        amountCents: 10_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-no-breakdown",
          eventType: "PAYMENT_REFUNDED",
          payload: JSON.stringify({
            event: "PAYMENT_REFUNDED",
            payment: {
              id: "pay_no_breakdown",
              status: "REFUNDED",
              externalReference: "payment-no-breakdown"
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-no-breakdown");

      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ nextStatus: "REFUNDED" })
      );
    });

    it("counts only settled refunds, ignoring pending and cancelled entries", async () => {
      const payment = {
        paymentId: "payment-denied-entry",
        status: "CONFIRMED",
        amountCents: 10_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-mixed-refunds",
          eventType: "PAYMENT_PARTIALLY_REFUNDED",
          payload: JSON.stringify({
            event: "PAYMENT_PARTIALLY_REFUNDED",
            payment: {
              id: "pay_mixed",
              status: "CONFIRMED",
              externalReference: "payment-denied-entry",
              refunds: [
                { value: 40, status: "CANCELLED" },
                { value: 60, status: "DONE" },
                { value: 30, status: "PENDING" }
              ]
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-mixed-refunds");

      // Only the DONE entry is real money: 6 000, not the 13 000 the raw array
      // sums to — which would have crossed the amount and forced REFUNDED.
      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ nextStatus: "CONFIRMED", refundedAmountCents: 6_000 })
      );
    });

    it("counts refund entries that carry no status at all", async () => {
      const payment = {
        paymentId: "payment-statusless",
        status: "CONFIRMED",
        amountCents: 10_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-statusless-refund",
          eventType: "PAYMENT_PARTIALLY_REFUNDED",
          payload: JSON.stringify({
            event: "PAYMENT_PARTIALLY_REFUNDED",
            payment: {
              id: "pay_statusless",
              status: "CONFIRMED",
              externalReference: "payment-statusless",
              refunds: [{ value: 30 }]
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-statusless-refund");

      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ refundedAmountCents: 3_000 })
      );
    });

    it("ignores PAYMENT_REFUND_DENIED on confirmed payment without reversing quotas", async () => {
      const payment = {
        paymentId: "payment-denied",
        status: "CONFIRMED",
        amountCents: 10_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-refund-denied",
          eventType: "PAYMENT_REFUND_DENIED",
          payload: JSON.stringify({
            event: "PAYMENT_REFUND_DENIED",
            payment: {
              id: "pay_denied_1",
              status: "CONFIRMED",
              externalReference: "payment-denied"
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        markWebhookProcessed: vi.fn().mockResolvedValue(undefined),
        applyWebhookUpdate: vi.fn()
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-refund-denied");

      expect(result).toEqual({ duplicate: false, updated: false });
      expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-refund-denied", "ignored_stale");
      expect(repository.applyWebhookUpdate).not.toHaveBeenCalled();
    });

    it("ignores transient PAYMENT_REFUND_IN_PROGRESS on confirmed payment without reversing quotas", async () => {
      const payment = {
        paymentId: "payment-in-progress",
        status: "CONFIRMED",
        amountCents: 10_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-refund-progress",
          eventType: "PAYMENT_REFUND_IN_PROGRESS",
          payload: JSON.stringify({
            event: "PAYMENT_REFUND_IN_PROGRESS",
            payment: {
              id: "pay_prog_1",
              status: "CONFIRMED",
              externalReference: "payment-in-progress"
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        markWebhookProcessed: vi.fn().mockResolvedValue(undefined),
        applyWebhookUpdate: vi.fn()
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-refund-progress");

      expect(result).toEqual({ duplicate: false, updated: false });
      expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-refund-progress", "ignored_stale");
      expect(repository.applyWebhookUpdate).not.toHaveBeenCalled();
    });

    it("does not allow previous partial refund data to swallow a subsequent PAYMENT_CHARGEBACK_REQUESTED", async () => {
      const payment = {
        paymentId: "payment-part-then-cb",
        status: "CONFIRMED",
        amountCents: 10_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-cb-after-part",
          eventType: "PAYMENT_CHARGEBACK_REQUESTED",
          payload: JSON.stringify({
            event: "PAYMENT_CHARGEBACK_REQUESTED",
            payment: {
              id: "pay_cb_2",
              status: "CHARGEBACK",
              externalReference: "payment-part-then-cb",
              refunds: [{ value: 20 }] // previous partial refund is present in Asaas object
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-cb-after-part");

      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "event-cb-after-part",
          paymentId: "payment-part-then-cb",
          expectedCurrentStatus: "CONFIRMED",
          nextStatus: "CHARGEBACK"
        })
      );
      const callArgs = repository.applyWebhookUpdate.mock.calls[0][0];
      expect(callArgs.isPartialRefund).toBeUndefined();
    });

    it("maps PAYMENT_AWAITING_CHARGEBACK_REVERSAL to a confirmation that carries the stored refunded cents", async () => {
      const payment = {
        paymentId: "payment-cb-reversal",
        status: "CHARGEBACK",
        amountCents: 15_000,
        // A partial refund happened before the chargeback; the dispute-won
        // payload omits refunds[], so the stored total must travel along.
        refundedAmountCents: 5_000,
        gift: { id: "g-pratos", name: "Jogo de Pratos", quantity: 3 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-cb-reversal",
          eventType: "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
          payload: JSON.stringify({
            event: "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
            payment: {
              id: "pay_rev_1",
              status: "AWAITING_CHARGEBACK_REVERSAL",
              externalReference: "payment-cb-reversal"
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        markWebhookProcessed: vi.fn().mockResolvedValue(undefined),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-cb-reversal");

      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.markWebhookProcessed).not.toHaveBeenCalled();
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "event-cb-reversal",
          paymentId: "payment-cb-reversal",
          expectedCurrentStatus: "CHARGEBACK",
          nextStatus: "CONFIRMED",
          refundedAmountCents: 5_000
        })
      );
      // The payer was enriched and thanked on the original confirmation.
      expect(repository.getPayment).not.toHaveBeenCalled();
    });

    it("never lets a stale payload shrink the refunded total already recorded on the payment", async () => {
      const payment = {
        paymentId: "payment-stale-refund",
        status: "CONFIRMED",
        amountCents: 15_000,
        refundedAmountCents: 10_000,
        gift: { id: "g-pratos", name: "Jogo de Pratos", quantity: 3 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-stale-refund",
          eventType: "PAYMENT_PARTIALLY_REFUNDED",
          payload: JSON.stringify({
            event: "PAYMENT_PARTIALLY_REFUNDED",
            payment: {
              id: "pay_stale_1",
              status: "CONFIRMED",
              externalReference: "payment-stale-refund",
              refunds: [{ value: 50 }]
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      await processor.processEvent("event-stale-refund");

      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          nextStatus: "CONFIRMED",
          refundedAmountCents: 10_000
        })
      );
    });

    // Regression: an unsettled refund used to fall through every refund branch
    // to the status map, which returns REFUNDED and makes the repository zero
    // every funded part regardless of the amount.
    function unsettledRepository(overrides: {
      eventId: string;
      event: string;
      paymentStatus: string;
      refunds: Array<{ value: number; status?: string }>;
    }) {
      const payment = {
        paymentId: "payment-unsettled",
        status: "RECEIVED",
        amountCents: 5_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      return {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: overrides.eventId,
          eventType: overrides.event,
          payload: JSON.stringify({
            event: overrides.event,
            payment: {
              id: "pay_unsettled_1",
              status: overrides.paymentStatus,
              externalReference: "payment-unsettled",
              value: 50,
              refunds: overrides.refunds
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        markWebhookProcessed: vi.fn().mockResolvedValue(undefined),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };
    }

    it("does not reverse anything when a partial refund is still awaiting authorization", async () => {
      const repository = unsettledRepository({
        eventId: "event-unsettled-partial",
        event: "PAYMENT_REFUNDED",
        paymentStatus: "REFUNDED",
        refunds: [{ value: 10, status: "AWAITING_CRITICAL_ACTION_AUTHORIZATION" }]
      });

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-unsettled-partial");

      expect(result).toEqual({ duplicate: false, updated: false });
      expect(repository.applyWebhookUpdate).not.toHaveBeenCalled();
      expect(repository.markWebhookProcessed).toHaveBeenCalledWith(
        "event-unsettled-partial",
        "ignored_unsettled_refund"
      );
    });

    it("does not reverse anything when a full refund is still pending", async () => {
      const repository = unsettledRepository({
        eventId: "event-unsettled-full",
        event: "PAYMENT_REFUNDED",
        paymentStatus: "REFUNDED",
        refunds: [{ value: 50, status: "PENDING" }]
      });

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-unsettled-full");

      expect(result).toEqual({ duplicate: false, updated: false });
      expect(repository.applyWebhookUpdate).not.toHaveBeenCalled();
    });

    it("logs REFUND_NOT_SETTLED so the skipped refund is not silent", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const repository = unsettledRepository({
        eventId: "event-unsettled-log",
        event: "PAYMENT_REFUNDED",
        paymentStatus: "RECEIVED",
        refunds: [{ value: 10, status: "CANCELLED" }]
      });

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      await processor.processEvent("event-unsettled-log");

      const logged = warn.mock.calls.map(([line]) => JSON.parse(String(line)));
      expect(logged).toContainEqual(
        expect.objectContaining({
          metric: "REFUND_NOT_SETTLED",
          eventId: "event-unsettled-log",
          paymentId: "payment-unsettled",
          refundStatuses: ["CANCELLED"],
          unsettledAmountCents: 1_000
        })
      );
      warn.mockRestore();
    });

    it("still reverses once the same refund settles", async () => {
      const repository = unsettledRepository({
        eventId: "event-settled-full",
        event: "PAYMENT_REFUNDED",
        paymentStatus: "REFUNDED",
        refunds: [{ value: 50, status: "DONE" }]
      });

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-settled-full");

      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ nextStatus: "REFUNDED", refundedAmountCents: 5_000 })
      );
    });

    it("keeps reversing a chargeback that carries an unsettled refund entry", async () => {
      const repository = unsettledRepository({
        eventId: "event-cb-unsettled",
        event: "PAYMENT_CHARGEBACK_REQUESTED",
        paymentStatus: "CHARGEBACK",
        refunds: [{ value: 50, status: "PENDING" }]
      });

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-cb-unsettled");

      expect(result).toEqual({ duplicate: false, updated: true });
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ nextStatus: "CHARGEBACK" })
      );
    });

    it("records the full amount when a full refund arrives without a breakdown", async () => {
      const payment = {
        paymentId: "payment-no-breakdown",
        status: "RECEIVED",
        amountCents: 5_000,
        gift: { id: "g-travesseiros", name: "Travesseiros", quantity: 1 }
      };
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-no-breakdown",
          eventType: "PAYMENT_REFUNDED",
          payload: JSON.stringify({
            event: "PAYMENT_REFUNDED",
            payment: {
              id: "pay_no_breakdown",
              status: "REFUNDED",
              externalReference: "payment-no-breakdown"
            }
          })
        }),
        getPayment: vi.fn().mockResolvedValue(payment),
        getPaymentByAsaasPaymentId: vi.fn().mockResolvedValue(payment),
        markWebhookProcessed: vi.fn().mockResolvedValue(undefined),
        applyWebhookUpdate: vi.fn().mockResolvedValue(true)
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      await processor.processEvent("event-no-breakdown");

      // Without this the guest sees a REFUNDED payment and no refunded amount.
      expect(repository.applyWebhookUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ nextStatus: "REFUNDED", refundedAmountCents: 5_000 })
      );
    });

    it("acknowledges a payload with no payment reference instead of poisoning the queue", async () => {
      const repository = {
        getWebhookEvent: vi.fn().mockResolvedValue({
          eventId: "event-unreferenced",
          eventType: "UNKNOWN",
          payload: "{}"
        }),
        markWebhookProcessed: vi.fn().mockResolvedValue(undefined),
        applyWebhookUpdate: vi.fn()
      };

      const processor = new WebhookProcessor(repository as never, {} as never, {} as never);
      const result = await processor.processEvent("event-unreferenced");

      expect(result).toEqual({ duplicate: false, updated: false });
      expect(repository.markWebhookProcessed).toHaveBeenCalledWith(
        "event-unreferenced",
        "ignored_unresolvable"
      );
      expect(repository.applyWebhookUpdate).not.toHaveBeenCalled();
    });
  });
});
