import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { PaymentRepository } from "../src/services/dynamodb/repositories/payment-repository";

describe("PaymentRepository.listConfirmedPayerNamesByGiftIds", () => {
  it("filters successful payments, deduplicates names, and drains scan pages", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Items: [
          { gift: { id: "gift-1" }, payerName: "Maria Clara" },
          { gift: { id: "gift-1" }, payerName: "Maria Clara" },
          { gift: { id: "gift-2" }, payerName: "João Pedro" },
          { gift: { id: "gift-1" }, payerName: "" }
        ],
        LastEvaluatedKey: { PK: "PAYMENT#next", SK: "PAYMENT" }
      })
      .mockResolvedValueOnce({
        Items: [
          { gift: { id: "gift-1" }, payerName: "Ana Souza" },
          { gift: { id: "other" }, payerName: "Outra Pessoa" }
        ]
      });
    const repository = new PaymentRepository({ send } as never, "table-test");

    await expect(repository.listConfirmedPayerNamesByGiftIds(["gift-1", "gift-2"])).resolves.toEqual({
      "gift-1": ["Maria Clara", "Ana Souza"],
      "gift-2": ["João Pedro"]
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[0]?.[0] as ScanCommand).input).toMatchObject({
      TableName: "table-test",
      ProjectionExpression: "gift, payerName",
      FilterExpression: expect.stringContaining("#status IN (:confirmed, :received)")
    });
    expect((send.mock.calls[1]?.[0] as ScanCommand).input.ExclusiveStartKey).toEqual({
      PK: "PAYMENT#next",
      SK: "PAYMENT"
    });
  });

  it("returns empty arrays for requested gifts without a stored payer name", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        { gift: { id: "gift-1" } },
        { gift: { id: "gift-2" }, payerName: "   " }
      ]
    });
    const repository = new PaymentRepository({ send } as never, "table-test");

    await expect(repository.listConfirmedPayerNamesByGiftIds(["gift-1", "gift-2"])).resolves.toEqual({
      "gift-1": [],
      "gift-2": []
    });
  });
});
