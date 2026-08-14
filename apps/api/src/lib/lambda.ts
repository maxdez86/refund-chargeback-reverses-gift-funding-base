import type { Context } from "aws-lambda";

/**
 * Promise-based Lambda handler supported by the Node.js 24 managed runtime.
 * Callback-based three-argument handlers are intentionally not representable.
 */
export type AsyncLambdaHandler<TEvent, TResult> = (
  event: TEvent,
  context: Context
) => Promise<TResult>;
