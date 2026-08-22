import type { SQSEvent, SQSRecord } from "aws-lambda";
import { WhatsappWebhookEventSchema } from "@brimax/contracts";
import { z } from "zod";
import {
  WhatsappRsvpService,
  WhatsappStatusMessageMissingError
} from "../../domain/whatsapp-rsvp-service";
import { wrapLambdaHandler } from "../../lib/sentry";
import { WeddingRepository } from "../../services/dynamodb/repositories/wedding-repository";

const messageSchema = z.object({ provider: z.literal("whatsapp"), eventId: z.string().min(1) }).strict();
const ORPHAN_STATUS_MAX_ATTEMPTS = 5;
type Repository = Pick<WeddingRepository, "getWebhookEvent" | "claimWebhookEvent" | "markWebhookEventProcessed">;

export type WhatsappWebhookWorkerDependencies = {
  repository: Repository;
  process: (event: z.infer<typeof WhatsappWebhookEventSchema>, requestId: string) => Promise<unknown>;
  now?: () => string;
  log?: (entry: Record<string, unknown>) => void;
};

function defaultDependencies(): WhatsappWebhookWorkerDependencies {
  const repository = new WeddingRepository();
  const service = new WhatsappRsvpService(repository);
  return { repository, process: (event, requestId) => service.handleWebhookEvent(event, requestId) };
}

async function processRecord(record: SQSRecord, dependencies: WhatsappWebhookWorkerDependencies) {
  const log = dependencies.log ?? ((entry) => console.info(JSON.stringify(entry)));
  let body: unknown;
  try {
    body = JSON.parse(record.body);
  } catch {
    body = undefined;
  }
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    log({ metric: "WHATSAPP_WEBHOOK_WORKER_MESSAGE_INVALID", queueMessageId: record.messageId });
    return false;
  }
  const marker = await dependencies.repository.getWebhookEvent("whatsapp", parsed.data.eventId);
  if (
    !marker ||
    marker.processingStatus === "processed" ||
    marker.retryDisposition === "terminal"
  ) return false;
  const now = dependencies.now?.() ?? new Date().toISOString();
  const reclaimBefore = new Date(Date.parse(now) - 120_000 - 30_000).toISOString();
  if (!(await dependencies.repository.claimWebhookEvent("whatsapp", parsed.data.eventId, now, reclaimBefore))) return false;
  const attemptCount = (marker.attemptCount ?? 0) + 1;

  try {
    const event = WhatsappWebhookEventSchema.parse(JSON.parse(marker.replayEvent ?? "null"));
    await dependencies.process(event, record.messageId);
    await dependencies.repository.markWebhookEventProcessed("whatsapp", parsed.data.eventId, { status: "processed" });
    log({ metric: "WHATSAPP_WEBHOOK_WORKER_OUTCOME", eventId: parsed.data.eventId, eventType: event.type, outcome: "processed" });
    return false;
  } catch (error) {
    const terminalOrphan =
      error instanceof WhatsappStatusMessageMissingError &&
      attemptCount >= ORPHAN_STATUS_MAX_ATTEMPTS;
    await dependencies.repository.markWebhookEventProcessed("whatsapp", parsed.data.eventId, {
      status: "failed",
      failureReason: terminalOrphan
        ? "WhatsApp status message was still missing after the retry budget was exhausted."
        : error instanceof Error ? error.message : "Webhook processing failed.",
      retryDisposition: terminalOrphan ? "terminal" : "retryable"
    });
    log({
      metric: "WHATSAPP_WEBHOOK_WORKER_OUTCOME",
      eventId: parsed.data.eventId,
      outcome: terminalOrphan ? "terminal_orphan_status" : "retryable_failure"
    });
    return !terminalOrphan;
  }
}

export function createWhatsappWebhookWorker(dependencies: WhatsappWebhookWorkerDependencies) {
  return async (event: SQSEvent) => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      if (await processRecord(record, dependencies)) batchItemFailures.push({ itemIdentifier: record.messageId });
    }
    return { batchItemFailures };
  };
}

export const handler = wrapLambdaHandler(async (event: SQSEvent) =>
  createWhatsappWebhookWorker(defaultDependencies())(event)
);
