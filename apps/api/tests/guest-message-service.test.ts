import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateGuestMessageRequest } from "@brimax/contracts";

process.env.WEDDING_TABLE_NAME = "test-wedding-table";
process.env.CONTACT_EMAIL = "casamento@brimax.life";

const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));

vi.mock("../src/services/sqs/guest-message-notification-publisher", () => ({
  enqueueGuestMessageNotification: (...args: unknown[]) => enqueueMock(...args)
}));

import { GuestMessageService } from "../src/domain/guest-message-service";
import { AppError } from "../src/lib/errors";

const baseRequest: CreateGuestMessageRequest = {
  authorName: "  Ana   Clara  ",
  message: "  Que alegria viver esse momento com vocês!  \n\n\n Sejam muito felizes. "
};

const sanitizedMessage = {
  messageId: "msg-1",
  authorName: "Ana Clara",
  message: "Que alegria viver esse momento com vocês!\n\nSejam muito felizes.",
  createdAt: "2026-05-29T18:00:00.000Z"
};

afterEach(() => {
  vi.restoreAllMocks();
  enqueueMock.mockReset();
});

describe("GuestMessageService", () => {
  it("stores a sanitized message and enqueues the notification (no inline email)", async () => {
    enqueueMock.mockResolvedValue("accepted");
    const repository = {
      createGuestMessage: vi.fn().mockResolvedValue(sanitizedMessage),
      listGuestMessages: vi.fn(),
      deleteGuestMessage: vi.fn()
    };
    const service = new GuestMessageService(repository as never);

    const result = await service.create(baseRequest);

    expect(repository.createGuestMessage).toHaveBeenCalledWith({
      authorName: "Ana Clara",
      message: "Que alegria viver esse momento com vocês!\n\nSejam muito felizes."
    });
    // The notification is handed off to the async worker — never sent inline.
    expect(enqueueMock).toHaveBeenCalledWith(sanitizedMessage);
    expect(result.response.ok).toBe(true);
    expect(result.response.message.messageId).toBe("msg-1");
    expect(result.notificationEnqueued).toBe(true);
  });

  it("still succeeds (notificationEnqueued false) when the enqueue is skipped/fails", async () => {
    enqueueMock.mockResolvedValue("skipped");
    const repository = {
      createGuestMessage: vi.fn().mockResolvedValue({ ...sanitizedMessage, messageId: "msg-2" }),
      listGuestMessages: vi.fn(),
      deleteGuestMessage: vi.fn()
    };
    const service = new GuestMessageService(repository as never);

    const result = await service.create(baseRequest);

    expect(result.response.ok).toBe(true);
    expect(result.response.message.messageId).toBe("msg-2");
    expect(result.notificationEnqueued).toBe(false);
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
    const service = new GuestMessageService(repository as never);

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
    const service = new GuestMessageService(repository as never);

    const response = await service.delete("msg-1");

    expect(repository.deleteGuestMessage).toHaveBeenCalledWith("msg-1");
    expect(response.ok).toBe(true);
    expect(response.messageId).toBe("msg-1");
  });

  it("rejects deletion without a message id", async () => {
    const service = new GuestMessageService(
      { deleteGuestMessage: vi.fn(), createGuestMessage: vi.fn(), listGuestMessages: vi.fn() } as never
    );

    await expect(service.delete(" ")).rejects.toBeInstanceOf(AppError);
    await expect(service.delete(" ")).rejects.toMatchObject({ statusCode: 400 });
  });
});
