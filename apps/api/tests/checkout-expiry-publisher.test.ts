import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  __resetExpiryTriggerCooldownForTests,
  enqueueExpiryTrigger
} from "../src/services/sqs/checkout-expiry-publisher";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/expiry";
const T0 = Date.parse("2026-06-12T12:00:00.000Z");

describe("enqueueExpiryTrigger", () => {
  beforeEach(() => {
    sendMock.mockReset().mockResolvedValue({});
    getEnvMock.mockReset().mockReturnValue({ expiryQueueUrl: QUEUE_URL });
    __resetExpiryTriggerCooldownForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues a trigger message when a queue is configured", async () => {
    const result = await enqueueExpiryTrigger("gifts", T0);

    expect(result).toBe("accepted");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as { input: { QueueUrl: string; MessageBody: string } };
    expect(command.input.QueueUrl).toBe(QUEUE_URL);
    expect(JSON.parse(command.input.MessageBody)).toEqual({
      source: "gifts",
      requestedAt: new Date(T0).toISOString()
    });
  });

  it("skips (without sending) when no queue url is configured", async () => {
    getEnvMock.mockReturnValue({ expiryQueueUrl: "" });

    const result = await enqueueExpiryTrigger("gifts", T0);

    expect(result).toBe("skipped");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("throttles a second trigger inside the cooldown window", async () => {
    await enqueueExpiryTrigger("gifts", T0);
    const result = await enqueueExpiryTrigger("gifts", T0 + 30_000);

    expect(result).toBe("skipped");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("fires again once the cooldown window has elapsed", async () => {
    await enqueueExpiryTrigger("gifts", T0);
    const result = await enqueueExpiryTrigger("gifts", T0 + 61_000);

    expect(result).toBe("accepted");
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("swallows a send failure, logs the metric, and never throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sendMock.mockRejectedValueOnce(new Error("sqs down"));

    const result = await enqueueExpiryTrigger("gifts", T0);

    expect(result).toBe("failed");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"CHECKOUT_EXPIRY_TRIGGER_ENQUEUE_FAILED\"")
    );
  });
});
