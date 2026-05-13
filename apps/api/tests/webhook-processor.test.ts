import { describe, expect, it, vi } from "vitest";
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
        gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
      }),
      getPaymentByAsaasCheckoutId: vi.fn(),
      getPayment: vi
        .fn()
        .mockResolvedValueOnce({
          paymentId: "payment-1",
          status: "RECEIVED",
          amountCents: 500,
          payerEmail: undefined,
          payerFirstName: undefined,
          customerProfileStatus: "PENDING",
          gift: { id: "g-test-pix", name: "PIX Teste", quantity: 1 }
        })
        .mockResolvedValueOnce({
          paymentId: "payment-1",
          status: "RECEIVED",
          amountCents: 500,
          payerEmail: "maria@example.com",
          payerFirstName: "Maria",
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
      paymentId: "payment-1",
      expectedCurrentStatus: "AWAITING_PAYMENT",
      nextStatus: "RECEIVED",
      confirmedOn: "2026-05-10",
      receivedOn: "2026-05-10",
      asaasPaymentId: "pay_asaas_1",
      asaasCheckoutId: "checkout_1"
    });
    expect(repository.incrementGiftFunding).toHaveBeenCalledWith({
      giftId: "g-test-pix",
      paymentId: "payment-1",
      quantity: 1
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
        subject: "Maria, recebemos seu presente"
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
    expect(repository.markWebhookProcessed).toHaveBeenCalledWith("event-1", "updated");
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
    expect(repository.incrementGiftFunding).toHaveBeenCalledWith({
      giftId: "g-test-pix",
      paymentId: "payment-3",
      quantity: 1
    });
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
