import type { SQSEvent } from "aws-lambda";
import { resolveRuntimeStage } from "../../lib/env";
import { sweepStaleCheckouts } from "../../domain/checkout-expiry";
import { wrapLambdaHandler } from "../../lib/sentry";
import { PaymentRepository } from "../../services/dynamodb/repositories/payment-repository";
import { annotateTrace, withTracedSubsegment } from "../../lib/xray";

const repository = new PaymentRepository();

// Pull a generous batch per invocation. With the EventBridge rate(1 minute)
// floor plus the GET /gifts trigger, a single sweep this size drains all
// realistic backlogs; hitting the cap is logged (and alarmed) rather than
// silently truncating.
const SWEEP_LIMIT = 100;
const SWEEP_CONCURRENCY = 4;

type ExpiryTriggerMessage = {
  source?: string;
};

function parseTrigger(body: string): ExpiryTriggerMessage {
  try {
    return JSON.parse(body) as ExpiryTriggerMessage;
  } catch {
    return {};
  }
}

async function onCheckoutExpiry(event: SQSEvent) {
  const stage = resolveRuntimeStage();

  for (const record of event.Records) {
    const message = parseTrigger(record.body);
    const source = message.source ?? "schedule";

    const summary = await withTracedSubsegment(
      "checkout_expiry.sweep",
      {
        entity_id: source,
        flow: "checkout_expiry"
      },
      async () =>
        sweepStaleCheckouts(repository, Date.now(), {
          limit: SWEEP_LIMIT,
          concurrency: SWEEP_CONCURRENCY,
          stage
        })
    );

    annotateTrace({
      flow: "checkout_expiry",
      released: summary.released,
      scanned: summary.scanned,
      source
    });

    console.info(
      JSON.stringify({
        metric: "CHECKOUT_EXPIRY_SWEEP_COMPLETED",
        stage,
        source,
        scanned: summary.scanned,
        released: summary.released,
        raceLost: summary.raceLost,
        protected: summary.protected,
        missingContext: summary.missingContext,
        failedCount: summary.failedIds.length,
        oldestStaleAgeMs: summary.oldestStaleAgeMs
      })
    );

    // A stale reservation under a PROCESSING/terminal payment is drift worth
    // surfacing, but it is not a retryable failure — do not throw on it.
    if (summary.protected > 0) {
      console.warn(
        JSON.stringify({
          metric: "CHECKOUT_EXPIRY_PROTECTED_STALE",
          stage,
          source,
          count: summary.protected
        })
      );
    }

    if (summary.scanned >= SWEEP_LIMIT) {
      console.warn(
        JSON.stringify({
          metric: "CHECKOUT_EXPIRY_SWEEP_CAP_HIT",
          stage,
          source,
          scanned: summary.scanned
        })
      );
    }

    // Throw so SQS redelivers (then DLQs after maxReceiveCount). race-lost and
    // protected outcomes are expected and are NOT failures.
    if (summary.failedIds.length > 0) {
      console.error(
        JSON.stringify({
          metric: "CHECKOUT_EXPIRY_SWEEP_FAILED",
          stage,
          source,
          failedCount: summary.failedIds.length
        })
      );

      throw new Error(
        `Checkout expiry sweep had ${summary.failedIds.length} retryable failure(s).`
      );
    }
  }
}

export const handler = wrapLambdaHandler(onCheckoutExpiry);
