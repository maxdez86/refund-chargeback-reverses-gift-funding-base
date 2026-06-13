import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuestMessage } from "@brimax/contracts";

// Hoisted so the mock factories (evaluated before module imports run) can close
// over these without hitting the temporal dead zone.
const { sendMock, getEnvMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getEnvMock: vi.fn()
}));

vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: class {
    send = sendMock;
  },
  SendMessageCommand: class {
    constructor(public input: unknown) {}
  }
}));

vi.mock("../src/lib/env", () => ({
  getEnv: () => getEnvMock()
}));

import { enqueueGuestMessageNotification } from "../src/services/sqs/guest-message-notification-publisher";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/guest-message-notification";

const message: GuestMessage = {
  messageId: "msg-1",
  authorName: "Ana Clara",
  message: "Sejam muito felizes!",
  createdAt: "2026-05-29T18:00:00.000Z"
};

describe("enqueueGuestMessageNotification", () => {
  beforeEach(() => {
    sendMock.mockReset().mockResolvedValue({});
    getEnvMock.mockReset().mockReturnValue({ guestMessageNotificationQueueUrl: QUEUE_URL });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues the serialized message when a queue is configured", async () => {
    const result = await enqueueGuestMessageNotification(message);

    expect(result).toBe("accepted");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as { input: { QueueUrl: string; MessageBody: string } };
    expect(command.input.QueueUrl).toBe(QUEUE_URL);
    expect(JSON.parse(command.input.MessageBody)).toEqual(message);
  });

  it("skips (without sending) when no queue url is configured", async () => {
    getEnvMock.mockReturnValue({ guestMessageNotificationQueueUrl: "" });

    const result = await enqueueGuestMessageNotification(message);

    expect(result).toBe("skipped");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("swallows a send failure, logs the metric, and never throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    sendMock.mockRejectedValueOnce(new Error("sqs down"));

    const result = await enqueueGuestMessageNotification(message);

    expect(result).toBe("failed");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"GUEST_MESSAGE_NOTIFICATION_ENQUEUE_FAILED\"")
    );
  });
});
