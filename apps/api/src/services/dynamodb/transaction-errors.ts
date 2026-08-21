import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";

/**
 * DynamoDB reports a failed condition inside TransactWriteItems as a
 * TransactionCanceledException. Keep the distinction from throttles and
 * transport failures at the boundary where callers decide whether a race won.
 */
export function isConditionalTransactionCancellation(error: unknown): boolean {
  if (!(error instanceof TransactionCanceledException) &&
      (error as { name?: string } | undefined)?.name !== "TransactionCanceledException") {
    return false;
  }

  const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> } | undefined)?.CancellationReasons;
  return reasons?.some((reason) => reason.Code === "ConditionalCheckFailed") ??
    // Some local doubles and SDK versions omit cancellation reasons. The
    // reservation transactions use only conditional failure as their expected
    // conflict outcome, so preserve name-based compatibility in that case.
    reasons === undefined;
}
