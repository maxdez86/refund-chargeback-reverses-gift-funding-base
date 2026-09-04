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

function transactionCancellationReasons(error: unknown) {
  if (!(error instanceof TransactionCanceledException) &&
      (error as { name?: string } | undefined)?.name !== "TransactionCanceledException") {
    return null;
  }

  return (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons ?? null;
}

/**
 * TransactionConflict is retryable, but only when every reported reason is a
 * conflict, an expected concurrent condition loss, or an untouched item. A
 * validation/throttling reason must continue through the normal error path.
 */
export function isTransactionConflictCancellation(error: unknown): boolean {
  const reasons = transactionCancellationReasons(error);
  if (!reasons?.some((reason) => reason.Code === "TransactionConflict")) {
    return false;
  }

  return reasons.every((reason) =>
    reason.Code === "None" ||
    reason.Code === "TransactionConflict" ||
    reason.Code === "ConditionalCheckFailed"
  );
}

/**
 * Classifies only the conditional failures that are safe race losses for a
 * transaction with a known item order. A condition failure on any other item
 * is an invariant failure and must remain visible to the caller.
 */
export function isExpectedConditionalTransactionCancellation(
  error: unknown,
  expectedIndexes: readonly number[]
): boolean {
  const reasons = transactionCancellationReasons(error);
  if (!reasons) {
    return false;
  }

  const expected = new Set(expectedIndexes);
  let sawConditionalFailure = false;

  for (const [index, reason] of reasons.entries()) {
    if (reason.Code === "None") {
      continue;
    }
    if (reason.Code !== "ConditionalCheckFailed" || !expected.has(index)) {
      return false;
    }
    sawConditionalFailure = true;
  }

  return sawConditionalFailure;
}
