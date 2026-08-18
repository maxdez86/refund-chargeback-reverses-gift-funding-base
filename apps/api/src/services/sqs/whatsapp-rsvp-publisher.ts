import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { getEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { captureAwsClient } from "../../lib/xray";

const client = captureAwsClient(new SQSClient({}));
export async function enqueueWhatsappRsvp(commandId: string, _context?: { requestId: string }) {
  const queueUrl = getEnv().whatsappQueueUrl;
  if (!queueUrl) throw new AppError("WhatsApp queue is not configured.", 503, "QUEUE_UNAVAILABLE");
  const response = await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ commandId }) }));
  return { status: "queued" as const, enqueuedAt: new Date().toISOString(), messageId: response.MessageId };
}
