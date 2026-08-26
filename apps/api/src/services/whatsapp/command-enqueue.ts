import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { WhatsappCommandInput } from "../dynamodb/whatsapp-items";

type CommandEnqueueRepository = {
  updateWhatsappCommand(
    commandId: string,
    values: Partial<Omit<WhatsappCommandInput, "commandId">>,
    condition?: { expression: string; names?: Record<string, string>; values?: Record<string, unknown> }
  ): Promise<void>;
};

type EnqueueResult = { status: "queued"; enqueuedAt: string };

/**
 * Records the publisher acknowledgement without overwriting a worker claim.
 * SQS can invoke the worker before the publisher's follow-up DynamoDB write.
 */
export async function recordWhatsappCommandEnqueued(
  repository: CommandEnqueueRepository,
  commandId: string,
  queued: EnqueueResult
): Promise<boolean> {
  try {
    await repository.updateWhatsappCommand(commandId, {
      status: queued.status,
      enqueuedAt: queued.enqueuedAt,
      updatedAt: queued.enqueuedAt
    }, {
      expression: "(#status = :queued OR #status = :queueUnavailable) AND attribute_not_exists(#startedAt)",
      names: { "#status": "status", "#startedAt": "startedAt" },
      values: { ":queued": "queued", ":queueUnavailable": "queue_unavailable" }
    });
    return true;
  } catch (error) {
    // The worker owns the row now. Its state must remain authoritative; the SQS
    // publish already succeeded, so a conditional conflict is a successful enqueue.
    if (error instanceof ConditionalCheckFailedException || (error as { name?: string } | undefined)?.name === "ConditionalCheckFailedException") {
      return false;
    }
    throw error;
  }
}
