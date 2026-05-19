import { describe, expect, it, vi } from "vitest";
import { PaymentMessageService } from "../src/domain/payment-message-service";

process.env.CONTACT_EMAIL = "casamento@brimax.life";
process.env.WEDDING_TABLE_NAME = "test-wedding-table";

describe("PaymentMessageService", () => {
  it("stores one post-payment message and emails the couple", async () => {
    const repository = {
      getPayment: vi.fn().mockResolvedValue({
        paymentId: "payment-1",
        status: "CONFIRMED",
        amountCents: 500,
        payerEmail: "maria@example.com",
        payerFirstName: "MARIA",
        gift: {
          name: "PIX Teste"
        }
      }),
      getPaymentMessage: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          paymentId: "payment-1",
          body: "Parabéns pelo casamento!",
          submittedAt: "2026-05-12T10:00:00.000Z",
          payerEmail: "maria@example.com",
          payerName: "Maria",
          giftName: "PIX Teste"
        }),
      putPaymentMessage: vi.fn().mockResolvedValue(true),
      acquireNotificationSend: vi.fn().mockResolvedValue(true),
      markNotificationSent: vi.fn().mockResolvedValue(undefined),
      releaseNotificationSend: vi.fn().mockResolvedValue(undefined)
    };
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-1" })
    };

    const service = new PaymentMessageService(repository as never, emailService as never);
    const result = await service.createMessage("payment-1", {
      body: "Parabéns pelo casamento!"
    });

    expect(repository.putPaymentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: "payment-1",
        body: "Parabéns pelo casamento!",
        payerEmail: "maria@example.com",
        payerName: "Maria",
        giftName: "PIX Teste"
      })
    );
    expect(repository.acquireNotificationSend).toHaveBeenCalledWith({
      paymentId: "payment-1",
      type: "COUPLE_MESSAGE",
      payload: {
        payerEmail: "maria@example.com"
      }
    });
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "casamento@brimax.life",
        subject: "Novo presente recebido pelo site: PIX Teste"
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Valor: R$ 5,00")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Aqui está a mensagem que a pessoa enviou para vocês:")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("Enviado automaticamente por brimax.life.")
      })
    );
    expect(repository.markNotificationSent).toHaveBeenCalledWith({
      paymentId: "payment-1",
      type: "COUPLE_MESSAGE",
      payload: {
        payerEmail: "maria@example.com"
      }
    });
    expect(result.message.body).toBe("Parabéns pelo casamento!");
  });

  it("rejects messages before payment confirmation", async () => {
    const repository = {
      getPayment: vi.fn().mockResolvedValue({
        paymentId: "payment-2",
        status: "CREATED",
        gift: {
          name: "PIX Teste"
        }
      })
    };

    const service = new PaymentMessageService(repository as never, {} as never);

    await expect(
      service.createMessage("payment-2", {
        body: "Mensagem"
      })
    ).rejects.toThrow("Message can only be sent after payment confirmation.");
  });

  it("releases the notification lock if the couple email fails", async () => {
    const repository = {
      getPayment: vi.fn().mockResolvedValue({
        paymentId: "payment-3",
        status: "CONFIRMED",
        amountCents: 500,
        payerEmail: "maria@example.com",
        payerFirstName: "Maria",
        gift: {
          name: "PIX Teste"
        }
      }),
      getPaymentMessage: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          paymentId: "payment-3",
          body: "Parabéns!",
          submittedAt: "2026-05-12T10:00:00.000Z",
          payerEmail: "maria@example.com",
          payerName: "Maria",
          giftName: "PIX Teste"
        }),
      putPaymentMessage: vi.fn().mockResolvedValue(true),
      acquireNotificationSend: vi.fn().mockResolvedValue(true),
      markNotificationSent: vi.fn(),
      releaseNotificationSend: vi.fn().mockResolvedValue(undefined)
    };
    const emailService = {
      sendEmail: vi.fn().mockRejectedValue(new Error("ses rejected"))
    };

    const service = new PaymentMessageService(repository as never, emailService as never);

    await expect(
      service.createMessage("payment-3", {
        body: "Parabéns!"
      })
    ).rejects.toThrow("ses rejected");
    expect(repository.releaseNotificationSend).toHaveBeenCalledWith("payment-3", "COUPLE_MESSAGE");
    expect(repository.markNotificationSent).not.toHaveBeenCalled();
  });
});
