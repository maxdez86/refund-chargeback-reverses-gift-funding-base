import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { PaymentRepository } from "../src/services/dynamodb/repositories/payment-repository";

describe("PaymentRepository.markNotificationSent", () => {
  it("omits payload entries whose value is undefined", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new PaymentRepository({ send } as never, "table-test");

    // A PIX payment confirmed without a payer email: payerEmail is undefined.
    // The DocumentClient strips undefined values (removeUndefinedValues: true), so the
    // UpdateExpression must NOT reference :payerEmail, or DynamoDB rejects the whole update.
    await repository.markNotificationSent({
      paymentId: "payment-1",
      type: "COUPLE_MESSAGE",
      payload: {
        payerEmail: undefined
      }
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(command.input.UpdateExpression).toBe("SET #status = :status, sentAt = :sentAt");
    expect(command.input.ExpressionAttributeValues).not.toHaveProperty(":payerEmail");
    expect(command.input.ExpressionAttributeValues).toEqual(
      expect.objectContaining({ ":status": "SENT" })
    );
  });

  it("includes payload entries with defined values", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new PaymentRepository({ send } as never, "table-test");

    await repository.markNotificationSent({
      paymentId: "payment-2",
      type: "COUPLE_MESSAGE",
      payload: {
        payerEmail: "maria@example.com"
      }
    });

    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(command.input.UpdateExpression).toBe(
      "SET #status = :status, sentAt = :sentAt, payerEmail = :payerEmail"
    );
    expect(command.input.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":status": "SENT",
        ":payerEmail": "maria@example.com"
      })
    );
  });
});
