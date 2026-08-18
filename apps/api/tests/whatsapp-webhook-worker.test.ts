import type { SQSEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { createWhatsappWebhookWorker } from "../src/functions/whatsapp-webhook-worker/handler";

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
});
