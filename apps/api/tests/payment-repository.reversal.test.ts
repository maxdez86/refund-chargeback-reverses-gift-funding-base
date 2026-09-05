import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentRepository } from "../src/services/dynamodb/repositories/payment-repository";

// Four parts: three regular of R$50 and an exact final part of R$31.
const exactGift = {
  id: "g-pratos",
  name: "Jogo de Pratos",
  image: "jogo-pratos",
  totalValueCents: 18_100,
  fractional: true,
  partValueCents: 5_000,
  totalParts: 4,
  finalPartValueCents: 3_100,
  fundingModelVersion: "EXACT_FINAL_QUOTA"
};

const singleGift = {
  id: "g-travesseiros",
  name: "Travesseiros",
  image: "travesseiros",
  totalValueCents: 10_000,
  fractional: false,
  partValueCents: null,
  totalParts: null
};

// One guest funded the first regular part; this payment funded the other
// two regular parts and the final part.
function multiPartReservation(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: "payment-multi",
    giftId: "g-pratos",
    quantity: 3,
    quotaValuesCents: [5_000, 5_000, 3_100],
    amountCents: 13_100,
    status: "CONSUMED",
    expiresAt: "2026-06-12T12:00:00.000Z",
    createdAt: "2026-06-12T11:00:00.000Z",
    updatedAt: "2026-06-12T11:00:00.000Z",
    ...overrides
  };
}

function fullyFundedState(overrides: Record<string, unknown> = {}) {
  return {
    giftId: "g-pratos",
    partsFunded: 4,
    partsReserved: 0,
    confirmedAmountCents: 18_100,
    reservedAmountCents: 0,
    fullyFunded: true,
    version: 7,
    updatedAt: "2026-06-12T11:30:00.000Z",
    ...overrides
  };
}

function canceledTransaction(codes: string[]) {
  return new TransactionCanceledException({
    $metadata: {},
    message: "Transaction cancelled",
    CancellationReasons: codes.map((code) => ({ Code: code }))
  });
}

