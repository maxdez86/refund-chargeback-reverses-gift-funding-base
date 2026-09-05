import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { WebhookProcessor } from "../../domain/webhook-processor";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
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

  // Report failures per record: without this a single bad message fails the
  // whole batch of ten and redelivers the nine that already succeeded.
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
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
    } catch (error) {
      reportHandledError(error, {
        context: { messageId: record.messageId },
        metric: "WEBHOOK_RECORD_FAILED",
        statusCode: 500
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

export const handler = wrapLambdaHandler(onProcessAsaasWebhook);
