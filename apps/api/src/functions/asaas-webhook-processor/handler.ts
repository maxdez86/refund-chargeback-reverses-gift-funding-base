import type { SQSEvent } from "aws-lambda";
import { WebhookProcessor } from "../../domain/webhook-processor";
import { wrapLambdaHandler } from "../../lib/sentry";
import { annotateTrace, withTracedSubsegment } from "../../lib/xray";

const processor = new WebhookProcessor();
const PAYMENT_RESOLUTION_VERSION = "resolvePaymentForWebhook-v1";
let buildInfoLogged = false;

async function onProcessAsaasWebhook(event: SQSEvent) {
  if (!buildInfoLogged) {
    buildInfoLogged = true;
    console.info(
      JSON.stringify({
        metric: "WEBHOOK_PROCESSOR_BUILD_INFO",
        paymentResolutionVersion: PAYMENT_RESOLUTION_VERSION
      })
    );
  }

  for (const record of event.Records) {
    const message = JSON.parse(record.body) as { eventId: string };
    const result = await withTracedSubsegment(
      "webhook.process_event",
      {
        entity_id: message.eventId,
        flow: "webhook"
      },
      async () => processor.processEvent(message.eventId)
    );

    annotateTrace({
      duplicate: result.duplicate,
      entity_id: message.eventId,
      flow: "webhook"
    });

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
