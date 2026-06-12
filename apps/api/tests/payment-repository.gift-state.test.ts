import {
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { PaymentRepository } from "../src/services/dynamodb/repositories/payment-repository";

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
