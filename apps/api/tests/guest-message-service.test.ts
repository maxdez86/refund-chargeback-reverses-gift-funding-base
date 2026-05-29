import { describe, expect, it, vi } from "vitest";
import type { CreateGuestMessageRequest } from "@brimax/contracts";
import { GuestMessageService } from "../src/domain/guest-message-service";
import { AppError } from "../src/lib/errors";

process.env.WEDDING_TABLE_NAME = "test-wedding-table";
process.env.CONTACT_EMAIL = "casamento@brimax.life";

const baseRequest: CreateGuestMessageRequest = {
  authorName: "  Ana   Clara  ",
  message: "  Que alegria viver esse momento com vocês!  \n\n\n Sejam muito felizes. "
};

describe("GuestMessageService", () => {
  it("stores a message, sanitizes it, and emails the couple", async () => {
    const repository = {
      createGuestMessage: vi.fn().mockResolvedValue({
        messageId: "msg-1",
        authorName: "Ana Clara",
        message: "Que alegria viver esse momento com vocês!\n\nSejam muito felizes.",
        createdAt: "2026-05-29T18:00:00.000Z"
      }),
      listGuestMessages: vi.fn(),
      deleteGuestMessage: vi.fn()
    };
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "ses-1" })
    };
    const service = new GuestMessageService(repository as never, emailService as never);

    const result = await service.create(baseRequest);

    expect(repository.createGuestMessage).toHaveBeenCalledWith({
      authorName: "Ana Clara",
      message: "Que alegria viver esse momento com vocês!\n\nSejam muito felizes."
    });
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "casamento@brimax.life",
        subject: "Novo recado recebido no site",
        text: expect.stringContaining("Nome: Ana Clara"),
        html: expect.stringContaining("Recado:")
      })
    );
    expect(result.response.ok).toBe(true);
    expect(result.response.message.messageId).toBe("msg-1");
    expect(result.notificationSent).toBe(true);
  });

  it("returns the paginated guest messages feed", async () => {
    const repository = {
      listGuestMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            messageId: "msg-1",
            authorName: "Ana",
            message: "Com carinho.",
            createdAt: "2026-05-29T18:00:00.000Z"
          }
        ],
        nextCursor: "cursor-2"
      }),
      createGuestMessage: vi.fn(),
      deleteGuestMessage: vi.fn()
    };
    const service = new GuestMessageService(repository as never, { sendEmail: vi.fn() } as never);

    const response = await service.list("cursor-1");

    expect(repository.listGuestMessages).toHaveBeenCalledWith("cursor-1", 50);
    expect(response.messages).toHaveLength(1);
    expect(response.nextCursor).toBe("cursor-2");
  });

  it("deletes a guest message by message id", async () => {
    const repository = {
      deleteGuestMessage: vi.fn().mockResolvedValue(undefined),
      createGuestMessage: vi.fn(),
      listGuestMessages: vi.fn()
    };
    const service = new GuestMessageService(repository as never, { sendEmail: vi.fn() } as never);

    const response = await service.delete("msg-1");

    expect(repository.deleteGuestMessage).toHaveBeenCalledWith("msg-1");
    expect(response.ok).toBe(true);
    expect(response.messageId).toBe("msg-1");
  });

  it("returns success and logs when the notification email fails", async () => {
    const repository = {
      createGuestMessage: vi.fn().mockResolvedValue({
        messageId: "msg-2",
        authorName: "Ana Clara",
        message: "Sejam felizes.",
        createdAt: "2026-05-29T18:00:00.000Z"
      }),
      listGuestMessages: vi.fn(),
      deleteGuestMessage: vi.fn()
    };
    const emailService = {
      sendEmail: vi.fn().mockRejectedValue(new Error("ses rejected"))
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new GuestMessageService(repository as never, emailService as never);

    const result = await service.create(baseRequest);

    expect(result.response.ok).toBe(true);
    expect(result.notificationSent).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"event\":\"GUEST_MESSAGE_EMAIL_FAILED\"")
    );

    errorSpy.mockRestore();
  });

  it("rejects deletion without a message id", async () => {
    const service = new GuestMessageService(
      { deleteGuestMessage: vi.fn(), createGuestMessage: vi.fn(), listGuestMessages: vi.fn() } as never,
      { sendEmail: vi.fn() } as never
    );

    await expect(service.delete(" ")).rejects.toBeInstanceOf(AppError);
    await expect(service.delete(" ")).rejects.toMatchObject({ statusCode: 400 });
  });
});