function transactItems(send: ReturnType<typeof vi.fn>, callIndex: number) {
  const command = send.mock.calls[callIndex][0] as TransactWriteCommand;
  expect(command).toBeInstanceOf(TransactWriteCommand);
  return command.input.TransactItems ?? [];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PaymentRepository refund and chargeback reversal", () => {
  describe("partial refunds", () => {
    it("releases only the parts the refund pays back in full, counting from the end", async () => {
      // R$40 back out of R$131 fully covers the R$31 final part and no more.
      // The leftover R$9 is not enough to free a R$50 regular part: freeing it
      // would let the gift collect for that part a second time.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const send = vi
        .fn()
        .mockResolvedValueOnce({ Item: multiPartReservation() })
        .mockResolvedValueOnce({ Item: exactGift })
        .mockResolvedValueOnce({ Item: fullyFundedState() })
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-partial-1",
        paymentId: "payment-multi",
        expectedCurrentStatus: "RECEIVED",
        nextStatus: "RECEIVED",
        refundedAmountCents: 4_000
      });

      expect(applied).toBe(true);
      const items = transactItems(send, 3);
      // payment, reservation, gift state, webhook — no shell change while the
      // checkout still funds something.
      expect(items).toHaveLength(4);

      expect(items[0]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":status": "RECEIVED", ":refundedAmountCents": 4_000 })
      );
      expect(items[1]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ":observedStatus": "CONSUMED",
          ":observedReversedParts": 0,
          ":reservationStatus": "CONSUMED",
          ":reversedParts": 1,
          ":reversedAmountCents": 3_100
        })
      );
      expect(items[2]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ":partsDelta": 1,
          ":amountDelta": 3_100,
          ":fullyFunded": false,
          ":expectedVersion": 7
        })
      );
      expect(items[3]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":processingResult": "updated" })
      );

      // The R$9 that stays credited to the gift is money the guest got back.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"metric":"REFUND_NOT_PART_ALIGNED"')
      );
    });

    it("clamps a REFUNDED transition to the parts the refund actually covers", async () => {
      // Regression: REFUNDED used to zero every funded part regardless of the
      // amount, so a R$40 refund on a R$131 reservation freed all four parts.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const send = vi
        .fn()
        .mockResolvedValueOnce({ Item: multiPartReservation() })
        .mockResolvedValueOnce({ Item: exactGift })
        .mockResolvedValueOnce({ Item: fullyFundedState() })
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-refunded-partial",
        paymentId: "payment-multi",
        expectedCurrentStatus: "RECEIVED",
        nextStatus: "REFUNDED",
        refundedAmountCents: 4_000
      });

      expect(applied).toBe(true);
      const items = transactItems(send, 3);
      expect(items[1]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":reversedParts": 1, ":reversedAmountCents": 3_100 })
      );
      expect(items[2]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":partsDelta": 1, ":amountDelta": 3_100 })
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"metric":"REFUND_NOT_PART_ALIGNED"')
      );
    });

    it("still reverses every part when a REFUNDED transition carries no amount", async () => {
      // Asaas omits refunds[] on some PAYMENT_REFUNDED deliveries; zero means
      // "amount unknown", which must keep the full reversal.
      const send = vi
        .fn()
        .mockResolvedValueOnce({ Item: multiPartReservation() })
        .mockResolvedValueOnce({ Item: exactGift })
        .mockResolvedValueOnce({ Item: fullyFundedState() })
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-refunded-no-amount",
        paymentId: "payment-multi",
        expectedCurrentStatus: "RECEIVED",
        nextStatus: "REFUNDED"
      });

      expect(applied).toBe(true);
      const items = transactItems(send, 3);
      expect(items[1]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":reservationStatus": "REVERSED", ":reversedParts": 3 })
      );
      expect(items[2]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":partsDelta": 3, ":amountDelta": 13_100 })
      );
    });

    it("zeroes every part on a chargeback even when a partial amount is reported", async () => {
      // A chargeback takes the whole payment; the amount must not clamp it.
      const send = vi
        .fn()
        .mockResolvedValueOnce({ Item: multiPartReservation() })
        .mockResolvedValueOnce({ Item: exactGift })
        .mockResolvedValueOnce({ Item: fullyFundedState() })
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-chargeback-partial-amount",
        paymentId: "payment-multi",
        expectedCurrentStatus: "RECEIVED",
        nextStatus: "CHARGEBACK",
        refundedAmountCents: 4_000
      });

      expect(applied).toBe(true);
      const items = transactItems(send, 3);
      expect(items[1]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":reservationStatus": "REVERSED", ":reversedParts": 3 })
      );
      expect(items[2]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":partsDelta": 3, ":amountDelta": 13_100 })
      );
    });

    it("releases nothing more when a larger cumulative refund frees no further whole part", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const send = vi
        .fn()
        .mockResolvedValueOnce({
          Item: multiPartReservation({ reversedParts: 2, reversedAmountCents: 8_100 })
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-partial-2",
        paymentId: "payment-multi",
        expectedCurrentStatus: "RECEIVED",
        nextStatus: "RECEIVED",
        refundedAmountCents: 9_000
      });

      // R$90 fully covers the final part plus one regular part (R$81), both
      // already given back. The extra R$9 does not reach the next R$50 part,
      // so no further part is freed and this is a plain status update — the
      // old rounding would have released a whole R$50 part for it.
      expect(applied).toBe(true);
      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls[1][0]).toBeInstanceOf(UpdateCommand);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"metric":"REFUND_NOT_PART_ALIGNED"')
      );
    });

    it("turns a redelivered refund event into a plain status update", async () => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({
          Item: multiPartReservation({ reversedParts: 2, reversedAmountCents: 8_100 })
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-partial-1-again",
        paymentId: "payment-multi",
        expectedCurrentStatus: "RECEIVED",
        nextStatus: "RECEIVED",
        refundedAmountCents: 4_000
      });

      expect(applied).toBe(true);
      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls[1][0]).toBeInstanceOf(UpdateCommand);
    });

    it("gives back exactly the remaining parts when a full refund follows partial ones", async () => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({
          Item: multiPartReservation({ reversedParts: 2, reversedAmountCents: 8_100 })
        })
        .mockResolvedValueOnce({ Item: exactGift })
        .mockResolvedValueOnce({
          Item: fullyFundedState({ partsFunded: 2, confirmedAmountCents: 10_000, fullyFunded: false, version: 8 })
        })
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-full-after-partial",
        paymentId: "payment-multi",
        expectedCurrentStatus: "RECEIVED",
        nextStatus: "REFUNDED",
        refundedAmountCents: 13_100
      });

      expect(applied).toBe(true);
      const items = transactItems(send, 3);
      expect(items[0]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":status": "REFUNDED" })
      );
      expect(items[1]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":reservationStatus": "REVERSED", ":reversedParts": 3 })
      );
      expect(items[2]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":partsDelta": 1, ":amountDelta": 5_000 })
      );
    });
  });

  describe("dispute won after a chargeback", () => {
    it("re-funds the reversed parts when the gift still has room", async () => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({
          Item: multiPartReservation({ status: "REVERSED", reversedParts: 3, reversedAmountCents: 13_100 })
        })
        .mockResolvedValueOnce({ Item: exactGift })
        .mockResolvedValueOnce({
          Item: fullyFundedState({ partsFunded: 1, confirmedAmountCents: 5_000, fullyFunded: false, version: 8 })
        })
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-dispute-won",
        paymentId: "payment-multi",
        expectedCurrentStatus: "CHARGEBACK",
        nextStatus: "CONFIRMED"
      });

      expect(applied).toBe(true);
      const items = transactItems(send, 3);
      expect(items).toHaveLength(5);
      expect(items[0]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":status": "CONFIRMED", ":expectedCurrentStatus": "CHARGEBACK" })
      );
      expect(items[1]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ":observedStatus": "REVERSED",
          ":observedReversedParts": 3,
          ":reservationStatus": "CONSUMED",
          ":reversedParts": 0,
          ":reversedAmountCents": 0
        })
      );
      const giftState = items[2]?.Update;
      expect(giftState?.ConditionExpression).toBe(
        "attribute_exists(PK) AND ((attribute_not_exists(version) AND :expectedVersion = :zero) OR version = :expectedVersion)"
      );
      expect(giftState?.UpdateExpression).toContain("partsFunded = if_not_exists(partsFunded, :zero) + :partsDelta");
      expect(giftState?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ":partsDelta": 3,
          ":amountDelta": 13_100,
          ":fullyFunded": true,
          ":expectedVersion": 8,
          ":paymentId": "payment-multi"
        })
      );
      expect(items[3]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":shellStatus": "CHECKOUT_CONSUMED" })
      );
    });

    it("re-funds only the parts still paid for when a partial refund preceded the chargeback", async () => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({
          Item: multiPartReservation({ status: "REVERSED", reversedParts: 3, reversedAmountCents: 13_100 })
        })
        .mockResolvedValueOnce({ Item: exactGift })
        .mockResolvedValueOnce({
          Item: fullyFundedState({ partsFunded: 1, confirmedAmountCents: 5_000, fullyFunded: false, version: 8 })
        })
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-dispute-won-partial",
        paymentId: "payment-multi",
        expectedCurrentStatus: "CHARGEBACK",
        nextStatus: "CONFIRMED",
        refundedAmountCents: 4_000
      });

      // The R$40 refund fully paid back only the R$31 final part, so the two
      // regular parts come back with the won dispute.
      expect(applied).toBe(true);
      const items = transactItems(send, 3);
      expect(items[1]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({
          ":reservationStatus": "CONSUMED",
          ":reversedParts": 1,
          ":reversedAmountCents": 3_100
        })
      );
      expect(items[2]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":partsDelta": 2, ":amountDelta": 10_000, ":fullyFunded": false })
      );
    });

    it("confirms the payment but parks the reservation when the freed parts were resold", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const send = vi
        .fn()
        .mockResolvedValueOnce({
          Item: multiPartReservation({ status: "REVERSED", reversedParts: 3, reversedAmountCents: 13_100 })
        })
        .mockResolvedValueOnce({ Item: exactGift })
        // Two of the three freed parts were bought by someone else meanwhile.
        .mockResolvedValueOnce({
          Item: fullyFundedState({ partsFunded: 2, partsReserved: 1, confirmedAmountCents: 10_000, reservedAmountCents: 5_000, fullyFunded: false, version: 11 })
        })
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-dispute-won-resold",
        paymentId: "payment-multi",
        expectedCurrentStatus: "CHARGEBACK",
        nextStatus: "CONFIRMED"
      });

      expect(applied).toBe(true);
      const items = transactItems(send, 3);
      // payment, reservation, webhook — the gift counters are not touched.
      expect(items).toHaveLength(3);
      expect(items[0]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":status": "CONFIRMED" })
      );
      expect(items[1]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":observedStatus": "REVERSED", ":reservationStatus": "RECOVERY_HOLD" })
      );
      expect(items[2]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":processingResult": "updated" })
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"metric":"REVERSAL_REINSTATE_HELD"'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"reason":"slots"'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"partsAvailable":1'));
    });

    it("parks the reservation when the exact final part was resold during the dispute", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const send = vi
        .fn()
        .mockResolvedValueOnce({
          Item: multiPartReservation({ status: "REVERSED", reversedParts: 3, reversedAmountCents: 13_100 })
        })
        .mockResolvedValueOnce({ Item: exactGift })
        // Three slots are free by count, but the one part someone else bought
        // meanwhile is the R$31 exact final part — the very part this
        // reservation is trying to get back.
        .mockResolvedValueOnce({
          Item: fullyFundedState({
            partsFunded: 1,
            partsReserved: 0,
            confirmedAmountCents: 3_100,
            fullyFunded: false,
            version: 12
          })
        })
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-dispute-won-final-part-gone",
        paymentId: "payment-multi",
        expectedCurrentStatus: "CHARGEBACK",
        nextStatus: "CONFIRMED"
      });

      // The raw part count says there is room; the composition says there is
      // not. Re-funding would sell a R$50 slot at R$31 and leave the gift
      // permanently short of its total.
      expect(applied).toBe(true);
      const items = transactItems(send, 3);
      expect(items).toHaveLength(3);
      expect(items[1]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":observedStatus": "REVERSED", ":reservationStatus": "RECOVERY_HOLD" })
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"metric":"REVERSAL_REINSTATE_HELD"'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"reason":"final_part"'));
    });

    it("leaves a reservation the operator is holding alone", async () => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({
          Item: multiPartReservation({ status: "RECOVERY_HOLD", reversedParts: 3, reversedAmountCents: 13_100 })
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-received-after-hold",
        paymentId: "payment-multi",
        expectedCurrentStatus: "CONFIRMED",
        nextStatus: "RECEIVED"
      });

      expect(applied).toBe(true);
      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls[1][0]).toBeInstanceOf(UpdateCommand);
    });

    it("re-funds a single gift only while nobody else holds it", async () => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({
          Item: {
            paymentId: "payment-single",
            giftId: "g-travesseiros",
            quantity: 1,
            quotaValuesCents: [10_000],
            amountCents: 10_000,
            status: "REVERSED",
            reversedParts: 1,
            reversedAmountCents: 10_000,
            expiresAt: "2026-06-12T12:00:00.000Z",
            createdAt: "2026-06-12T11:00:00.000Z",
            updatedAt: "2026-06-12T11:00:00.000Z"
          }
        })
        .mockResolvedValueOnce({ Item: singleGift })
        .mockResolvedValueOnce({
          Item: {
            giftId: "g-travesseiros",
            partsFunded: 0,
            partsReserved: 0,
            confirmedAmountCents: 0,
            reservedAmountCents: 0,
            fullyFunded: false,
            version: 3,
            updatedAt: "2026-06-12T11:30:00.000Z"
          }
        })
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-single-dispute-won",
        paymentId: "payment-single",
        expectedCurrentStatus: "CHARGEBACK",
        nextStatus: "RECEIVED"
      });

      expect(applied).toBe(true);
      const items = transactItems(send, 3);
      expect(items[2]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":partsDelta": 1, ":amountDelta": 10_000, ":fullyFunded": true })
      );
    });
  });

  describe("concurrency", () => {
    it("re-reads and retries when another writer moved the gift-state version", async () => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({ Item: multiPartReservation() })
        .mockResolvedValueOnce({ Item: exactGift })
        .mockResolvedValueOnce({ Item: fullyFundedState({ version: 7 }) })
        // gift-state condition failed: someone else confirmed or released
        // on this gift between our read and our write.
        .mockRejectedValueOnce(canceledTransaction(["None", "None", "ConditionalCheckFailed", "None", "None"]))
        .mockResolvedValueOnce({ Item: fullyFundedState({ version: 8 }) })
        .mockResolvedValueOnce({ Item: fullyFundedState({ version: 8 }) })
        .mockResolvedValueOnce({});
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-refund-race",
        paymentId: "payment-multi",
        expectedCurrentStatus: "RECEIVED",
        nextStatus: "REFUNDED"
      });

      expect(applied).toBe(true);
      expect(send).toHaveBeenCalledTimes(7);
      expect(transactItems(send, 3)[2]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":expectedVersion": 7 })
      );
      expect(transactItems(send, 6)[2]?.Update?.ExpressionAttributeValues).toEqual(
        expect.objectContaining({ ":expectedVersion": 8 })
      );
    });

    it("reports a lost race instead of a second decrement when the reservation already moved", async () => {
      const send = vi
        .fn()
        .mockResolvedValueOnce({ Item: multiPartReservation() })
        .mockResolvedValueOnce({ Item: exactGift })
        .mockResolvedValueOnce({ Item: fullyFundedState() })
        .mockRejectedValueOnce(canceledTransaction(["None", "ConditionalCheckFailed", "None", "None", "None"]));
      const repository = new PaymentRepository({ send } as never, "table-test");

      const applied = await repository.applyWebhookUpdate({
        eventId: "event-refund-dup",
        paymentId: "payment-multi",
        expectedCurrentStatus: "RECEIVED",
        nextStatus: "REFUNDED"
      });

      expect(applied).toBe(false);
      expect(send).toHaveBeenCalledTimes(4);
    });
  });
});
