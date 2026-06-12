import { describe, expect, it, vi } from "vitest";
const { annotateTrace } = vi.hoisted(() => ({
  annotateTrace: vi.fn()
}));

vi.mock("../src/lib/xray", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/xray")>()),
  annotateTrace
}));

import { WebhookProcessor } from "../src/domain/webhook-processor";

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
      sendEmail: vi.fn().mockRejectedValue(new Error("sandbox rejection"))
    };

    const processor = new WebhookProcessor(repository as never, asaasClient as never, emailService as never);

    await expect(processor.processEvent("event-4")).rejects.toThrow("sandbox rejection");
    expect(repository.releaseNotificationSend).toHaveBeenCalledWith("payment-4", "PAYER_CONFIRMATION");
    expect(repository.markNotificationSent).not.toHaveBeenCalled();
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
