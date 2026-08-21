import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { describe, expect, it } from "vitest";
import { isConditionalTransactionCancellation } from "../src/services/dynamodb/transaction-errors";

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
});
