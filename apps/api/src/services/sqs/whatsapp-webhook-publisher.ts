import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { getEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { captureAwsClient } from "../../lib/xray";

const client = captureAwsClient(new SQSClient({}));

export async function enqueueWhatsappWebhook(eventId: string) {
  const queueUrl = getEnv().whatsappWebhookQueueUrl;
  if (!queueUrl) throw new AppError("WhatsApp webhook queue is not configured.", 503, "QUEUE_UNAVAILABLE");
  return client.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ provider: "whatsapp", eventId })
  }));
}
