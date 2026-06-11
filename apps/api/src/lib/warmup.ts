import type { Handler } from "aws-lambda";

/**
 * EventBridge keep-warm pings carry `{ warmer: true }` — we fully control the
 * rule target input (see infra/cdk AppStack), so this check is unambiguous.
 */
export function isWarmupEvent(event: unknown): boolean {
  return typeof event === "object" && event !== null && (event as { warmer?: unknown }).warmer === true;
}

/**
 * Outer wrapper for keep-warm pings. Sits OUTSIDE wrapLambdaHandler so a ping
 * on a warm container skips per-invocation X-Ray subsegments and the Sentry
 * flush — pings never show up as `flow=*` traces or breadcrumbs.
 *
 * `onWarm` is a best-effort cache primer (e.g. refresh the app-secret bucket);
 * a failed prime must never fail the ping.
 */
export function withWarmup<TEvent, TResult>(
  handler: Handler<TEvent, TResult>,
  onWarm?: () => Promise<unknown>
): Handler<TEvent, TResult> {
  return async (event, context, callback) => {
    if (isWarmupEvent(event)) {
      try {
        await onWarm?.();
      } catch {
        // best-effort priming only
      }
      return { statusCode: 200, body: "warm" } as TResult;
    }

    return (await handler(event, context, callback)) as TResult;
  };
}
