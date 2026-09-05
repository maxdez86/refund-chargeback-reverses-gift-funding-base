import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentRepository } from "../src/services/dynamodb/repositories/payment-repository";

const giftItem = {
  id: "g-travesseiros",
  name: "Travesseiros",
  image: "travesseiros",
  totalValueCents: 10_000,
  fractional: false,
  partValueCents: null,
  totalParts: null
};

const giftStateItem = {
  giftId: "g-travesseiros",
  partsFunded: 0,
  partsReserved: 1,
  confirmedAmountCents: 0,
  reservedAmountCents: 10_000,
  fullyFunded: false,
  version: 1,
  updatedAt: "2026-06-12T11:00:00.000Z"
};

function reservationItem(status: string) {
  return {
    paymentId: "payment-1",
    giftId: "g-travesseiros",
    quantity: 1,
    quotaValuesCents: [10_000],
    amountCents: 10_000,
    status,
    expiresAt: "2026-06-12T12:00:00.000Z",
    createdAt: "2026-06-12T11:00:00.000Z",
    updatedAt: "2026-06-12T11:00:00.000Z"
  };
}

function canceledTransaction(codes: string[]) {
  return new TransactionCanceledException({
    $metadata: {},
    message: "Transaction cancelled",
    CancellationReasons: codes.map((code) => ({ Code: code }))
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PaymentRepository checkout expiry", () => {
  it("indexes new reservations under RESERVATION#OPEN with the checkout expiry", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: { ...giftStateItem, partsReserved: 0, reservedAmountCents: 0 }
      })
      .mockResolvedValueOnce({});
    const repository = new PaymentRepository({ send } as never, "table-test");

    await repository.reserveGiftSelection({
      gift: {
        ...giftItem,
        finalPartValueCents: null,
        fundingModelVersion: "LEGACY_FIXED_50"
      },
      paymentId: "payment-1",
      quantity: 1,
      expiresAt: "2026-06-12T12:00:00.000Z"
    });

    const transaction = send.mock.calls[1][0] as TransactWriteCommand;
    const reservationPut = transaction.input.TransactItems?.[1]?.Put;

    expect(reservationPut?.Item).toEqual(
      expect.objectContaining({
        PK: "PAYMENT#payment-1",
        SK: "RESERVATION",
        GSI1PK: "RESERVATION#OPEN",
        GSI1SK: "2026-06-12T12:00:00.000Z"
      })
    );
  });

  it("queries stale open reservations by cutoff on gsi1", async () => {
    const send = vi.fn().mockResolvedValue({ Items: [reservationItem("ACTIVE")] });
    const repository = new PaymentRepository({ send } as never, "table-test");

    const reservations = await repository.listStaleOpenReservations("2026-06-12T12:05:00.000Z");

    const command = send.mock.calls[0][0] as QueryCommand;
    expect(command.input).toEqual(
      expect.objectContaining({
        IndexName: "gsi1",
        KeyConditionExpression: "GSI1PK = :open AND GSI1SK < :cutoff",
        ExpressionAttributeValues: {
          ":open": "RESERVATION#OPEN",
          ":cutoff": "2026-06-12T12:05:00.000Z"
        },
        Limit: 25
      })
    );
    expect(reservations).toEqual([expect.objectContaining({ paymentId: "payment-1" })]);
  });

  describe("releaseReservationAfterCheckoutFailure", () => {
    function mockSendForRelease(shell: Record<string, unknown> | null) {
      return vi
        .fn()
        .mockResolvedValueOnce({ Item: reservationItem("ACTIVE") })
        .mockResolvedValueOnce({ Item: giftItem })
        .mockResolvedValueOnce({ Item: giftStateItem })
        .mockResolvedValueOnce({ Item: shell ?? undefined })
        .mockResolvedValueOnce({});
    }

    it("guards on payment non-existence, restricts to open statuses, and updates the shell", async () => {
      const send = mockSendForRelease({ paymentId: "payment-1", shellStatus: "CHECKOUT_READY" });
      const repository = new PaymentRepository({ send } as never, "table-test");

      const outcome = await repository.releaseReservationAfterCheckoutFailure("payment-1");

      expect(outcome).toBe("released");
      const transaction = send.mock.calls[4][0] as TransactWriteCommand;
      const items = transaction.input.TransactItems ?? [];

      expect(items).toHaveLength(4);
      // Orphan-release guard: the payment row must still not exist.
      expect(items[0]?.ConditionCheck).toEqual(
        expect.objectContaining({
          Key: { PK: "PAYMENT#payment-1", SK: "PAYMENT" },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );
      expect(items[1]?.Update?.Key).toEqual({ PK: "GIFT#g-travesseiros", SK: "STATE" });
      expect(items[2]?.Update?.ConditionExpression).toBe(
        "attribute_exists(PK) AND (#status = :pendingCheckout OR #status = :active)"
      );
      expect(items[2]?.Update?.UpdateExpression).toContain("REMOVE GSI1PK, GSI1SK");
      expect(items[3]?.Update?.Key).toEqual({ PK: "PAYMENT#payment-1", SK: "SHELL" });
    });

    it("omits the shell transact item when the shell row does not exist", async () => {
      const send = mockSendForRelease(null);
      const repository = new PaymentRepository({ send } as never, "table-test");

      const outcome = await repository.releaseReservationAfterCheckoutFailure("payment-1");

      expect(outcome).toBe("released");
      const transaction = send.mock.calls[4][0] as TransactWriteCommand;
      const items = transaction.input.TransactItems ?? [];

      expect(items).toHaveLength(3);
      expect(items[0]?.ConditionCheck?.Key).toEqual({ PK: "PAYMENT#payment-1", SK: "PAYMENT" });
      expect(items[1]?.Update?.Key).toEqual({ PK: "GIFT#g-travesseiros", SK: "STATE" });
      expect(items[2]?.Update?.Key).toEqual({ PK: "PAYMENT#payment-1", SK: "RESERVATION" });
    });

    it("returns missing-context without a transaction when the reservation is absent", async () => {
      const send = vi.fn().mockResolvedValueOnce({ Item: undefined });
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(repository.releaseReservationAfterCheckoutFailure("payment-1")).resolves.toBe(
        "missing-context"
      );
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("returns race-lost for an already-released reservation", async () => {
      const send = vi.fn().mockResolvedValueOnce({ Item: reservationItem("RELEASED") });
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(repository.releaseReservationAfterCheckoutFailure("payment-1")).resolves.toBe(
        "race-lost"
      );
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("protects funded and recovery-hold reservations from orphan release", async () => {
      const consumedSend = vi.fn().mockResolvedValueOnce({ Item: reservationItem("CONSUMED") });
      const consumedRepository = new PaymentRepository({ send: consumedSend } as never, "table-test");
      await expect(
        consumedRepository.releaseReservationAfterCheckoutFailure("payment-1")
      ).resolves.toBe("protected");
      expect(consumedSend).toHaveBeenCalledTimes(1);

      const holdSend = vi.fn().mockResolvedValueOnce({ Item: reservationItem("RECOVERY_HOLD") });
      const holdRepository = new PaymentRepository({ send: holdSend } as never, "table-test");
      await expect(
        holdRepository.releaseReservationAfterCheckoutFailure("payment-1")
      ).resolves.toBe("protected");
      expect(holdSend).toHaveBeenCalledTimes(1);
    });

    it("logs and returns race-lost on a cancellation caused only by condition checks", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const send = vi
        .fn()
        .mockResolvedValueOnce({ Item: reservationItem("ACTIVE") })
        .mockResolvedValueOnce({ Item: giftItem })
        .mockResolvedValueOnce({ Item: giftStateItem })
        .mockResolvedValueOnce({ Item: undefined })
        .mockRejectedValueOnce(canceledTransaction(["None", "None", "ConditionalCheckFailed"]));
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(repository.releaseReservationAfterCheckoutFailure("payment-1")).resolves.toBe(
        "race-lost"
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("\"metric\":\"RESERVATION_RELEASE_RACE_LOST\"")
      );
      warnSpy.mockRestore();
    });

    it.each([
      ["gift state", ["None", "ConditionalCheckFailed", "None"]],
      ["shell", ["None", "None", "None", "ConditionalCheckFailed"]]
    ])("rethrows an invariant failure on the %s item", async (_case, codes) => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({ Item: reservationItem("ACTIVE") })
        .mockResolvedValueOnce({ Item: giftItem })
        .mockResolvedValueOnce({ Item: giftStateItem })
        .mockResolvedValueOnce({ Item: { paymentId: "payment-1", shellStatus: "CHECKOUT_READY" } })
        .mockRejectedValueOnce(canceledTransaction(codes));
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(repository.releaseReservationAfterCheckoutFailure("payment-1")).rejects.toThrow(
        TransactionCanceledException
      );
    });

    it("retries a transaction conflict with fresh reads and then releases the reservation", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const send = vi.fn();
      for (const outcome of [
        canceledTransaction(["None", "TransactionConflict", "None"]),
        null
      ]) {
        send
          .mockResolvedValueOnce({ Item: reservationItem("ACTIVE") })
          .mockResolvedValueOnce({ Item: giftItem })
          .mockResolvedValueOnce({ Item: giftStateItem })
          .mockResolvedValueOnce({ Item: undefined });
        if (outcome) send.mockRejectedValueOnce(outcome);
        else send.mockResolvedValueOnce({});
      }
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(repository.releaseReservationAfterCheckoutFailure("payment-1")).resolves.toBe(
        "released"
      );
      expect(send).toHaveBeenCalledTimes(10);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"metric":"CHECKOUT_EXPIRY_TRANSACTION_CONFLICT_RETRY"')
      );
    });
  });

  describe("discardPendingPayment", () => {
    function mockSendForDiscard() {
      return vi
        .fn()
        .mockResolvedValueOnce({ Item: reservationItem("ACTIVE") })
        .mockResolvedValueOnce({
          Item: {
            paymentId: "payment-1",
            shellStatus: "CHECKOUT_READY",
            asaasCheckoutId: "checkout-1"
          }
        })
        .mockResolvedValueOnce({ Item: giftItem })
        .mockResolvedValueOnce({ Item: giftStateItem })
        .mockResolvedValueOnce({});
    }

    it("atomically cancels payment, releases checkout state, and restores gift counters", async () => {
      const send = mockSendForDiscard();
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(
        repository.discardPendingPayment({
          paymentId: "payment-1",
          expectedPaymentStatus: "AWAITING_PAYMENT",
          expectedReservationStatus: "ACTIVE",
          expectedShellStatus: "CHECKOUT_READY"
        })
      ).resolves.toBe(true);

      const transaction = send.mock.calls[4][0] as TransactWriteCommand;
      const items = transaction.input.TransactItems ?? [];

      expect(items).toHaveLength(4);
      expect(items[0]?.Update).toEqual(
        expect.objectContaining({
          Key: { PK: "PAYMENT#payment-1", SK: "PAYMENT" },
          ConditionExpression: "attribute_exists(PK) AND #status = :expectedStatus"
        })
      );
      expect(items[1]?.Update?.UpdateExpression).toContain("REMOVE GSI1PK, GSI1SK");
      expect(items[2]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":shellStatus": "CHECKOUT_RELEASED" })
      );
      expect(items[3]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ":partsDelta": 1,
          ":amountDelta": 10_000
        })
      );
    });

    it("returns false when a webhook wins a transaction condition", async () => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({ Item: reservationItem("ACTIVE") })
        .mockResolvedValueOnce({
          Item: {
            paymentId: "payment-1",
            shellStatus: "CHECKOUT_READY",
            asaasCheckoutId: "checkout-1"
          }
        })
        .mockResolvedValueOnce({ Item: giftItem })
        .mockResolvedValueOnce({ Item: giftStateItem })
        .mockRejectedValueOnce(
          canceledTransaction(["ConditionalCheckFailed", "None", "None", "None"])
        );
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(
        repository.discardPendingPayment({
          paymentId: "payment-1",
          expectedPaymentStatus: "CREATED",
          expectedReservationStatus: "ACTIVE",
          expectedShellStatus: "CHECKOUT_READY"
        })
      ).resolves.toBe(false);
    });
  });

  describe("applyWebhookUpdate reservation guards", () => {
    function mockSendForWebhookUpdate(reservationStatus: string) {
      return vi
        .fn()
        .mockResolvedValueOnce({ Item: reservationItem(reservationStatus) })
        .mockResolvedValueOnce({ Item: giftItem })
        .mockResolvedValueOnce({ Item: giftStateItem })
        .mockResolvedValueOnce({});
    }

    it("guards the release branch on the reservation status and clears the open index", async () => {
      const send = mockSendForWebhookUpdate("ACTIVE");
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-1",
        paymentId: "payment-1",
        expectedCurrentStatus: "AWAITING_PAYMENT",
        nextStatus: "EXPIRED",
        asaasCheckoutId: "checkout-1"
      });

      expect(applied).toBe(true);
      const transaction = send.mock.calls[3][0] as TransactWriteCommand;
      const reservationUpdate = transaction.input.TransactItems?.[1]?.Update;

      expect(reservationUpdate?.ConditionExpression).toBe(
        "attribute_exists(PK) AND #status <> :released AND #status <> :consumed"
      );
      expect(reservationUpdate?.UpdateExpression).toContain("REMOVE GSI1PK, GSI1SK");
      expect(reservationUpdate?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ":reservationStatus": "RELEASED"
        })
      );
    });

    it("guards the consume branch on the observed reservation status", async () => {
      const send = mockSendForWebhookUpdate("ACTIVE");
      const repository = new PaymentRepository({ send } as never, "table-test");

      await repository.applyWebhookUpdate({
        eventId: "event-1",
        paymentId: "payment-1",
        expectedCurrentStatus: "AWAITING_PAYMENT",
        nextStatus: "CONFIRMED",
        asaasPaymentId: "pay_asaas_1"
      });

      const transaction = send.mock.calls[3][0] as TransactWriteCommand;
      const paymentUpdate = transaction.input.TransactItems?.[0]?.Update;
      const reservationUpdate = transaction.input.TransactItems?.[1]?.Update;
      const giftStateUpdate = transaction.input.TransactItems?.[2]?.Update;

      expect(reservationUpdate?.ConditionExpression).toBe("#status = :observedReservationStatus");
      expect(reservationUpdate?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ":observedReservationStatus": "ACTIVE",
          ":reservationStatus": "CONSUMED"
        })
      );
      expect(reservationUpdate?.UpdateExpression).toContain("REMOVE GSI1PK, GSI1SK");
      // The payment item keeps its own GSI1 attributes for the Asaas lookup.
      expect(paymentUpdate?.UpdateExpression).toContain("GSI1PK = :gsi1pk");
      expect(giftStateUpdate?.UpdateExpression).toContain("partsReserved =");
    });

    it("moves only funded counters when a confirmation lands after the reservation was released", async () => {
      const send = mockSendForWebhookUpdate("RELEASED");
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        paymentId: "payment-1",
        expectedCurrentStatus: "EXPIRED",
        nextStatus: "CONFIRMED"
      });

      expect(applied).toBe(true);
      const transaction = send.mock.calls[3][0] as TransactWriteCommand;
      const reservationUpdate = transaction.input.TransactItems?.[1]?.Update;
      const giftStateUpdate = transaction.input.TransactItems?.[2]?.Update;

      expect(reservationUpdate?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ":observedReservationStatus": "RELEASED"
        })
      );
      expect(giftStateUpdate?.UpdateExpression).not.toContain("partsReserved =");
      expect(giftStateUpdate?.UpdateExpression).not.toContain("reservedAmountCents =");
      expect(giftStateUpdate?.UpdateExpression).toContain("partsFunded =");
      expect(giftStateUpdate?.UpdateExpression).toContain("confirmedAmountCents =");
    });
  });

  describe("tryExpireStalePayment", () => {
    function queueAttempt(
      send: ReturnType<typeof vi.fn>,
      outcome: object | Error
    ) {
      send
        .mockResolvedValueOnce({ Item: reservationItem("ACTIVE") })
        .mockResolvedValueOnce({ Item: giftItem })
        .mockResolvedValueOnce({ Item: giftStateItem });
      if (outcome instanceof Error) send.mockRejectedValueOnce(outcome);
      else send.mockResolvedValueOnce(outcome);
    }

    it.each([
      ["payment", ["ConditionalCheckFailed", "None", "None", "None"]],
      ["reservation", ["None", "ConditionalCheckFailed", "None", "None"]]
    ])("returns false when the %s condition loses a race", async (_case, codes) => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({ Item: reservationItem("ACTIVE") })
        .mockResolvedValueOnce({ Item: giftItem })
        .mockResolvedValueOnce({ Item: giftStateItem })
        .mockRejectedValueOnce(canceledTransaction(codes));
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(
        repository.tryExpireStalePayment({
          paymentId: "payment-1",
          expectedCurrentStatus: "AWAITING_PAYMENT"
        })
      ).resolves.toBe(false);
    });

    it.each([
      ["gift state", ["None", "None", "ConditionalCheckFailed", "None"]],
      ["shell", ["None", "None", "None", "ConditionalCheckFailed"]]
    ])("rethrows an invariant failure on the %s item", async (_case, codes) => {
      const send = vi.fn();
      queueAttempt(send, canceledTransaction(codes));
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(
        repository.tryExpireStalePayment({
          paymentId: "payment-1",
          expectedCurrentStatus: "AWAITING_PAYMENT"
        })
      ).rejects.toThrow(TransactionCanceledException);
    });

    it("retries a conflict with fresh reads and then expires the payment", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const send = vi.fn();
      queueAttempt(send, canceledTransaction(["TransactionConflict", "None", "None", "None"]));
      queueAttempt(send, {});
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(
        repository.tryExpireStalePayment({
          paymentId: "payment-1",
          expectedCurrentStatus: "AWAITING_PAYMENT"
        })
      ).resolves.toBe(true);
      expect(send).toHaveBeenCalledTimes(8);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"operation":"expire_payment"')
      );
    });

    it("returns race-lost when a conflict retry observes another winner", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const send = vi.fn();
      queueAttempt(send, canceledTransaction(["TransactionConflict", "None", "None", "None"]));
      queueAttempt(send, canceledTransaction(["ConditionalCheckFailed", "None", "None", "None"]));
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(
        repository.tryExpireStalePayment({
          paymentId: "payment-1",
          expectedCurrentStatus: "AWAITING_PAYMENT"
        })
      ).resolves.toBe(false);
      expect(send).toHaveBeenCalledTimes(8);
    });

    it("propagates the fourth consecutive transaction conflict", async () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const send = vi.fn();
      const conflicts = Array.from({ length: 4 }, () =>
        canceledTransaction(["TransactionConflict", "None", "None", "None"])
      );
      conflicts.forEach((conflict) => queueAttempt(send, conflict));
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(
        repository.tryExpireStalePayment({
          paymentId: "payment-1",
          expectedCurrentStatus: "AWAITING_PAYMENT"
        })
      ).rejects.toBe(conflicts[3]);
      expect(send).toHaveBeenCalledTimes(16);
    });

    it("does not retry a non-conflict failure", async () => {
      const failure = new Error("Dynamo unavailable");
      const send = vi.fn();
      queueAttempt(send, failure);
      const repository = new PaymentRepository({ send } as never, "table-test");

      await expect(
        repository.tryExpireStalePayment({
          paymentId: "payment-1",
          expectedCurrentStatus: "AWAITING_PAYMENT"
        })
      ).rejects.toBe(failure);
      expect(send).toHaveBeenCalledTimes(4);
    });
  });

  describe("repairFinalizedPayment", () => {
    const repairedPayment = {
      paymentId: "payment-1",
      paymentMethod: "PIX",
      status: "CREATED",
      amountCents: 10_000,
      currency: "BRL",
      gift: {
        id: "g-travesseiros",
        name: "Travesseiros",
        fractional: false,
        quantity: 1,
        unitAmountCents: null,
        amountCents: 10_000
      },
      createdAt: "2026-06-12T11:00:00.000Z",
      updatedAt: "2026-06-12T11:00:00.000Z",
      customerProfileStatus: "PENDING"
    };

    it("keeps a released reservation released instead of resurrecting it", async () => {
      const send = vi.fn().mockResolvedValue({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      await repository.repairFinalizedPayment({
        payment: repairedPayment as never,
        asaasCheckoutId: "checkout-1",
        reservationStatus: "RELEASED"
      });

      const transaction = send.mock.calls[0][0] as TransactWriteCommand;
      const reservationUpdate = transaction.input.TransactItems?.[2]?.Update;

      expect(reservationUpdate?.UpdateExpression).toBe(
        "SET asaasCheckoutId = :asaasCheckoutId, updatedAt = :updatedAt"
      );
      expect(reservationUpdate?.ExpressionAttributeValues).not.toHaveProperty(":status");
    });

    it("still re-activates the reservation when it is held", async () => {
      const send = vi.fn().mockResolvedValue({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      await repository.repairFinalizedPayment({
        payment: repairedPayment as never,
        asaasCheckoutId: "checkout-1",
        reservationStatus: "PENDING_CHECKOUT"
      });

      const transaction = send.mock.calls[0][0] as TransactWriteCommand;
      const reservationUpdate = transaction.input.TransactItems?.[2]?.Update;

      expect(reservationUpdate?.UpdateExpression).toContain("#status = :status");
      expect(reservationUpdate?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ":status": "ACTIVE"
        })
      );
    });
  });
});
