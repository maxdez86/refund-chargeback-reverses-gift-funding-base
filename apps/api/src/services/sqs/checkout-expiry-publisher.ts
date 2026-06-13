import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { getEnv } from "../../lib/env";
import { captureAwsClient, withTracedSubsegment } from "../../lib/xray";

// Best-effort acceleration only. The EventBridge rate(1 minute) schedule is the
// correctness floor; this trigger just lets a `GET /gifts` nudge the worker
// sooner. To avoid spamming SQS under read traffic, a single container fires at
// most once per cooldown window — the schedule covers everything in between.
const COOLDOWN_MS = 60_000;

const sqsClient = captureAwsClient(new SQSClient({}));

// Per-container timestamp of the last accepted enqueue. Reset across cold starts.
let lastEnqueuedAtMs = 0;

export type EnqueueResult = "accepted" | "skipped" | "failed";

export async function enqueueExpiryTrigger(
  source: string,
  nowMs: number = Date.now()
): Promise<EnqueueResult> {
  const queueUrl = getEnv().expiryQueueUrl;

  // No queue wired (e.g. local dev) — there is nothing to accelerate.
  if (!queueUrl) {
    return "skipped";
  }

  if (nowMs - lastEnqueuedAtMs < COOLDOWN_MS) {
    return "skipped";
  }

  // Stamp optimistically so concurrent reads in the same window are throttled.
  // A failed send is not rolled back: correctness never depends on this trigger
  // (the schedule still fires), so a brief gap is fine and avoids retry storms.
  lastEnqueuedAtMs = nowMs;

  try {
    await withTracedSubsegment(
      "checkout_expiry.enqueue_trigger",
      {
        flow: "checkout_expiry",
        source
      },
      async () =>
        sqsClient.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({ source, requestedAt: new Date(nowMs).toISOString() })
          })
        )
    );

    return "accepted";
  } catch (error) {
    console.warn(
      JSON.stringify({
        metric: "CHECKOUT_EXPIRY_TRIGGER_ENQUEUE_FAILED",
        source,
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    );

    return "failed";
  }
}

// Test seam: clears the in-module cooldown so suites can exercise it directly.
export function __resetExpiryTriggerCooldownForTests() {
  lastEnqueuedAtMs = 0;
}
