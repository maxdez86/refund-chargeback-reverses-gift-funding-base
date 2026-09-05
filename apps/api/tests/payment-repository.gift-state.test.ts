import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { PaymentRepository } from "../src/services/dynamodb/repositories/payment-repository";

const nonFractionalGift = {
  id: "g-toalhas-banho",
  name: "4 Toalhas de Banho",
  image: "toalhas-banho",
  totalValueCents: 17_600,
  fractional: false as const,
  partValueCents: null,
  totalParts: null
};

function canceledTransaction(codes: string[]) {
  return new TransactionCanceledException({
    message: "cancelled",
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code }))
  });
}

describe("PaymentRepository gift state", () => {
  it("writes gift metadata items", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new PaymentRepository({ send } as never, "table-test");

    await repository.putGiftCatalogItems([
      {
        id: "g-toalhas-banho",
        name: "4 Toalhas de Banho",
        image: "toalhas-banho",
        totalValueCents: 17_600,
        fractional: false,
        partValueCents: null,
        totalParts: null
      }
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as PutCommand;
    expect(command.input.Item).toEqual(
      expect.objectContaining({
        PK: "GIFT#g-toalhas-banho",
        SK: "METADATA",
        entityType: "GiftMetadata",
        name: "4 Toalhas de Banho"
      })
    );
  });

  it("resets gift state items to zero", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new PaymentRepository({ send } as never, "table-test");

    await repository.resetGiftStateItems([
      {
        id: "g-toalhas-banho",
        name: "4 Toalhas de Banho",
        image: "toalhas-banho",
        totalValueCents: 17_600,
        fractional: false,
        partValueCents: null,
        totalParts: null
      }
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as PutCommand;
    expect(command.input.Item).toEqual(
      expect.objectContaining({
        PK: "GIFT#g-toalhas-banho",
        SK: "STATE",
        entityType: "GiftState",
        giftId: "g-toalhas-banho",
        partsFunded: 0,
        fullyFunded: false
      })
    );
  });

  it("lists stored gift state rows", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        {
          PK: "GIFT#g-armario",
          SK: "STATE",
          giftId: "g-armario",
          partsFunded: 2,
          fullyFunded: false,
          updatedAt: "2026-05-13T00:00:00.000Z"
        }
      ]
    });
    const repository = new PaymentRepository({ send } as never, "table-test");

    const states = await repository.listGiftStates();

    expect(send).toHaveBeenCalledWith(expect.any(ScanCommand));
    expect(states).toEqual([
      expect.objectContaining({
        giftId: "g-armario",
        partsFunded: 2,
        fullyFunded: false
      })
    ]);
  });

  it("lists stored gift metadata rows", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        {
          PK: "GIFT#g-armario",
          SK: "METADATA",
          id: "g-armario",
          name: "Armário de Cozinha",
          image: "armario-cozinha",
          totalValueCents: 174_900,
          fractional: true,
          partValueCents: 5_000,
          totalParts: 35
        }
      ]
    });
    const repository = new PaymentRepository({ send } as never, "table-test");

    const metadata = await repository.listGiftMetadata();

    expect(send).toHaveBeenCalledWith(expect.any(ScanCommand));
    expect(metadata).toEqual([
      expect.objectContaining({
        id: "g-armario",
        image: "armario-cozinha"
      })
    ]);
  });

  describe("batchGetGiftCatalog", () => {
    it("batch-reads metadata + state keys and routes items by sort key", async () => {
      const send = vi.fn().mockResolvedValue({
        Responses: {
          "table-test": [
            { PK: "GIFT#g-armario", SK: "METADATA", id: "g-armario", image: "armario-cozinha" },
            {
              PK: "GIFT#g-armario",
              SK: "STATE",
              giftId: "g-armario",
              partsFunded: 2,
              fullyFunded: false
            }
          ]
        }
      });
      const repository = new PaymentRepository({ send } as never, "table-test");

      const { metadata, states } = await repository.batchGetGiftCatalog(["g-armario"]);

      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0][0] as BatchGetCommand;
      expect(command).toBeInstanceOf(BatchGetCommand);
      expect(command.input.RequestItems?.["table-test"]?.Keys).toEqual([
        { PK: "GIFT#g-armario", SK: "METADATA" },
        { PK: "GIFT#g-armario", SK: "STATE" }
      ]);
      expect(metadata).toEqual([expect.objectContaining({ id: "g-armario" })]);
      expect(states).toEqual([expect.objectContaining({ giftId: "g-armario", partsFunded: 2 })]);
    });

    it("tolerates absent items (metadata without a state row) as normal gaps", async () => {
      const send = vi.fn().mockResolvedValue({
        Responses: {
          "table-test": [{ PK: "GIFT#g-armario", SK: "METADATA", id: "g-armario" }]
        }
      });
      const repository = new PaymentRepository({ send } as never, "table-test");

      const { metadata, states } = await repository.batchGetGiftCatalog(["g-armario"]);

      expect(metadata).toHaveLength(1);
      expect(states).toEqual([]);
    });

    it("retries only the unprocessed keys, then returns once they drain", async () => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({
          Responses: { "table-test": [{ PK: "GIFT#g-armario", SK: "METADATA", id: "g-armario" }] },
          UnprocessedKeys: { "table-test": { Keys: [{ PK: "GIFT#g-armario", SK: "STATE" }] } }
        })
        .mockResolvedValueOnce({
          Responses: {
            "table-test": [{ PK: "GIFT#g-armario", SK: "STATE", giftId: "g-armario", partsFunded: 1 }]
          }
        });
      const repository = new PaymentRepository({ send } as never, "table-test");

      const { metadata, states } = await repository.batchGetGiftCatalog(["g-armario"]);

      expect(send).toHaveBeenCalledTimes(2);
      const retryCommand = send.mock.calls[1][0] as BatchGetCommand;
      expect(retryCommand.input.RequestItems?.["table-test"]?.Keys).toEqual([
        { PK: "GIFT#g-armario", SK: "STATE" }
      ]);
      expect(metadata).toHaveLength(1);
      expect(states).toHaveLength(1);
    });

    it("fails only when unprocessed keys never drain after the retry budget", async () => {
      const send = vi.fn().mockResolvedValue({
        Responses: { "table-test": [] },
        UnprocessedKeys: { "table-test": { Keys: [{ PK: "GIFT#g-armario", SK: "STATE" }] } }
      });
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(repository.batchGetGiftCatalog(["g-armario"])).rejects.toThrow(/unprocessed/);
    });
  });

  it.each([
    ["funded", { partsFunded: 1, partsReserved: 0 }],
    ["reserved", { partsFunded: 0, partsReserved: 1 }]
  ])("rejects a non-fractional gift that is already %s", async (_case, counters) => {
    const send = vi.fn().mockResolvedValueOnce({
      Item: {
        giftId: nonFractionalGift.id,
        confirmedAmountCents: counters.partsFunded * nonFractionalGift.totalValueCents,
        reservedAmountCents: counters.partsReserved * nonFractionalGift.totalValueCents,
        fullyFunded: counters.partsFunded > 0,
        version: 1,
        updatedAt: "2026-06-12T11:00:00.000Z",
        ...counters
      }
    });
    const repository = new PaymentRepository({ send } as never, "table-test");

    await expect(
      repository.reserveGiftSelection({
        gift: nonFractionalGift,
        paymentId: "payment-unavailable",
        quantity: 1,
        expiresAt: "2026-06-12T12:00:00.000Z"
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("handles a partial legacy state row where partsReserved is omitted and gift is available", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          PK: "GIFT#g-toalhas-banho",
          SK: "STATE",
          giftId: nonFractionalGift.id,
          partsFunded: 0,
          fullyFunded: false,
          updatedAt: "2026-05-13T00:00:00.000Z"
        }
      })
      .mockResolvedValueOnce({});
    const repository = new PaymentRepository({ send } as never, "table-test");

    const selection = await repository.reserveGiftSelection({
      gift: nonFractionalGift,
      paymentId: "payment-partial-state",
      quantity: 1,
      expiresAt: "2026-06-12T12:00:00.000Z"
    });

    expect(selection).toEqual(
      expect.objectContaining({
        amountCents: nonFractionalGift.totalValueCents,
        quantity: 1
      })
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-fractional gift when partial legacy state row has partsFunded = 1 and partsReserved omitted", async () => {
    const send = vi.fn().mockResolvedValueOnce({
      Item: {
        PK: "GIFT#g-toalhas-banho",
        SK: "STATE",
        giftId: nonFractionalGift.id,
        partsFunded: 1,
        fullyFunded: true,
        updatedAt: "2026-05-13T00:00:00.000Z"
      }
    });
    const repository = new PaymentRepository({ send } as never, "table-test");

    await expect(
      repository.reserveGiftSelection({
        gift: nonFractionalGift,
        paymentId: "payment-partial-funded",
        quantity: 1,
        expiresAt: "2026-06-12T12:00:00.000Z"
      })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("maps an atomic non-fractional reservation race to 409", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          giftId: nonFractionalGift.id,
          partsFunded: 0,
          partsReserved: 0,
          confirmedAmountCents: 0,
          reservedAmountCents: 0,
          fullyFunded: false,
          version: 1,
          updatedAt: "2026-06-12T11:00:00.000Z"
        }
      })
      .mockRejectedValueOnce(canceledTransaction(["ConditionalCheckFailed", "None"]));
    const repository = new PaymentRepository({ send } as never, "table-test");

    await expect(
      repository.reserveGiftSelection({
        gift: nonFractionalGift,
        paymentId: "payment-race",
        quantity: 1,
        expiresAt: "2026-06-12T12:00:00.000Z"
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("does not misclassify a reservation transaction conflict as unavailable inventory", async () => {
    const conflict = canceledTransaction(["TransactionConflict", "None"]);
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          giftId: nonFractionalGift.id,
          partsFunded: 0,
          partsReserved: 0,
          confirmedAmountCents: 0,
          reservedAmountCents: 0,
          fullyFunded: false,
          version: 1,
          updatedAt: "2026-06-12T11:00:00.000Z"
        }
      })
      .mockRejectedValueOnce(conflict);
    const repository = new PaymentRepository({ send } as never, "table-test");

    await expect(
      repository.reserveGiftSelection({
        gift: nonFractionalGift,
        paymentId: "payment-conflict",
        quantity: 1,
        expiresAt: "2026-06-12T12:00:00.000Z"
      })
    ).rejects.toBe(conflict);
  });

  it("reserves against a legacy versionless gift state row", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          PK: "GIFT#g-pratos",
          SK: "STATE",
          giftId: "g-pratos",
          partsFunded: 0,
          fullyFunded: false,
          updatedAt: "2026-05-13T00:00:00.000Z"
        }
      })
      .mockResolvedValueOnce({});
    const repository = new PaymentRepository({ send } as never, "table-test");

    const selection = await repository.reserveGiftSelection({
      gift: {
        id: "g-pratos",
        name: "Jogo de Pratos 12 Peças",
        image: "jogo-pratos",
        totalValueCents: 33_100,
        fractional: true,
        partValueCents: 5_000,
        totalParts: 7,
        finalPartValueCents: null,
        fundingModelVersion: "LEGACY_FIXED_50"
      },
      paymentId: "payment-legacy-state",
      quantity: 1,
      expiresAt: "2026-06-12T20:00:00.000Z"
    });

    expect(selection).toEqual(
      expect.objectContaining({
        amountCents: 5_000,
        quantity: 1
      })
    );
    const transaction = send.mock.calls[1][0] as TransactWriteCommand;
    const stateUpdate = transaction.input.TransactItems?.[0]?.Update;

    expect(stateUpdate?.ConditionExpression).toContain("attribute_not_exists(version)");
    expect(stateUpdate?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":expectedVersion": 0,
        ":versionIncrement": 1
      })
    );
  });

  it("preserves the stored fullyFunded flag when reserving the final part", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          PK: "GIFT#g-pratos",
          SK: "STATE",
          giftId: "g-pratos",
          partsFunded: 0,
          partsReserved: 6,
          confirmedAmountCents: 0,
          reservedAmountCents: 30_000,
          fullyFunded: false,
          version: 6,
          updatedAt: "2026-05-13T00:00:00.000Z"
        }
      })
      .mockResolvedValueOnce({});
    const repository = new PaymentRepository({ send } as never, "table-test");

    await repository.reserveGiftSelection({
      gift: {
        id: "g-pratos",
        name: "Jogo de Pratos 12 Peças",
        image: "jogo-pratos",
        totalValueCents: 33_100,
        fractional: true,
        partValueCents: 5_000,
        totalParts: 7,
        finalPartValueCents: 3_100,
        fundingModelVersion: "EXACT_FINAL_QUOTA"
      },
      paymentId: "payment-final-part",
      quantity: 1,
      expiresAt: "2026-06-12T20:00:00.000Z"
    });

    const transaction = send.mock.calls[1][0] as TransactWriteCommand;
    const stateUpdate = transaction.input.TransactItems?.[0]?.Update;

    expect(stateUpdate?.UpdateExpression).toContain(
      "fullyFunded = if_not_exists(fullyFunded, :fullyFundedDefault)"
    );
    expect(stateUpdate?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":fullyFundedDefault": false
      })
    );
    expect(stateUpdate?.ExpressionAttributeValues).not.toHaveProperty(":fullyFunded");
  });

  it("resells a regular part at the regular price after a refund freed it while the final part stays funded", async () => {
    // 7 parts: six of R$50 and an exact final part of R$31. Everything sold,
    // then one regular part was refunded: counts say "one part left", money
    // says the remaining part is a regular one.
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          PK: "GIFT#g-pratos",
          SK: "STATE",
          giftId: "g-pratos",
          partsFunded: 6,
          partsReserved: 0,
          confirmedAmountCents: 28_100,
          reservedAmountCents: 0,
          fullyFunded: false,
          version: 9,
          updatedAt: "2026-05-13T00:00:00.000Z"
        }
      })
      .mockResolvedValueOnce({});
    const repository = new PaymentRepository({ send } as never, "table-test");

    const selection = await repository.reserveGiftSelection({
      gift: {
        id: "g-pratos",
        name: "Jogo de Pratos 12 Peças",
        image: "jogo-pratos",
        totalValueCents: 33_100,
        fractional: true,
        partValueCents: 5_000,
        totalParts: 7,
        finalPartValueCents: 3_100,
        fundingModelVersion: "EXACT_FINAL_QUOTA"
      },
      paymentId: "payment-resold-part",
      quantity: 1,
      expiresAt: "2026-06-12T20:00:00.000Z"
    });

    expect(selection).toEqual(
      expect.objectContaining({
        quantity: 1,
        quotaValuesCents: [5_000],
        amountCents: 5_000,
        unitAmountCents: 5_000
      })
    );
    const transaction = send.mock.calls[1][0] as TransactWriteCommand;
    const stateUpdate = transaction.input.TransactItems?.[0]?.Update;
    expect(stateUpdate?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({ ":amountIncrement": 5_000, ":expectedVersion": 9 })
    );
  });

  it("offers the exact final part again when the refunded part was the final one", async () => {
    // Same gift, but this time the refunded part was the R$31 final part and
    // the six regular parts stay sold: the only thing left is the final part.
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          PK: "GIFT#g-pratos",
          SK: "STATE",
          giftId: "g-pratos",
          partsFunded: 6,
          partsReserved: 0,
          confirmedAmountCents: 30_000,
          reservedAmountCents: 0,
          fullyFunded: false,
          version: 9,
          updatedAt: "2026-05-13T00:00:00.000Z"
        }
      })
      .mockResolvedValueOnce({});
    const repository = new PaymentRepository({ send } as never, "table-test");

    const selection = await repository.reserveGiftSelection({
      gift: {
        id: "g-pratos",
        name: "Jogo de Pratos 12 Peças",
        image: "jogo-pratos",
        totalValueCents: 33_100,
        fractional: true,
        partValueCents: 5_000,
        totalParts: 7,
        finalPartValueCents: 3_100,
        fundingModelVersion: "EXACT_FINAL_QUOTA"
      },
      paymentId: "payment-final-again",
      quantity: 1,
      expiresAt: "2026-06-12T20:00:00.000Z"
    });

    expect(selection).toEqual(
      expect.objectContaining({ quotaValuesCents: [3_100], amountCents: 3_100 })
    );
  });

  it("increments a single gift and marks it fully funded", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          id: "g-toalhas-banho",
          name: "4 Toalhas de Banho",
          image: "toalhas-banho",
          totalValueCents: 17_600,
          fractional: false,
          partValueCents: null,
          totalParts: null
        }
      })
      .mockResolvedValueOnce({
        Attributes: {
          partsFunded: 1
        }
      })
      .mockResolvedValueOnce({});
    const repository = new PaymentRepository({ send } as never, "table-test");

    await repository.incrementGiftFunding({
      giftId: "g-toalhas-banho",
      paymentId: "payment-1",
      quantity: 1
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    const incrementCommand = send.mock.calls[1][0] as UpdateCommand;
    const fullyFundedCommand = send.mock.calls[2][0] as UpdateCommand;

    expect(incrementCommand.input.Key).toEqual({
      PK: "GIFT#g-toalhas-banho",
      SK: "STATE"
    });
    expect(incrementCommand.input.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":incrementBy": 1,
        ":paymentId": "payment-1"
      })
    );
    expect(fullyFundedCommand.input.ExpressionAttributeValues).toEqual({
      ":fullyFunded": true
    });
  });

  it("increments a fractional gift by payment quantity without marking it fully funded early", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          id: "g-armario",
          name: "Armário de Cozinha",
          image: "armario-cozinha",
          totalValueCents: 174_900,
          fractional: true,
          partValueCents: 5_000,
          totalParts: 35
        }
      })
      .mockResolvedValueOnce({
        Attributes: {
          partsFunded: 3
        }
      });
    const repository = new PaymentRepository({ send } as never, "table-test");

    await repository.incrementGiftFunding({
      giftId: "g-armario",
      paymentId: "payment-2",
      quantity: 3
    });

    expect(send).toHaveBeenCalledTimes(2);
  });
});
