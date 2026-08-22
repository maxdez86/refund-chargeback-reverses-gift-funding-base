import type { SQSEvent } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { createWhatsappWebhookWorker } from "../src/functions/whatsapp-webhook-worker/handler";
import { WhatsappStatusMessageMissingError } from "../src/domain/whatsapp-rsvp-service";

const event = {
  eventId: "whatsapp:message:wamid.1",
  duplicateWithinPayload: false,
  source: { entryIndex: 0, changeIndex: 0, collection: "messages", itemIndex: 0 },
  type: "text",
  messageId: "wamid.1",
  senderWaId: "5511963656517",
  body: "private body"
} as const;

function record() {
  return { messageId: "queue-1", body: JSON.stringify({ provider: "whatsapp", eventId: event.eventId }) } as never;
}

describe("WhatsApp webhook worker", () => {
  it("retries a failed event and processes it after recovery", async () => {
    let status: "pending" | "processing" | "failed" | "processed" = "pending";
    let attempts = 0;
    const marker = { processingStatus: status, replayEvent: JSON.stringify(event) };
    const repository = {
      getWebhookEvent: async () => ({ ...marker, processingStatus: status }),
      claimWebhookEvent: async () => {
        if (status !== "pending" && status !== "failed") return false;
        status = "processing";
        return true;
      },
      markWebhookEventProcessed: async (_provider: string, _id: string, result: { status: "failed" | "processed" }) => {
        status = result.status;
        return true;
      }
    };
    const worker = createWhatsappWebhookWorker({
      repository,
      process: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary failure");
      },
      now: () => "2026-08-17T12:00:00.000Z",
      log: () => undefined
    });

    expect(await worker({ Records: [record()] } as unknown as SQSEvent)).toEqual({ batchItemFailures: [{ itemIdentifier: "queue-1" }] });
    expect(await worker({ Records: [record()] } as unknown as SQSEvent)).toEqual({ batchItemFailures: [] });
    expect(attempts).toBe(2);
    expect(status).toBe("processed");
  });

  it("does not process a completed duplicate", async () => {
    const repository = {
      getWebhookEvent: async () => ({ processingStatus: "processed" as const, replayEvent: JSON.stringify(event) }),
      claimWebhookEvent: async () => { throw new Error("must not claim"); },
      markWebhookEventProcessed: async () => true
    };
    let processed = false;
    const worker = createWhatsappWebhookWorker({ repository, process: async () => { processed = true; } });
    expect(await worker({ Records: [record()] } as unknown as SQSEvent)).toEqual({ batchItemFailures: [] });
    expect(processed).toBe(false);
  });

  it("makes a missing-message status terminal on its fifth attempt", async () => {
    const statusEvent = {
      eventId: "whatsapp:status:wamid.orphan:delivered:1603059201",
      duplicateWithinPayload: false,
      source: { entryIndex: 0, changeIndex: 0, collection: "statuses", itemIndex: 0 },
      type: "status_delivered",
      messageId: "wamid.orphan",
      timestamp: "1603059201",
      status: "delivered",
      errors: []
    } as const;
    let processingStatus: "pending" | "processing" | "failed" = "pending";
    let retryDisposition: "retryable" | "terminal" | undefined;
    let attemptCount = 0;
    const repository = {
      getWebhookEvent: async () => ({
        processingStatus,
        retryDisposition,
        attemptCount,
        replayEvent: JSON.stringify(statusEvent)
      }),
      claimWebhookEvent: async () => {
        processingStatus = "processing";
        attemptCount += 1;
        return true;
      },
      markWebhookEventProcessed: async (_provider: string, _id: string, result: {
        status: "failed";
        retryDisposition?: "retryable" | "terminal";
      }) => {
        processingStatus = result.status;
        retryDisposition = result.retryDisposition;
        return true;
      }
    };
    const process = vi.fn().mockRejectedValue(new WhatsappStatusMessageMissingError());
    const worker = createWhatsappWebhookWorker({ repository, process });
    const sqsEvent = {
      Records: [{
        messageId: "queue-orphan",
        body: JSON.stringify({ provider: "whatsapp", eventId: statusEvent.eventId })
      }]
    } as unknown as SQSEvent;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(await worker(sqsEvent)).toEqual({
        batchItemFailures: [{ itemIdentifier: "queue-orphan" }]
      });
      expect(retryDisposition).toBe("retryable");
    }
    expect(await worker(sqsEvent)).toEqual({ batchItemFailures: [] });
    expect(processingStatus).toBe("failed");
    expect(retryDisposition).toBe("terminal");
    expect(attemptCount).toBe(5);

    expect(await worker(sqsEvent)).toEqual({ batchItemFailures: [] });
    expect(process).toHaveBeenCalledTimes(5);
  });
});
