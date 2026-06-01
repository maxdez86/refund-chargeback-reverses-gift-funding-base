import type { SQSEvent } from "aws-lambda";
import { WebhookProcessor } from "../../domain/webhook-processor";
import { wrapLambdaHandler } from "../../lib/sentry";

const processor = new WebhookProcessor();

async function onProcessAsaasWebhook(event: SQSEvent) {
  for (const record of event.Records) {
    const message = JSON.parse(record.body) as { eventId: string };
    const result = await processor.processEvent(message.eventId);

    console.info(
      JSON.stringify({
        metric: "PAYMENT_STATE_TRANSITION",
        eventId: message.eventId,
        duplicate: result.duplicate
      })
    );
  }
}

export const handler = wrapLambdaHandler(onProcessAsaasWebhook);
