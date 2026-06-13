import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { GuestMessage } from "@brimax/contracts";
import { getEnv } from "../../lib/env";
import { captureAwsClient, withTracedSubsegment } from "../../lib/xray";

const sqsClient = captureAwsClient(new SQSClient({}));

export type EnqueueResult = "accepted" | "skipped" | "failed";

/**
 * Enqueues a guest-message notification for the async notify worker to email.
 *
 * Kept off the request hot path: the create handler returns as soon as the
 * message is persisted and this enqueue accepts, instead of waiting on a
 * synchronous SES send. Delivery durability comes from the queue's redrive +
 * DLQ, so a transient SQS failure here surfaces (returns "failed") and the
 * caller decides whether to fail the request.
 *
 * When no queue is wired (local dev, unit tests) this is a no-op that returns
 * "skipped" so callers don't need to mock SQS.
 */
export async function enqueueGuestMessageNotification(message: GuestMessage): Promise<EnqueueResult> {
  const queueUrl = getEnv().guestMessageNotificationQueueUrl;

  if (!queueUrl) {
    return "skipped";
  }

  try {
    await withTracedSubsegment(
      "guest_message.enqueue_notification",
      {
        flow: "guest_message",
        entity_id: message.messageId
      },
      async () =>
        sqsClient.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(message)
          })
        )
    );

    return "accepted";
  } catch (error) {
    console.error(
      JSON.stringify({
        metric: "GUEST_MESSAGE_NOTIFICATION_ENQUEUE_FAILED",
        messageId: message.messageId,
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    );

    return "failed";
  }
}
