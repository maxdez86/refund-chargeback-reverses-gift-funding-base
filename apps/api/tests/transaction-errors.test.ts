import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { describe, expect, it } from "vitest";
import {
  isConditionalTransactionCancellation,
  isExpectedConditionalTransactionCancellation,
  isTransactionConflictCancellation
} from "../src/services/dynamodb/transaction-errors";

function canceledTransaction(codes: string[]) {
  return new TransactionCanceledException({
    message: "cancelled",
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code }))
  });
}

describe("transaction cancellation classification", () => {
  it("recognizes a DynamoDB conditional cancellation", () => {
    const error = new TransactionCanceledException({ message: "conditional", $metadata: {} });
    expect(isConditionalTransactionCancellation(error)).toBe(true);
  });

  it("recognizes cancellation reasons without relying on instanceof", () => {
    expect(isConditionalTransactionCancellation({
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }]
    })).toBe(true);
  });

  it("does not classify throttles or unrelated errors as races", () => {
    expect(isConditionalTransactionCancellation({
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "TransactionConflict" }]
    })).toBe(false);
    expect(isConditionalTransactionCancellation(new Error("Dynamo unavailable"))).toBe(false);
  });

  it("recognizes explicit transaction conflicts without swallowing unrelated reasons", () => {
    expect(
      isTransactionConflictCancellation(
        canceledTransaction(["None", "TransactionConflict", "ConditionalCheckFailed"])
      )
    ).toBe(true);
    expect(
      isTransactionConflictCancellation(
        canceledTransaction(["None", "TransactionConflict", "ValidationError"])
      )
    ).toBe(false);
    expect(isTransactionConflictCancellation(canceledTransaction(["None", "None"]))).toBe(false);
  });

  it("accepts conditional failures only at explicitly expected item indexes", () => {
    expect(
      isExpectedConditionalTransactionCancellation(
        canceledTransaction(["ConditionalCheckFailed", "None", "None"]),
        [0, 1]
      )
    ).toBe(true);
    expect(
      isExpectedConditionalTransactionCancellation(
        canceledTransaction(["None", "None", "ConditionalCheckFailed"]),
        [0, 1]
      )
    ).toBe(false);
    expect(
      isExpectedConditionalTransactionCancellation(
        canceledTransaction(["TransactionConflict", "None", "None"]),
        [0, 1]
      )
    ).toBe(false);
  });
});
