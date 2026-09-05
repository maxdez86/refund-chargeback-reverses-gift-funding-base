import {
  ConditionalCheckFailedException,
  TransactionCanceledException
} from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient
} from "@aws-sdk/lib-dynamodb";
import { PAYMENT_GIFTS_BY_ID, type PaymentGift } from "@brimax/config";
import type { PaymentStatus, PaymentSummary } from "@brimax/contracts";
import { dynamoDbDocumentClient } from "../client";
import { getEnv } from "../../../lib/env";
import { AppError } from "../../../lib/errors";
import { createTracedAwsClient } from "../../../lib/xray";
import {
  isConditionalTransactionCancellation,
  isExpectedConditionalTransactionCancellation,
  isTransactionConflictCancellation
} from "../transaction-errors";
import {
  giftStateKeys,
  giftMetadataKeys,
  asaasCheckoutLookupIndex,
  asaasPaymentLookupIndex,
  idempotencyKeys,
  paymentMessageKeys,
  paymentNotificationKeys,
  paymentKeys,
  paymentReservationKeys,
  paymentShellKeys,
  reservationOpenIndex,
  webhookKeys
} from "../key-builder";
import { GSI1_NAME, TTL_ATTRIBUTE } from "../table";

type StoredPayment = PaymentSummary & {
  asaasPaymentId?: string;
  asaasCheckoutId?: string;
  checkoutPrefillMode?: "CUSTOMER_DATA_EMAIL" | "NO_PREFILL";
  asaasCustomerId?: string;
  customerProfileStatus?: "PENDING" | "READY" | "FAILED";
  payerName?: string;
  externalReference?: string;
  payerEmail?: string;
  customerProfileUpdatedAt?: string;
};

export type StoredPaymentReservationStatus =
  | "PENDING_CHECKOUT"
  | "ACTIVE"
  | "CONSUMED"
  | "RELEASED"
  // Funded parts given back by a refund or chargeback. Unlike RELEASED (an
  // open checkout that expired) the parts were funded, so a won dispute may
  // re-fund them; orphan cleanup must never touch it.
  | "REVERSED"
  | "RECOVERY_HOLD";

// Per-item outcome of an orphan-reservation release, so the sweep can tally
// metrics and decide what (if anything) is a retryable failure.
//   released        — the reservation was moved to RELEASED and parts freed.
//   race-lost       — another writer won (already released / condition failed).
//   protected       — funded or deliberately held; must not be auto-released.
//   missing-context — reservation/gift rows absent; nothing to release.
export type ReservationReleaseOutcome = "released" | "race-lost" | "protected" | "missing-context";

export type StoredPaymentReservation = {
  paymentId: string;
  giftId: string;
  quantity: number;
  quotaValuesCents: number[];
  amountCents: number;
  status: StoredPaymentReservationStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  asaasCheckoutId?: string;
  // Reversal bookkeeping: how many parts (counted from the end of
  // quotaValuesCents) are no longer funded, and their summed value. Absent on
  // reservations that never saw a refund or chargeback.
  reversedParts?: number;
  reversedAmountCents?: number;
};

export type StoredPaymentShellStatus =
  | "CHECKOUT_CREATING"
  | "CHECKOUT_REMOTE_AMBIGUOUS"
  | "CHECKOUT_READY"
  | "CHECKOUT_RELEASED"
  | "CHECKOUT_CONSUMED";

export type StoredPaymentShell = {
  paymentId: string;
  giftId: string;
  amountCents: number;
  quotaValuesCents: number[];
  paymentMethod: PaymentSummary["paymentMethod"];
  externalReference: string;
  shellStatus: StoredPaymentShellStatus;
  createdAt: string;
  updatedAt: string;
  asaasCheckoutId?: string;
  checkoutUrl?: string;
  checkoutExpiresAt?: string;
};

type StoredPaymentMessage = {
  paymentId: string;
  body: string;
  submittedAt: string;
  payerEmail?: string;
  payerName?: string;
  giftName: string;
};

const RAW_WEBHOOK_PAYLOAD_MAX_BYTES = 350 * 1024;
const CHECKOUT_CLEANUP_MAX_ATTEMPTS = 4;
const CHECKOUT_CLEANUP_RETRY_BASE_MS = 50;

type StoredWebhookEvent = {
  eventId: string;
  eventType: string;
  payload: string;
  payloadTruncated?: boolean;
  asaasPaymentId?: string;
  asaasCheckoutId?: string;
  externalReference?: string;
  processedAt?: string;
};

export type StoredGiftState = {
  giftId: string;
  partsFunded: number;
  partsReserved: number;
  confirmedAmountCents: number;
  reservedAmountCents: number;
  fullyFunded: boolean;
  version: number;
  updatedAt: string;
  lastConfirmedPaymentId?: string;
};

export type StoredGiftMetadata = PaymentGift;

type IdempotencyReservation = {
  fingerprint: string;
  paymentId: string;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  paymentSnapshot?: PaymentSummary;
};

type ReservedQuotaSelection = {
  quantity: number;
  quotaValuesCents: number[];
  amountCents: number;
  unitAmountCents: number | null;
  mixedValues: boolean;
};

function defaultGiftState(giftId: string): StoredGiftState {
  return {
    giftId,
    partsFunded: 0,
    partsReserved: 0,
    confirmedAmountCents: 0,
    reservedAmountCents: 0,
    fullyFunded: false,
    version: 0,
    updatedAt: new Date(0).toISOString()
  };
}

function sumQuotaValues(quotaValuesCents: number[]) {
  return quotaValuesCents.reduce((sum, value) => sum + value, 0);
}

function getAvailableParts(gift: PaymentGift, state: StoredGiftState) {
  const partsFunded = state.partsFunded ?? 0;
  const partsReserved = state.partsReserved ?? 0;
  if (gift.fractional) {
    return Math.max(0, (gift.totalParts ?? 0) - partsFunded - partsReserved);
  }

  return Math.max(0, 1 - partsFunded - partsReserved);
}

// Whether the single exact-value final part of an EXACT_FINAL_QUOTA gift is
// currently taken. Which parts are sold is a question about money, not counts:
// after a refund frees a regular part while the final part stays funded, the
// counters alone say "one part left" and would price it as the final part.
function isFinalPartSold(gift: PaymentGift, state: StoredGiftState): boolean {
  if (gift.fundingModelVersion !== "EXACT_FINAL_QUOTA" || !gift.partValueCents || !gift.finalPartValueCents) {
    return false;
  }

  const soldParts = (state.partsFunded ?? 0) + (state.partsReserved ?? 0);
  const soldAmountCents = (state.confirmedAmountCents ?? 0) + (state.reservedAmountCents ?? 0);

  return soldParts > 0 && soldAmountCents === (soldParts - 1) * gift.partValueCents + gift.finalPartValueCents;
}

function buildQuotaSelection(gift: PaymentGift, state: StoredGiftState, quantity: number): ReservedQuotaSelection {
  if (!gift.fractional) {
    if (quantity !== 1) {
      throw new AppError("This gift does not allow fractional contributions.", 400);
    }
    if (getAvailableParts(gift, state) < 1) {
      throw new AppError("Requested quantity exceeds the available gift parts.", 409);
    }

    return {
      quantity: 1,
      quotaValuesCents: [gift.totalValueCents],
      amountCents: gift.totalValueCents,
      unitAmountCents: null,
      mixedValues: false
    };
  }

  const availableParts = getAvailableParts(gift, state);
  if (quantity > availableParts) {
    throw new AppError("Requested quantity exceeds the available gift parts.", 409);
  }

  if (!gift.partValueCents || !gift.totalParts) {
    throw new AppError("Gift configuration is invalid.", 500);
  }

  if (gift.fundingModelVersion !== "EXACT_FINAL_QUOTA" || !gift.finalPartValueCents) {
    const quotaValuesCents = Array.from({ length: quantity }, () => gift.partValueCents as number);
    return {
      quantity,
      quotaValuesCents,
      amountCents: sumQuotaValues(quotaValuesCents),
      unitAmountCents: gift.partValueCents,
      mixedValues: false
    };
  }

  const regularPartsTotal = Math.max(0, gift.totalParts - 1);
  const soldParts = (state.partsFunded ?? 0) + (state.partsReserved ?? 0);
  const finalPartSold = isFinalPartSold(gift, state);
  const regularPartsSold = soldParts - (finalPartSold ? 1 : 0);
  const regularPartsRemaining = Math.max(0, regularPartsTotal - regularPartsSold);
  const regularPartsToTake = Math.min(quantity, regularPartsRemaining);
  const finalPartsToTake = quantity - regularPartsToTake;

  if (finalPartsToTake > 1 || (finalPartsToTake === 1 && finalPartSold)) {
    throw new AppError("Requested quantity exceeds the available exact-value quota composition.", 409);
  }

  const quotaValuesCents = [
    ...Array.from({ length: regularPartsToTake }, () => gift.partValueCents as number),
    ...Array.from({ length: finalPartsToTake }, () => gift.finalPartValueCents as number)
  ];
  const uniqueValues = new Set(quotaValuesCents);

  return {
    quantity,
    quotaValuesCents,
    amountCents: sumQuotaValues(quotaValuesCents),
    unitAmountCents: uniqueValues.size === 1 ? quotaValuesCents[0] ?? null : null,
    mixedValues: uniqueValues.size > 1
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A transaction canceled purely by condition checks means another writer won a
// race we guard against — safe to treat as "lost the race". Any other reason
// (TransactionConflict, throttling, validation) must keep propagating.
function isConditionalCheckOnlyCancellation(error: TransactionCanceledException) {
  const reasons = error.CancellationReasons ?? [];
  return (
    reasons.length > 0 &&
    reasons.every((reason) => reason.Code === "ConditionalCheckFailed" || reason.Code === "None")
  );
}

function buildGiftReservationReleaseUpdate(input: {
  amountCents: number;
  gift: StoredGiftMetadata;
  giftId: string;
  now: string;
  quantity: number;
  state: StoredGiftState;
  tableName: string;
}) {
  const fullyFundedThreshold = input.gift.fractional ? (input.gift.totalParts ?? 0) : 1;
  const fullyFunded =
    input.state.confirmedAmountCents >= input.gift.totalValueCents ||
    input.state.partsFunded >= fullyFundedThreshold;

  return {
    Update: {
      TableName: input.tableName,
      Key: giftStateKeys(input.giftId),
      ConditionExpression:
        "attribute_exists(PK) AND partsReserved >= :partsDelta AND reservedAmountCents >= :amountDelta",
      UpdateExpression:
        "SET partsReserved = partsReserved - :partsDelta, " +
        "reservedAmountCents = reservedAmountCents - :amountDelta, " +
        "updatedAt = :updatedAt, version = if_not_exists(version, :zero) + :versionIncrement, " +
        "fullyFunded = :fullyFunded",
      ExpressionAttributeValues: {
        ":amountDelta": input.amountCents,
        ":fullyFunded": fullyFunded,
        ":partsDelta": input.quantity,
        ":updatedAt": input.now,
        ":versionIncrement": 1,
        ":zero": 0
      }
    }
  };
}

type ReservationFundingAdjustment =
  | { kind: "none" }
  | {
      kind: "release" | "reinstate";
      // Parts and their summed quota value moving in this adjustment.
      parts: number;
      amountCents: number;
      // Bookkeeping observed on the reservation and what it becomes.
      partValuesCents: number[];
      observedReversedParts: number;
      nextReversedParts: number;
      nextReversedAmountCents: number;
    };

const NO_FUNDING_ADJUSTMENT: ReservationFundingAdjustment = { kind: "none" };

// Number of trailing quota values a refund pays back in full. A part only
// returns to inventory when the guest actually got its whole price back:
// freeing a part for a refund that covered a fraction of it lets the gift be
// resold past its own total value.
function fullyRefundedTrailingParts(quotaValuesCents: number[], refundedCents: number) {
  let released = 0;
  let given = 0;
  for (let index = quotaValuesCents.length - 1; index >= 0; index -= 1) {
    const valueCents = quotaValuesCents[index] as number;
    if (given + valueCents > refundedCents) {
      break;
    }
    given += valueCents;
    released += 1;
  }
  return { released, refundedPartsValueCents: given };
}

// A reservation's funded parts are a prefix of quotaValuesCents: a refund or
// chargeback shrinks the prefix from the end (the exact final part goes
// first), a won dispute grows it back. A refund only shrinks it by the parts
// it paid back in full, so a fraction of a part's price never puts that part
// back on sale. Comparing the target with the recorded bookkeeping yields the
// exact parts and cents to move — or nothing, which is what makes redelivered
// and out-of-order events idempotent.
function planReservationFundingAdjustment(
  reservation: StoredPaymentReservation,
  nextStatus: PaymentStatus,
  refundedAmountCents: number
): ReservationFundingAdjustment {
  // Only a funded reservation has parts to give back; RECOVERY_HOLD stays
  // parked for the operator and open checkouts fund nothing yet.
  if (reservation.status !== "CONSUMED" && reservation.status !== "REVERSED") {
    return NO_FUNDING_ADJUSTMENT;
  }

  const quantity = reservation.quantity;
  const quotaValuesCents =
    reservation.quotaValuesCents?.length === quantity
      ? reservation.quotaValuesCents
      : Array.from({ length: quantity }, () => Math.round(reservation.amountCents / quantity));
  const observedReversedParts =
    reservation.status === "REVERSED" ? quantity : Math.min(quantity, reservation.reversedParts ?? 0);
  const fundedParts = quantity - observedReversedParts;

  let targetFundedParts: number;
  // A chargeback always takes the whole payment, so it zeroes unconditionally.
  // A refund only releases what it actually paid back: a caller that knows the
  // amount and reports less than the reservation is worth must not wipe every
  // part. Zero still means "amount unknown" (Asaas omits refunds[] on some
  // PAYMENT_REFUNDED deliveries), and that keeps the full reversal.
  if (nextStatus === "CHARGEBACK") {
    targetFundedParts = 0;
  } else if (nextStatus === "REFUNDED" && refundedAmountCents > 0 && refundedAmountCents < reservation.amountCents) {
    const { released, refundedPartsValueCents } = fullyRefundedTrailingParts(
      quotaValuesCents,
      refundedAmountCents
    );
    targetFundedParts = quantity - released;

    if (refundedAmountCents > refundedPartsValueCents) {
      console.warn(
        JSON.stringify({
          metric: "REFUND_NOT_PART_ALIGNED",
          paymentId: reservation.paymentId,
          giftId: reservation.giftId,
          refundedAmountCents,
          residualCents: refundedAmountCents - refundedPartsValueCents
        })
      );
    }
  } else if (nextStatus === "REFUNDED") {
    targetFundedParts = 0;
  } else if (nextStatus === "CONFIRMED" || nextStatus === "RECEIVED") {
    const { released, refundedPartsValueCents } = fullyRefundedTrailingParts(
      quotaValuesCents,
      refundedAmountCents
    );
    targetFundedParts = quantity - released;

    // The refund did not land on a part boundary, so the gift stays credited
    // for money that went back to the guest. Better than the alternative —
    // freeing a part the refund only partly paid for, which lets the gift
    // collect for it twice — but the couple needs to see it.
    if (refundedAmountCents > refundedPartsValueCents) {
      console.warn(
        JSON.stringify({
          metric: "REFUND_NOT_PART_ALIGNED",
          paymentId: reservation.paymentId,
          giftId: reservation.giftId,
          refundedAmountCents,
          residualCents: refundedAmountCents - refundedPartsValueCents
        })
      );
    }
  } else {
    return NO_FUNDING_ADJUSTMENT;
  }

  if (targetFundedParts === fundedParts) {
    return NO_FUNDING_ADJUSTMENT;
  }

  // Refunded money never comes back, so only a full reversal (a chargeback
  // the couple then won) can grow the funded prefix again.
  if (targetFundedParts > fundedParts && reservation.status !== "REVERSED") {
    return NO_FUNDING_ADJUSTMENT;
  }

  const kind = targetFundedParts < fundedParts ? "release" : "reinstate";
  const [from, to] = kind === "release" ? [targetFundedParts, fundedParts] : [fundedParts, targetFundedParts];

  return {
    kind,
    parts: to - from,
    partValuesCents: quotaValuesCents.slice(from, to),
    amountCents: sumQuotaValues(quotaValuesCents.slice(from, to)),
    observedReversedParts,
    nextReversedParts: quantity - targetFundedParts,
    nextReversedAmountCents: sumQuotaValues(quotaValuesCents.slice(targetFundedParts))
  };
}

export class PaymentRepository {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(
    documentClient: DynamoDBDocumentClient = dynamoDbDocumentClient,
    tableName = getEnv().weddingTableName
  ) {
    this.documentClient = createTracedAwsClient(documentClient, {
      annotations: {
        repository: "payment_repository",
        table_role: "payments"
      },
      subsegmentPrefix: "payment_repository"
    });
    this.tableName = tableName;
  }

  async reserveCreatePayment(idempotencyKey: string, fingerprint: string, paymentId: string) {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...idempotencyKeys(idempotencyKey),
            entityType: "PaymentIdempotency",
            idempotencyKey,
            fingerprint,
            paymentId,
            status: "IN_PROGRESS",
            createdAt: new Date().toISOString()
          },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );

      return { accepted: true, reservation: null as IdempotencyReservation | null };
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }

      const existing = await this.getIdempotencyReservation(idempotencyKey);

      if (!existing) {
        throw new AppError("Idempotency reservation is missing after a duplicate create attempt.", 500);
      }

      if (existing.fingerprint !== fingerprint) {
        throw new AppError("The provided idempotency key was already used with a different payload.", 409);
      }

      return { accepted: false, reservation: existing };
    }
  }

  async completeCreatePayment(idempotencyKey: string, paymentSnapshot: PaymentSummary) {
    await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: idempotencyKeys(idempotencyKey),
        UpdateExpression: "SET #status = :status, completedAt = :completedAt, paymentSnapshot = :paymentSnapshot",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "COMPLETED",
          ":completedAt": new Date().toISOString(),
          ":paymentSnapshot": paymentSnapshot
        }
      })
    );
  }

  async getIdempotencyReservation(idempotencyKey: string): Promise<IdempotencyReservation | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: idempotencyKeys(idempotencyKey)
      })
    );

    if (!response.Item) {
      return null;
    }

    return {
      fingerprint: String(response.Item.fingerprint),
      paymentId: String(response.Item.paymentId),
      status: String(response.Item.status) as IdempotencyReservation["status"],
      paymentSnapshot: response.Item.paymentSnapshot as PaymentSummary | undefined
    };
  }

  async putPayment(payment: StoredPayment) {
    const lookupIndex = payment.asaasPaymentId
      ? asaasPaymentLookupIndex(payment.asaasPaymentId)
      : payment.asaasCheckoutId
        ? asaasCheckoutLookupIndex(payment.asaasCheckoutId)
        : null;

    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...paymentKeys(payment.paymentId),
            ...(lookupIndex ?? {}),
            entityType: "Payment",
            ...payment
          },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return;
      }

      throw error;
    }
  }

  async getPaymentReservation(paymentId: string): Promise<StoredPaymentReservation | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: paymentReservationKeys(paymentId)
      })
    );

    return (response.Item as StoredPaymentReservation | undefined) ?? null;
  }

  async getPaymentShell(paymentId: string): Promise<StoredPaymentShell | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: paymentShellKeys(paymentId)
      })
    );

    return (response.Item as StoredPaymentShell | undefined) ?? null;
  }

  async reserveGiftSelection(input: {
    gift: PaymentGift;
    paymentId: string;
    quantity: number;
    expiresAt: string;
  }) {
    const state = (await this.getGiftState(input.gift.id)) ?? defaultGiftState(input.gift.id);
    const selection = buildQuotaSelection(input.gift, state, input.quantity);
    const now = new Date().toISOString();

    try {
      await this.documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: giftStateKeys(input.gift.id),
                ConditionExpression:
                  "((attribute_not_exists(PK) OR attribute_not_exists(version)) AND :expectedVersion = :zero) OR version = :expectedVersion",
                UpdateExpression:
                  "SET entityType = if_not_exists(entityType, :entityType), giftId = if_not_exists(giftId, :giftId), " +
                  "partsFunded = if_not_exists(partsFunded, :zero), confirmedAmountCents = if_not_exists(confirmedAmountCents, :zero), " +
                  "partsReserved = if_not_exists(partsReserved, :zero) + :partsReservedIncrement, " +
                  "reservedAmountCents = if_not_exists(reservedAmountCents, :zero) + :amountIncrement, " +
                  "updatedAt = :updatedAt, version = if_not_exists(version, :zero) + :versionIncrement, " +
                  // fullyFunded means confirmed funding; a reservation must
                  // never flip it — only the confirmation/release writers do.
                  "fullyFunded = if_not_exists(fullyFunded, :fullyFundedDefault)",
                ExpressionAttributeValues: {
                  ":amountIncrement": selection.amountCents,
                  ":entityType": "GiftState",
                  ":expectedVersion": state.version ?? 0,
                  ":fullyFundedDefault": false,
                  ":giftId": input.gift.id,
                  ":partsReservedIncrement": selection.quantity,
                  ":updatedAt": now,
                  ":versionIncrement": 1,
                  ":zero": 0
                }
              }
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  ...paymentReservationKeys(input.paymentId),
                  ...reservationOpenIndex(input.expiresAt),
                  entityType: "PaymentReservation",
                  paymentId: input.paymentId,
                  giftId: input.gift.id,
                  quantity: selection.quantity,
                  quotaValuesCents: selection.quotaValuesCents,
                  amountCents: selection.amountCents,
                  status: "PENDING_CHECKOUT",
                  expiresAt: input.expiresAt,
                  createdAt: now,
                  updatedAt: now
                },
                ConditionExpression: "attribute_not_exists(PK)"
              }
            }
          ]
        })
      );
    } catch (error) {
      if (
        error instanceof ConditionalCheckFailedException ||
        isExpectedConditionalTransactionCancellation(error, [0, 1])
      ) {
        throw new AppError("Requested quantity exceeds the available gift parts.", 409);
      }

      throw error;
    }

    return selection;
  }

  async putPaymentShell(shell: StoredPaymentShell) {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...paymentShellKeys(shell.paymentId),
          entityType: "PaymentShell",
          ...shell
        },
        ConditionExpression: "attribute_not_exists(PK)"
      })
    );
  }

  async putGiftCatalogItems(gifts: PaymentGift[] = Array.from(PAYMENT_GIFTS_BY_ID.values())) {
    await Promise.all(
      gifts.map((gift) =>
        this.documentClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: {
              ...giftMetadataKeys(gift.id),
              entityType: "GiftMetadata",
              ...gift
            }
          })
        )
      )
    );
  }

  async resetGiftStateItems(gifts: PaymentGift[] = Array.from(PAYMENT_GIFTS_BY_ID.values())) {
    const updatedAt = new Date().toISOString();

    await Promise.all(
      gifts.map((gift) =>
        this.documentClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: {
              ...giftStateKeys(gift.id),
              entityType: "GiftState",
              giftId: gift.id,
              partsFunded: 0,
              partsReserved: 0,
              confirmedAmountCents: 0,
              reservedAmountCents: 0,
              fullyFunded: false,
              version: 0,
              updatedAt
            }
          })
        )
      )
    );
  }

  async listGiftStates(): Promise<StoredGiftState[]> {
    const items: StoredGiftState[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.documentClient.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "begins_with(PK, :giftPrefix) AND SK = :state",
          ExpressionAttributeValues: {
            ":giftPrefix": "GIFT#",
            ":state": "STATE"
          },
          ExclusiveStartKey: exclusiveStartKey
        })
      );

      items.push(...((response.Items as StoredGiftState[] | undefined) ?? []));
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
  }

  async listGiftMetadata(): Promise<StoredGiftMetadata[]> {
    const items: StoredGiftMetadata[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.documentClient.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "begins_with(PK, :giftPrefix) AND SK = :metadata",
          ExpressionAttributeValues: {
            ":giftPrefix": "GIFT#",
            ":metadata": "METADATA"
          },
          ExclusiveStartKey: exclusiveStartKey
        })
      );

      items.push(...((response.Items as StoredGiftMetadata[] | undefined) ?? []));
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
  }

  async getGift(giftId: string): Promise<StoredGiftMetadata | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: giftMetadataKeys(giftId)
      })
    );

    return (response.Item as StoredGiftMetadata | undefined) ?? null;
  }

  async getGiftState(giftId: string): Promise<StoredGiftState | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: giftStateKeys(giftId)
      })
    );

    return (response.Item as StoredGiftState | undefined) ?? null;
  }

  // Fast read path for GET /gifts: one BatchGetItem over the metadata + state
  // keys for every gift id (27 gifts -> 54 keys, well under the 100-key limit),
  // replacing the two full-table Scans. Absent items are NORMAL and returned as
  // gaps — STATE rows only exist once a gift has been reserved/funded, and the
  // caller defaults them. Only genuine throttling (UnprocessedKeys that never
  // drain) is treated as an error.
  async batchGetGiftCatalog(
    ids: string[]
  ): Promise<{ metadata: StoredGiftMetadata[]; states: StoredGiftState[] }> {
    const metadata: StoredGiftMetadata[] = [];
    const states: StoredGiftState[] = [];

    if (ids.length === 0) {
      return { metadata, states };
    }

    const allKeys = ids.flatMap((id) => [giftMetadataKeys(id), giftStateKeys(id)]);
    const MAX_BATCH_KEYS = 100;
    const MAX_ATTEMPTS = 4;
    const BASE_BACKOFF_MS = 50;

    for (let offset = 0; offset < allKeys.length; offset += MAX_BATCH_KEYS) {
      let pending: Record<string, unknown>[] = allKeys.slice(offset, offset + MAX_BATCH_KEYS);
      let attempt = 0;

      while (pending.length > 0) {
        const response = await this.documentClient.send(
          new BatchGetCommand({
            RequestItems: {
              [this.tableName]: { Keys: pending }
            }
          })
        );

        for (const item of response.Responses?.[this.tableName] ?? []) {
          if (item.SK === "METADATA") {
            metadata.push(item as StoredGiftMetadata);
          } else if (item.SK === "STATE") {
            states.push(item as StoredGiftState);
          }
        }

        const unprocessed = response.UnprocessedKeys?.[this.tableName]?.Keys ?? [];
        if (unprocessed.length === 0) {
          break;
        }

        attempt += 1;
        if (attempt >= MAX_ATTEMPTS) {
          throw new Error(
            `Gift catalog batch read left ${unprocessed.length} key(s) unprocessed after ${attempt} attempts.`
          );
        }

        await delay(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        pending = unprocessed as Record<string, unknown>[];
      }
    }

    return { metadata, states };
  }

  async listConfirmedPayerNamesByGiftIds(giftIds: string[]): Promise<Record<string, string[]>> {
    const namesByGiftId = new Map<string, Set<string>>(
      giftIds.map((giftId) => [giftId, new Set<string>()])
    );
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.documentClient.send(
        new ScanCommand({
          TableName: this.tableName,
          ProjectionExpression: "gift, payerName",
          FilterExpression:
            "#entityType = :payment AND #status IN (:confirmed, :received) AND attribute_exists(payerName)",
          ExpressionAttributeNames: {
            "#entityType": "entityType",
            "#status": "status"
          },
          ExpressionAttributeValues: {
            ":payment": "Payment",
            ":confirmed": "CONFIRMED",
            ":received": "RECEIVED"
          },
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
        })
      );

      for (const item of response.Items ?? []) {
        const giftId = (item.gift as { id?: unknown } | undefined)?.id;
        const payerName = typeof item.payerName === "string" ? item.payerName.trim() : "";
        if (typeof giftId === "string" && namesByGiftId.has(giftId) && payerName) {
          namesByGiftId.get(giftId)?.add(payerName);
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return Object.fromEntries(
      Array.from(namesByGiftId, ([giftId, names]) => [giftId, Array.from(names)])
    );
  }

  async incrementGiftFunding(input: {
    giftId: string;
    paymentId: string;
    quantity: number;
  }) {
    const gift = await this.getGift(input.giftId);

    if (!gift) {
      throw new AppError("Unknown gift id for funding update.", 400);
    }

    const nextUpdatedAt = new Date().toISOString();
    const incrementResponse = await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: giftStateKeys(input.giftId),
        UpdateExpression:
          "SET entityType = if_not_exists(entityType, :entityType), giftId = if_not_exists(giftId, :giftId), " +
          "partsFunded = if_not_exists(partsFunded, :zero) + :incrementBy, " +
          "updatedAt = :nextUpdatedAt, lastConfirmedPaymentId = :paymentId",
        ExpressionAttributeValues: {
          ":entityType": "GiftState",
          ":giftId": input.giftId,
          ":incrementBy": input.quantity,
          ":nextUpdatedAt": nextUpdatedAt,
          ":paymentId": input.paymentId,
          ":zero": 0
        },
        ReturnValues: "ALL_NEW"
      })
    );

    const nextPartsFunded = Number((incrementResponse.Attributes?.partsFunded as number | undefined) ?? 0);
    const fullyFundedThreshold = gift.fractional ? gift.totalParts ?? 0 : 1;

    if (nextPartsFunded >= fullyFundedThreshold) {
      await this.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: giftStateKeys(input.giftId),
          UpdateExpression: "SET fullyFunded = :fullyFunded",
          ExpressionAttributeValues: {
            ":fullyFunded": true
          }
        })
      );
    }
  }

  async finalizeCreatePayment(input: {
    idempotencyKey: string;
    payment: StoredPayment;
    asaasCheckoutId: string;
  }) {
    const now = new Date().toISOString();

    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: paymentShellKeys(input.payment.paymentId),
              ConditionExpression: "attribute_exists(PK)",
              UpdateExpression:
                "SET shellStatus = :shellStatus, asaasCheckoutId = :asaasCheckoutId, checkoutUrl = :checkoutUrl, checkoutExpiresAt = :checkoutExpiresAt, updatedAt = :updatedAt",
              ExpressionAttributeValues: {
                ":asaasCheckoutId": input.asaasCheckoutId,
                ":checkoutExpiresAt": input.payment.checkout?.expiresAt,
                ":checkoutUrl": input.payment.checkout?.url,
                ":shellStatus": "CHECKOUT_READY",
                ":updatedAt": now
              }
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...paymentKeys(input.payment.paymentId),
                ...asaasCheckoutLookupIndex(input.asaasCheckoutId),
                entityType: "Payment",
                ...input.payment,
                asaasCheckoutId: input.asaasCheckoutId
              },
              ConditionExpression: "attribute_not_exists(PK)"
            }
          },
          {
            Update: {
              TableName: this.tableName,
              Key: paymentReservationKeys(input.payment.paymentId),
              ConditionExpression: "attribute_exists(PK)",
              UpdateExpression:
                "SET #status = :status, asaasCheckoutId = :asaasCheckoutId, updatedAt = :updatedAt",
              ExpressionAttributeNames: {
                "#status": "status"
              },
              ExpressionAttributeValues: {
                ":asaasCheckoutId": input.asaasCheckoutId,
                ":status": "ACTIVE",
                ":updatedAt": now
              }
            }
          },
          {
            Update: {
              TableName: this.tableName,
              Key: idempotencyKeys(input.idempotencyKey),
              ConditionExpression: "attribute_exists(PK)",
              UpdateExpression:
                "SET #status = :status, completedAt = :completedAt, paymentSnapshot = :paymentSnapshot",
              ExpressionAttributeNames: {
                "#status": "status"
              },
              ExpressionAttributeValues: {
                ":completedAt": now,
                ":paymentSnapshot": input.payment,
                ":status": "COMPLETED"
              }
            }
          }
        ]
      })
    );
  }

  async repairFinalizedPayment(input: {
    payment: StoredPayment;
    asaasCheckoutId: string;
    reservationStatus?: StoredPaymentReservationStatus;
  }) {
    const now = new Date().toISOString();
    // A late CHECKOUT_CREATED repair must not resurrect a reservation that was
    // already released or consumed — flipping it back to ACTIVE without
    // re-incrementing the gift counters would defeat the late-confirm guard.
    const reservationHeld =
      input.reservationStatus !== "RELEASED" &&
      input.reservationStatus !== "CONSUMED" &&
      input.reservationStatus !== "REVERSED";

    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: paymentShellKeys(input.payment.paymentId),
              ConditionExpression: "attribute_exists(PK)",
              UpdateExpression:
                "SET shellStatus = :shellStatus, asaasCheckoutId = :asaasCheckoutId, checkoutUrl = :checkoutUrl, checkoutExpiresAt = :checkoutExpiresAt, updatedAt = :updatedAt",
              ExpressionAttributeValues: {
                ":asaasCheckoutId": input.asaasCheckoutId,
                ":checkoutExpiresAt": input.payment.checkout?.expiresAt,
                ":checkoutUrl": input.payment.checkout?.url,
                ":shellStatus": "CHECKOUT_READY",
                ":updatedAt": now
              }
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...paymentKeys(input.payment.paymentId),
                ...asaasCheckoutLookupIndex(input.asaasCheckoutId),
                entityType: "Payment",
                ...input.payment,
                asaasCheckoutId: input.asaasCheckoutId
              },
              ConditionExpression: "attribute_not_exists(PK)"
            }
          },
          {
            Update: {
              TableName: this.tableName,
              Key: paymentReservationKeys(input.payment.paymentId),
              ConditionExpression: "attribute_exists(PK)",
              UpdateExpression: reservationHeld
                ? "SET #status = :status, asaasCheckoutId = :asaasCheckoutId, updatedAt = :updatedAt"
                : "SET asaasCheckoutId = :asaasCheckoutId, updatedAt = :updatedAt",
              ...(reservationHeld
                ? {
                    ExpressionAttributeNames: {
                      "#status": "status"
                    }
                  }
                : {}),
              ExpressionAttributeValues: {
                ":asaasCheckoutId": input.asaasCheckoutId,
                ...(reservationHeld ? { ":status": "ACTIVE" } : {}),
                ":updatedAt": now
              }
            }
          }
        ]
      })
    );
  }

  async markCheckoutAmbiguous(input: { paymentId: string; asaasCheckoutId?: string }) {
    const now = new Date().toISOString();

    await this.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: paymentShellKeys(input.paymentId),
              ConditionExpression: "attribute_exists(PK)",
              UpdateExpression:
                "SET shellStatus = :shellStatus, updatedAt = :updatedAt" +
                (input.asaasCheckoutId ? ", asaasCheckoutId = if_not_exists(asaasCheckoutId, :asaasCheckoutId)" : ""),
              ExpressionAttributeValues: {
                ":asaasCheckoutId": input.asaasCheckoutId,
                ":shellStatus": "CHECKOUT_REMOTE_AMBIGUOUS",
                ":updatedAt": now
              }
            }
          },
          {
            Update: {
              TableName: this.tableName,
              Key: paymentReservationKeys(input.paymentId),
              ConditionExpression: "attribute_exists(PK)",
              UpdateExpression:
                "SET #status = :status, updatedAt = :updatedAt" +
                (input.asaasCheckoutId ? ", asaasCheckoutId = if_not_exists(asaasCheckoutId, :asaasCheckoutId)" : ""),
              ExpressionAttributeNames: {
                "#status": "status"
              },
              ExpressionAttributeValues: {
                ":asaasCheckoutId": input.asaasCheckoutId,
                ":status": "RECOVERY_HOLD",
                ":updatedAt": now
              }
            }
          }
        ]
      })
    );
  }

  async releaseReservationAfterCheckoutFailure(paymentId: string): Promise<ReservationReleaseOutcome> {
    return this.retryCheckoutCleanup("release_orphan_reservation", paymentId, () =>
      this.releaseReservationAfterCheckoutFailureOnce(paymentId)
    );
  }

  private async releaseReservationAfterCheckoutFailureOnce(
    paymentId: string
  ): Promise<ReservationReleaseOutcome> {
    const reservation = await this.getPaymentReservation(paymentId);
    if (!reservation) {
      return "missing-context";
    }

    // Already released — nothing to free, another writer won this race.
    if (reservation.status === "RELEASED") {
      return "race-lost";
    }

    // CONSUMED (funded), REVERSED (funded parts already given back by a
    // refund/chargeback, nothing reserved to free) or RECOVERY_HOLD (deliberate
    // hold) must never be released by orphan cleanup; only open checkouts are
    // eligible below.
    if (
      reservation.status === "CONSUMED" ||
      reservation.status === "REVERSED" ||
      reservation.status === "RECOVERY_HOLD"
    ) {
      return "protected";
    }

    const gift = await this.getGift(reservation.giftId);
    const state = gift ? (await this.getGiftState(reservation.giftId)) ?? defaultGiftState(reservation.giftId) : null;
    const shell = await this.getPaymentShell(paymentId);
    const now = new Date().toISOString();

    if (!gift || !state) {
      return "missing-context";
    }

    const transactItems: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]>["TransactItems"] = [
      {
        // Orphan-release guard: this path runs because the payment row was read
        // as absent. If a payment was (re)created in the meantime it may yet
        // confirm, so the whole transaction cancels unless the payment item
        // still does not exist — never free parts out from under a live payment.
        ConditionCheck: {
          TableName: this.tableName,
          Key: paymentKeys(paymentId),
          ConditionExpression: "attribute_not_exists(PK)"
        }
      },
      buildGiftReservationReleaseUpdate({
        amountCents: reservation.amountCents,
        gift,
        giftId: reservation.giftId,
        now,
        quantity: reservation.quantity,
        state,
        tableName: this.tableName
      }),
      {
        Update: {
          TableName: this.tableName,
          Key: paymentReservationKeys(paymentId),
          // Guard against a concurrent release/consume double-decrementing the
          // gift counters: only an open checkout (PENDING_CHECKOUT/ACTIVE) may
          // be released here, so the transaction cancels if another writer
          // already moved the reservation on.
          ConditionExpression:
            "attribute_exists(PK) AND (#status = :pendingCheckout OR #status = :active)",
          UpdateExpression: "SET #status = :status, updatedAt = :updatedAt REMOVE GSI1PK, GSI1SK",
          ExpressionAttributeNames: {
            "#status": "status"
          },
          ExpressionAttributeValues: {
            ":active": "ACTIVE",
            ":pendingCheckout": "PENDING_CHECKOUT",
            ":status": "RELEASED",
            ":updatedAt": now
          }
        }
      }
    ];

    // A reservation can exist without a shell (the shell write failed during
    // create). attribute_exists(PK) on a missing shell would cancel the whole
    // transaction and silently leak the reservation, so only include the shell
    // update when the shell is actually there.
    if (shell) {
      transactItems.push({
        Update: {
          TableName: this.tableName,
          Key: paymentShellKeys(paymentId),
          ConditionExpression: "attribute_exists(PK)",
          UpdateExpression: "SET shellStatus = :shellStatus, updatedAt = :updatedAt",
          ExpressionAttributeValues: {
            ":shellStatus": "CHECKOUT_RELEASED",
            ":updatedAt": now
          }
        }
      });
    }

    try {
      await this.documentClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
      return "released";
    } catch (error) {
      if (isExpectedConditionalTransactionCancellation(error, [0, 2])) {
        console.warn(
          JSON.stringify({
            metric: "RESERVATION_RELEASE_RACE_LOST",
            paymentId,
            cancellationReasons:
              error instanceof TransactionCanceledException
                ? error.CancellationReasons?.map((reason) => reason.Code)
                : undefined
          })
        );
        return "race-lost";
      }

      throw error;
    }
  }

  async discardPendingPayment(input: {
    paymentId: string;
    expectedPaymentStatus: "CREATED" | "AWAITING_PAYMENT";
    expectedReservationStatus: StoredPaymentReservationStatus;
    expectedShellStatus: StoredPaymentShellStatus;
  }): Promise<boolean> {
    const reservation = await this.getPaymentReservation(input.paymentId);
    const shell = await this.getPaymentShell(input.paymentId);

    if (!reservation || !shell) {
      throw new AppError("Payment checkout state is incomplete.", 409);
    }

    const gift = await this.getGift(reservation.giftId);
    const state = gift
      ? (await this.getGiftState(reservation.giftId)) ?? defaultGiftState(reservation.giftId)
      : null;

    if (!gift || !state) {
      throw new AppError("Payment gift state is incomplete.", 409);
    }

    const now = new Date().toISOString();
    try {
      await this.documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: paymentKeys(input.paymentId),
                ConditionExpression: "attribute_exists(PK) AND #status = :expectedStatus",
                UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
                ExpressionAttributeNames: {
                  "#status": "status"
                },
                ExpressionAttributeValues: {
                  ":expectedStatus": input.expectedPaymentStatus,
                  ":status": "CANCELED",
                  ":updatedAt": now
                }
              }
            },
            {
              Update: {
                TableName: this.tableName,
                Key: paymentReservationKeys(input.paymentId),
                ConditionExpression: "attribute_exists(PK) AND #status = :expectedStatus",
                UpdateExpression: "SET #status = :status, updatedAt = :updatedAt REMOVE GSI1PK, GSI1SK",
                ExpressionAttributeNames: {
                  "#status": "status"
                },
                ExpressionAttributeValues: {
                  ":expectedStatus": input.expectedReservationStatus,
                  ":status": "RELEASED",
                  ":updatedAt": now
                }
              }
            },
            {
              Update: {
                TableName: this.tableName,
                Key: paymentShellKeys(input.paymentId),
                ConditionExpression: "attribute_exists(PK) AND shellStatus = :expectedShellStatus",
                UpdateExpression: "SET shellStatus = :shellStatus, updatedAt = :updatedAt",
                ExpressionAttributeValues: {
                  ":expectedShellStatus": input.expectedShellStatus,
                  ":shellStatus": "CHECKOUT_RELEASED",
                  ":updatedAt": now
                }
              }
            },
            buildGiftReservationReleaseUpdate({
              amountCents: reservation.amountCents,
              gift,
              giftId: reservation.giftId,
              now,
              quantity: reservation.quantity,
              state,
              tableName: this.tableName
            })
          ]
        })
      );

      return true;
    } catch (error) {
      if (error instanceof TransactionCanceledException && isConditionalCheckOnlyCancellation(error)) {
        return false;
      }

      throw error;
    }
  }

  async updatePaymentCustomerProfile(input: {
    paymentId: string;
    asaasCustomerId?: string;
    payerEmail?: string;
    payerFirstName?: string;
    payerName?: string;
    customerProfileStatus: "PENDING" | "READY" | "FAILED";
  }) {
    const expressionAttributeNames: Record<string, string> = {
      "#updatedAt": "updatedAt",
      "#customerProfileStatus": "customerProfileStatus"
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ":updatedAt": new Date().toISOString(),
      ":customerProfileStatus": input.customerProfileStatus,
      ":customerProfileUpdatedAt": new Date().toISOString()
    };
    const updates = [
      "#updatedAt = :updatedAt",
      "#customerProfileStatus = :customerProfileStatus",
      "customerProfileUpdatedAt = :customerProfileUpdatedAt"
    ];

    if (input.asaasCustomerId) {
      updates.push("asaasCustomerId = :asaasCustomerId");
      expressionAttributeValues[":asaasCustomerId"] = input.asaasCustomerId;
    }

    if (input.payerEmail) {
      updates.push("payerEmail = :payerEmail");
      expressionAttributeValues[":payerEmail"] = input.payerEmail;
    }

    if (input.payerFirstName) {
      updates.push("payerFirstName = :payerFirstName");
      expressionAttributeValues[":payerFirstName"] = input.payerFirstName;
    }

    if (input.payerName) {
      updates.push("payerName = :payerName");
      expressionAttributeValues[":payerName"] = input.payerName;
    }

    await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: paymentKeys(input.paymentId),
        UpdateExpression: `SET ${updates.join(", ")}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues
      })
    );
  }

  async getPayment(paymentId: string): Promise<StoredPayment | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: paymentKeys(paymentId)
      })
    );

    return (response.Item as StoredPayment | undefined) ?? null;
  }

  async getPaymentMessage(paymentId: string): Promise<StoredPaymentMessage | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: paymentMessageKeys(paymentId)
      })
    );

    return (response.Item as StoredPaymentMessage | undefined) ?? null;
  }

  async putPaymentMessage(message: StoredPaymentMessage) {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...paymentMessageKeys(message.paymentId),
            entityType: "PaymentMessage",
            ...message
          },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );

      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }

      throw error;
    }
  }

  async putNotificationIfNew(input: {
    paymentId: string;
    type: string;
    payload: Record<string, unknown>;
  }) {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...paymentNotificationKeys(input.paymentId, input.type),
            entityType: "PaymentNotification",
            paymentId: input.paymentId,
            notificationType: input.type,
            createdAt: new Date().toISOString(),
            ...input.payload
          },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );

      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }

      throw error;
    }
  }

  async acquireNotificationSend(input: {
    paymentId: string;
    type: string;
    payload: Record<string, unknown>;
  }) {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...paymentNotificationKeys(input.paymentId, input.type),
            entityType: "PaymentNotification",
            paymentId: input.paymentId,
            notificationType: input.type,
            status: "PENDING",
            createdAt: new Date().toISOString(),
            ...input.payload
          },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );

      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }

      throw error;
    }
  }

  async markNotificationSent(input: {
    paymentId: string;
    type: string;
    payload?: Record<string, unknown>;
  }) {
    const expressionAttributeValues: Record<string, unknown> = {
      ":status": "SENT",
      ":sentAt": new Date().toISOString()
    };
    const updates = ["#status = :status", "sentAt = :sentAt"];

    if (input.payload) {
      for (const [key, value] of Object.entries(input.payload)) {
        // The DocumentClient is configured with removeUndefinedValues: true, so an
        // undefined value would be stripped from ExpressionAttributeValues while its
        // `:value` reference stayed in the UpdateExpression — DynamoDB then rejects the
        // whole update ("expression attribute value ... is not defined"). Skip undefined
        // entries entirely. (e.g. a PIX payment confirmed without payer email.)
        if (value === undefined) {
          continue;
        }
        const valueKey = `:${key}`;
        updates.push(`${key} = ${valueKey}`);
        expressionAttributeValues[valueKey] = value;
      }
    }

    await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: paymentNotificationKeys(input.paymentId, input.type),
        ConditionExpression: "attribute_exists(PK)",
        UpdateExpression: `SET ${updates.join(", ")}`,
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: expressionAttributeValues
      })
    );
  }

  async releaseNotificationSend(paymentId: string, type: string) {
    await this.documentClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: paymentNotificationKeys(paymentId, type)
      })
    );
  }

  async getPaymentByAsaasPaymentId(asaasPaymentId: string): Promise<StoredPayment | null> {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI1_NAME,
        KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
        ExpressionAttributeValues: {
          ":gsi1pk": asaasPaymentLookupIndex(asaasPaymentId).GSI1PK,
          ":gsi1sk": asaasPaymentLookupIndex(asaasPaymentId).GSI1SK
        },
        Limit: 1
      })
    );

    return (response.Items?.[0] as StoredPayment | undefined) ?? null;
  }

  async getPaymentByAsaasCheckoutId(asaasCheckoutId: string): Promise<StoredPayment | null> {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI1_NAME,
        KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
        ExpressionAttributeValues: {
          ":gsi1pk": asaasCheckoutLookupIndex(asaasCheckoutId).GSI1PK,
          ":gsi1sk": asaasCheckoutLookupIndex(asaasCheckoutId).GSI1SK
        },
        Limit: 1
      })
    );

    return (response.Items?.[0] as StoredPayment | undefined) ?? null;
  }

  async recordWebhookEventIfNew(input: {
    eventId: string;
    eventType: string;
    payload: string;
    asaasPaymentId?: string;
    asaasCheckoutId?: string;
    externalReference?: string;
    ttlInSeconds?: number;
  }) {
    const ttlInSeconds = input.ttlInSeconds ?? 30 * 24 * 60 * 60;
    const payloadByteLength = Buffer.byteLength(input.payload, "utf8");
    const truncated = payloadByteLength > RAW_WEBHOOK_PAYLOAD_MAX_BYTES;
    const storedPayload = truncated
      ? Buffer.from(input.payload, "utf8")
          .subarray(0, RAW_WEBHOOK_PAYLOAD_MAX_BYTES)
          .toString("utf8")
      : input.payload;

    if (truncated) {
      console.error(
        JSON.stringify({
          metric: "WEBHOOK_PAYLOAD_TRUNCATED",
          eventId: input.eventId,
          originalBytes: payloadByteLength,
          storedBytes: RAW_WEBHOOK_PAYLOAD_MAX_BYTES
        })
      );
    }

    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...webhookKeys("asaas", input.eventId),
            entityType: "WebhookEvent",
            provider: "asaas",
            eventId: input.eventId,
            eventType: input.eventType,
            payload: storedPayload,
            payloadTruncated: truncated,
            asaasPaymentId: input.asaasPaymentId,
            asaasCheckoutId: input.asaasCheckoutId,
            externalReference: input.externalReference,
            receivedAt: new Date().toISOString(),
            [TTL_ATTRIBUTE]: Math.floor(Date.now() / 1000) + ttlInSeconds
          },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );

      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }

      throw error;
    }
  }

  async getWebhookEvent(eventId: string): Promise<StoredWebhookEvent | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: webhookKeys("asaas", eventId)
      })
    );

    return (response.Item as StoredWebhookEvent | undefined) ?? null;
  }

  async markWebhookProcessed(eventId: string, processingResult: string) {
    await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: webhookKeys("asaas", eventId),
        UpdateExpression: "SET processedAt = :processedAt, processingResult = :processingResult",
        ExpressionAttributeValues: {
          ":processedAt": new Date().toISOString(),
          ":processingResult": processingResult
        }
      })
    );
  }

  async applyWebhookUpdate(input: {
    eventId?: string;
    paymentId: string;
    expectedCurrentStatus: PaymentStatus;
    nextStatus: PaymentStatus;
    confirmedOn?: string;
    receivedOn?: string;
    asaasPaymentId?: string;
    asaasCheckoutId?: string;
    giftId?: string;
    quantity?: number;
    // Cumulative cents Asaas has refunded on this payment (refunds[] sum).
    refundedAmountCents?: number;
  }) {
    const updateParts = [
      "#status = :status",
      "updatedAt = :updatedAt"
    ];
    const expressionAttributeValues: Record<string, unknown> = {
      ":status": input.nextStatus,
      ":updatedAt": new Date().toISOString(),
      ":expectedCurrentStatus": input.expectedCurrentStatus
    };

    if (input.refundedAmountCents !== undefined) {
      updateParts.push("refundedAmountCents = :refundedAmountCents");
      expressionAttributeValues[":refundedAmountCents"] = input.refundedAmountCents;
    }

    if (input.asaasPaymentId) {
      updateParts.push("asaasPaymentId = :asaasPaymentId");
      updateParts.push("GSI1PK = :gsi1pk");
      updateParts.push("GSI1SK = :gsi1sk");
      expressionAttributeValues[":asaasPaymentId"] = input.asaasPaymentId;
      expressionAttributeValues[":gsi1pk"] = asaasPaymentLookupIndex(input.asaasPaymentId).GSI1PK;
      expressionAttributeValues[":gsi1sk"] = asaasPaymentLookupIndex(input.asaasPaymentId).GSI1SK;
    }

    if (input.asaasCheckoutId) {
      updateParts.push("asaasCheckoutId = if_not_exists(asaasCheckoutId, :asaasCheckoutId)");
      expressionAttributeValues[":asaasCheckoutId"] = input.asaasCheckoutId;
    }

    if (input.confirmedOn) {
      updateParts.push("confirmedOn = if_not_exists(confirmedOn, :confirmedOn)");
      expressionAttributeValues[":confirmedOn"] = input.confirmedOn;
    }

    if (input.receivedOn) {
      updateParts.push("receivedOn = if_not_exists(receivedOn, :receivedOn)");
      expressionAttributeValues[":receivedOn"] = input.receivedOn;
    }

    const reservation = await this.getPaymentReservation(input.paymentId);
    // Once a reservation has been through a refund/chargeback its funded parts
    // are tracked by the reversal bookkeeping, and only that path may move
    // them again (a won dispute re-funds through it, never through consume).
    const hasReversalHistory =
      reservation !== null &&
      (reservation.status === "REVERSED" || reservation.reversedParts !== undefined);
    const shouldConsumeReservation =
      reservation &&
      !hasReversalHistory &&
      (input.nextStatus === "CONFIRMED" || input.nextStatus === "RECEIVED") &&
      input.expectedCurrentStatus !== "CONFIRMED" &&
      input.expectedCurrentStatus !== "RECEIVED";
    const shouldReleaseReservation =
      reservation &&
      (input.nextStatus === "EXPIRED" || input.nextStatus === "CANCELED" || input.nextStatus === "FAILED") &&
      reservation.status !== "RELEASED" &&
      reservation.status !== "CONSUMED" &&
      reservation.status !== "REVERSED" &&
      reservation.status !== "RECOVERY_HOLD";

    if (!shouldConsumeReservation && !shouldReleaseReservation) {
      const adjustment = reservation
        ? planReservationFundingAdjustment(reservation, input.nextStatus, input.refundedAmountCents ?? 0)
        : NO_FUNDING_ADJUSTMENT;

      if (adjustment.kind !== "none") {
        return this.applyReservationFundingAdjustment({
          adjustment,
          expressionAttributeValues,
          input,
          reservation: reservation as StoredPaymentReservation,
          updateParts
        });
      }

      try {
        await this.documentClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: paymentKeys(input.paymentId),
            ConditionExpression: "attribute_not_exists(#status) OR #status = :expectedCurrentStatus",
            UpdateExpression: `SET ${updateParts.join(", ")}`,
            ExpressionAttributeNames: {
              "#status": "status"
            },
            ExpressionAttributeValues: expressionAttributeValues
          })
        );

        if (input.eventId) {
          await this.markWebhookProcessed(input.eventId, "updated");
        }

        return true;
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          return false;
        }

        throw error;
      }
    }

    const giftId = reservation?.giftId ?? input.giftId;
    const quantity = reservation?.quantity ?? input.quantity;
    if (!giftId || !quantity || !reservation) {
      throw new AppError("Webhook update is missing reservation context.", 500);
    }

    const gift = await this.getGift(giftId);
    const state = (await this.getGiftState(giftId)) ?? defaultGiftState(giftId);
    if (!gift) {
      throw new AppError("Unknown gift id for funding update.", 400);
    }

    const now = new Date().toISOString();
    const nextConfirmedAmount = shouldConsumeReservation
      ? state.confirmedAmountCents + reservation.amountCents
      : state.confirmedAmountCents;
    const nextPartsFunded = shouldConsumeReservation ? state.partsFunded + quantity : state.partsFunded;
    const fullyFundedThreshold = gift.fractional ? (gift.totalParts ?? 0) : 1;
    const nextFullyFunded =
      nextConfirmedAmount >= gift.totalValueCents ||
      nextPartsFunded >= fullyFundedThreshold;

    const transactItems: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]>["TransactItems"] = [
      {
        Update: {
          TableName: this.tableName,
          Key: paymentKeys(input.paymentId),
          ConditionExpression: "attribute_not_exists(#status) OR #status = :expectedCurrentStatus",
          UpdateExpression: `SET ${updateParts.join(", ")}`,
          ExpressionAttributeNames: {
            "#status": "status"
          },
          ExpressionAttributeValues: {
            ...expressionAttributeValues,
            ":expectedCurrentStatus": input.expectedCurrentStatus,
            ":updatedAt": now
          }
        }
      }
    ];

    if (shouldConsumeReservation) {
      // A payment can confirm after its reservation was already released (late
      // webhook after an expiry release). The released parts were returned to
      // the pool, so only the funded counters may move in that case.
      const reservationStillHeld = reservation.status !== "RELEASED";

      transactItems.push(
        {
          Update: {
            TableName: this.tableName,
            Key: paymentReservationKeys(input.paymentId),
            // The counter math below was derived from the reservation status
            // read above; if another writer moved it since, the stale math
            // must not land — cancel the transaction instead.
            ConditionExpression: "#status = :observedReservationStatus",
            UpdateExpression: "SET #status = :reservationStatus, updatedAt = :updatedAt REMOVE GSI1PK, GSI1SK",
            ExpressionAttributeNames: {
              "#status": "status"
            },
            ExpressionAttributeValues: {
              ":observedReservationStatus": reservation.status,
              ":reservationStatus": "CONSUMED",
              ":updatedAt": now
            }
          }
        },
        {
          Update: {
            TableName: this.tableName,
            Key: giftStateKeys(giftId),
            ConditionExpression: "attribute_exists(PK)",
            UpdateExpression:
              "SET " +
              (reservationStillHeld
                ? "partsReserved = if_not_exists(partsReserved, :zero) - :partsDelta, " +
                  "reservedAmountCents = if_not_exists(reservedAmountCents, :zero) - :amountDelta, "
                : "") +
              "partsFunded = if_not_exists(partsFunded, :zero) + :partsDelta, " +
              "confirmedAmountCents = if_not_exists(confirmedAmountCents, :zero) + :amountDelta, " +
              "updatedAt = :updatedAt, lastConfirmedPaymentId = :paymentId, " +
              "version = if_not_exists(version, :zero) + :versionIncrement, fullyFunded = :fullyFunded",
            ExpressionAttributeValues: {
              ":amountDelta": reservation.amountCents,
              ":fullyFunded": nextFullyFunded,
              ":partsDelta": quantity,
              ":paymentId": input.paymentId,
              ":updatedAt": now,
              ":versionIncrement": 1,
              ":zero": 0
            }
          }
        },
        {
          Update: {
            TableName: this.tableName,
            Key: paymentShellKeys(input.paymentId),
            ConditionExpression: "attribute_exists(PK)",
            UpdateExpression: "SET shellStatus = :shellStatus, updatedAt = :updatedAt",
            ExpressionAttributeValues: {
              ":shellStatus": "CHECKOUT_CONSUMED",
              ":updatedAt": now
            }
          }
        }
      );
    }

    if (shouldReleaseReservation) {
      transactItems.push(
        {
          Update: {
            TableName: this.tableName,
            Key: paymentReservationKeys(input.paymentId),
            // Guard on the reservation itself, not only the payment item: a
            // concurrent releaseReservationAfterCheckoutFailure never touches
            // the payment item, so the payment-status condition alone would
            // let both racers decrement the gift counters.
            //
            // An allow-list, not a deny-list: only an open reservation holds
            // the reserved counters this release decrements. A reservation
            // that became REVERSED or RECOVERY_HOLD between the read and this
            // write holds nothing, and releasing it would take parts from
            // whatever other checkout happens to satisfy the global
            // partsReserved guard.
            ConditionExpression:
              "attribute_exists(PK) AND (#status = :pendingCheckout OR #status = :active)",
            UpdateExpression: "SET #status = :reservationStatus, updatedAt = :updatedAt REMOVE GSI1PK, GSI1SK",
            ExpressionAttributeNames: {
              "#status": "status"
            },
            ExpressionAttributeValues: {
              ":active": "ACTIVE",
              ":pendingCheckout": "PENDING_CHECKOUT",
              ":reservationStatus": "RELEASED",
              ":updatedAt": now
            }
          }
        },
        buildGiftReservationReleaseUpdate({
          amountCents: reservation.amountCents,
          gift,
          giftId,
          now,
          quantity,
          state,
          tableName: this.tableName
        }),
        {
          Update: {
            TableName: this.tableName,
            Key: paymentShellKeys(input.paymentId),
            ConditionExpression: "attribute_exists(PK)",
            UpdateExpression: "SET shellStatus = :shellStatus, updatedAt = :updatedAt",
            ExpressionAttributeValues: {
              ":shellStatus": "CHECKOUT_RELEASED",
              ":updatedAt": now
            }
          }
        }
      );
    }

    if (input.eventId) {
      transactItems.push({
        Update: {
          TableName: this.tableName,
          Key: webhookKeys("asaas", input.eventId),
          ConditionExpression: "attribute_exists(PK)",
          UpdateExpression: "SET processedAt = :processedAt, processingResult = :processingResult",
          ExpressionAttributeValues: {
            ":processedAt": now,
            ":processingResult": "updated"
          }
        }
      });
    }

    try {
      await this.documentClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

      return true;
    } catch (error) {
      // Items are [0] payment, [1] reservation, [2] gift state, [3] webhook.
      // A condition failure on the payment or the reservation is a race this
      // caller loses and the queue redelivers; one on the gift-state counters
      // is an invariant violation and must stay visible.
      if (
        error instanceof ConditionalCheckFailedException ||
        isExpectedConditionalTransactionCancellation(error, [0, 1])
      ) {
        return false;
      }

      throw error;
    }
  }

  // Refunds, chargebacks and won disputes move a funded reservation's parts
  // down or back up. Either direction is one transaction conditioned on the
  // gift-state version read in the same attempt, so `fullyFunded` and the
  // availability check for a reinstatement are computed from exactly the
  // counters the write lands on. A version race re-reads and retries; a
  // reservation that another writer already moved is a lost race (`false`),
  // which leaves the webhook unprocessed for the queue to redeliver.
  private async applyReservationFundingAdjustment(context: {
    adjustment: ReservationFundingAdjustment;
    expressionAttributeValues: Record<string, unknown>;
    input: {
      eventId?: string;
      paymentId: string;
      expectedCurrentStatus: PaymentStatus;
      nextStatus: PaymentStatus;
    };
    reservation: StoredPaymentReservation;
    updateParts: string[];
  }): Promise<boolean> {
    const { adjustment, input, reservation } = context;
    if (adjustment.kind === "none") {
      return false;
    }

    const gift = await this.getGift(reservation.giftId);
    if (!gift) {
      throw new AppError("Unknown gift id for funding update.", 400);
    }

    const buildPaymentUpdate = (now: string) => ({
      Update: {
        TableName: this.tableName,
        Key: paymentKeys(input.paymentId),
        ConditionExpression: "attribute_not_exists(#status) OR #status = :expectedCurrentStatus",
        UpdateExpression: `SET ${context.updateParts.join(", ")}`,
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ...context.expressionAttributeValues,
          ":expectedCurrentStatus": input.expectedCurrentStatus,
          ":updatedAt": now
        }
      }
    });
    const buildWebhookUpdate = (now: string) =>
      input.eventId
        ? [
            {
              Update: {
                TableName: this.tableName,
                Key: webhookKeys("asaas", input.eventId),
                ConditionExpression: "attribute_exists(PK)",
                UpdateExpression: "SET processedAt = :processedAt, processingResult = :processingResult",
                ExpressionAttributeValues: {
                  ":processedAt": now,
                  ":processingResult": "updated"
                }
              }
            }
          ]
        : [];
    // The counter math is derived from the reservation read by the caller;
    // if another writer moved its status or bookkeeping since, the stale
    // delta must not land (this is also what makes a redelivered event a
    // no-op instead of a second decrement).
    const observedReversedPartsCondition =
      reservation.reversedParts === undefined
        ? "(attribute_not_exists(reversedParts) OR reversedParts = :observedReversedParts)"
        : "reversedParts = :observedReversedParts";
    const reservationCondition = `attribute_exists(PK) AND #status = :observedStatus AND ${observedReversedPartsCondition}`;

    for (let attempt = 1; attempt <= CHECKOUT_CLEANUP_MAX_ATTEMPTS; attempt += 1) {
      const state = (await this.getGiftState(reservation.giftId)) ?? defaultGiftState(reservation.giftId);
      const expectedVersion = state.version ?? 0;
      const now = new Date().toISOString();

      if (adjustment.kind === "reinstate") {
        // A free slot is not the same as a slot the reinstated parts fit into.
        // Count, value and — for EXACT_FINAL_QUOTA — composition all have to
        // hold, or the gift collects past its own total value.
        const availableParts = getAvailableParts(gift, state);
        const soldAmountCents = (state.confirmedAmountCents ?? 0) + (state.reservedAmountCents ?? 0);

        // Only EXACT_FINAL_QUOTA prices its parts to sum to exactly
        // totalValueCents, so only there is money a real ceiling. A
        // LEGACY_FIXED_50 gift is meant to over-collect by up to one part, and
        // the reserve path lets it — the slot count is its ceiling.
        //
        // For a self-consistent state the slot count already subsumes the
        // value check; it stays as a backstop for a gift state that has
        // drifted from its reservations, where the counts would still agree.
        const isExactQuota = gift.fundingModelVersion === "EXACT_FINAL_QUOTA";
        const reinstatesFinalPart =
          isExactQuota &&
          Boolean(gift.finalPartValueCents) &&
          adjustment.partValuesCents.includes(gift.finalPartValueCents as number);

        const holdReason =
          adjustment.parts > availableParts
            ? "slots"
            : isExactQuota && soldAmountCents + adjustment.amountCents > gift.totalValueCents
              ? "value"
              : reinstatesFinalPart && isFinalPartSold(gift, state)
                ? "final_part"
                : null;

        if (holdReason) {
          // The freed parts were sold to someone else while the dispute ran.
          // The money is real, so the payment confirms, but the gift must
          // not be over-funded: park the reservation for the operator.
          console.warn(
            JSON.stringify({
              metric: "REVERSAL_REINSTATE_HELD",
              paymentId: input.paymentId,
              giftId: reservation.giftId,
              reason: holdReason,
              partsRequested: adjustment.parts,
              partsAvailable: availableParts,
              amountRequestedCents: adjustment.amountCents,
              soldAmountCents,
              totalValueCents: gift.totalValueCents
            })
          );

          try {
            await this.documentClient.send(
              new TransactWriteCommand({
                TransactItems: [
                  buildPaymentUpdate(now),
                  {
                    Update: {
                      TableName: this.tableName,
                      Key: paymentReservationKeys(input.paymentId),
                      ConditionExpression: reservationCondition,
                      UpdateExpression: "SET #status = :reservationStatus, updatedAt = :updatedAt",
                      ExpressionAttributeNames: {
                        "#status": "status"
                      },
                      ExpressionAttributeValues: {
                        ":observedReversedParts": adjustment.observedReversedParts,
                        ":observedStatus": reservation.status,
                        ":reservationStatus": "RECOVERY_HOLD",
                        ":updatedAt": now
                      }
                    }
                  },
                  ...buildWebhookUpdate(now)
                ]
              })
            );
            return true;
          } catch (error) {
            if (isExpectedConditionalTransactionCancellation(error, [0, 1])) {
              return false;
            }
            throw error;
          }
        }
      }

      const direction = adjustment.kind === "release" ? -1 : 1;
      const nextPartsFunded = Math.max(0, (state.partsFunded ?? 0) + direction * adjustment.parts);
      const nextConfirmedAmount = Math.max(0, (state.confirmedAmountCents ?? 0) + direction * adjustment.amountCents);
      const fullyFundedThreshold = gift.fractional ? (gift.totalParts ?? 0) : 1;
      const nextFullyFunded =
        nextConfirmedAmount >= gift.totalValueCents || nextPartsFunded >= fullyFundedThreshold;
      const nextReservationStatus: StoredPaymentReservationStatus =
        adjustment.nextReversedParts >= reservation.quantity ? "REVERSED" : "CONSUMED";
      const versionCondition =
        "((attribute_not_exists(version) AND :expectedVersion = :zero) OR version = :expectedVersion)";

      const transactItems: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]>["TransactItems"] = [
        buildPaymentUpdate(now),
        {
          Update: {
            TableName: this.tableName,
            Key: paymentReservationKeys(input.paymentId),
            ConditionExpression: reservationCondition,
            UpdateExpression:
              "SET #status = :reservationStatus, reversedParts = :reversedParts, " +
              "reversedAmountCents = :reversedAmountCents, updatedAt = :updatedAt REMOVE GSI1PK, GSI1SK",
            ExpressionAttributeNames: {
              "#status": "status"
            },
            ExpressionAttributeValues: {
              ":observedReversedParts": adjustment.observedReversedParts,
              ":observedStatus": reservation.status,
              ":reservationStatus": nextReservationStatus,
              ":reversedAmountCents": adjustment.nextReversedAmountCents,
              ":reversedParts": adjustment.nextReversedParts,
              ":updatedAt": now
            }
          }
        },
        adjustment.kind === "release"
          ? {
              Update: {
                TableName: this.tableName,
                Key: giftStateKeys(reservation.giftId),
                ConditionExpression:
                  `attribute_exists(PK) AND ${versionCondition} AND ` +
                  "partsFunded >= :partsDelta AND confirmedAmountCents >= :amountDelta",
                UpdateExpression:
                  "SET partsFunded = partsFunded - :partsDelta, " +
                  "confirmedAmountCents = confirmedAmountCents - :amountDelta, " +
                  "updatedAt = :updatedAt, " +
                  "version = if_not_exists(version, :zero) + :versionIncrement, " +
                  "fullyFunded = :fullyFunded",
                ExpressionAttributeValues: {
                  ":amountDelta": adjustment.amountCents,
                  ":expectedVersion": expectedVersion,
                  ":fullyFunded": nextFullyFunded,
                  ":partsDelta": adjustment.parts,
                  ":updatedAt": now,
                  ":versionIncrement": 1,
                  ":zero": 0
                }
              }
            }
          : {
              Update: {
                TableName: this.tableName,
                Key: giftStateKeys(reservation.giftId),
                // Availability was checked in code against this same version;
                // condition expressions cannot do the arithmetic themselves.
                ConditionExpression: `attribute_exists(PK) AND ${versionCondition}`,
                UpdateExpression:
                  "SET partsFunded = if_not_exists(partsFunded, :zero) + :partsDelta, " +
                  "confirmedAmountCents = if_not_exists(confirmedAmountCents, :zero) + :amountDelta, " +
                  "updatedAt = :updatedAt, lastConfirmedPaymentId = :paymentId, " +
                  "version = if_not_exists(version, :zero) + :versionIncrement, " +
                  "fullyFunded = :fullyFunded",
                ExpressionAttributeValues: {
                  ":amountDelta": adjustment.amountCents,
                  ":expectedVersion": expectedVersion,
                  ":fullyFunded": nextFullyFunded,
                  ":partsDelta": adjustment.parts,
                  ":paymentId": input.paymentId,
                  ":updatedAt": now,
                  ":versionIncrement": 1,
                  ":zero": 0
                }
              }
            }
      ];

      // The shell mirrors whether the checkout still funds anything; a
      // partial release leaves it consumed.
      if (nextReservationStatus === "REVERSED" || adjustment.kind === "reinstate") {
        transactItems.push({
          Update: {
            TableName: this.tableName,
            Key: paymentShellKeys(input.paymentId),
            ConditionExpression: "attribute_exists(PK)",
            UpdateExpression: "SET shellStatus = :shellStatus, updatedAt = :updatedAt",
            ExpressionAttributeValues: {
              ":shellStatus": nextReservationStatus === "REVERSED" ? "CHECKOUT_RELEASED" : "CHECKOUT_CONSUMED",
              ":updatedAt": now
            }
          }
        });
      }
      transactItems.push(...buildWebhookUpdate(now));

      try {
        await this.documentClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
        return true;
      } catch (error) {
        if (isExpectedConditionalTransactionCancellation(error, [0, 1])) {
          return false;
        }

        if (isExpectedConditionalTransactionCancellation(error, [2])) {
          const latest = await this.getGiftState(reservation.giftId);
          const versionMoved = (latest?.version ?? 0) !== expectedVersion;
          if (versionMoved && attempt < CHECKOUT_CLEANUP_MAX_ATTEMPTS) {
            const delayMs = Math.floor(Math.random() * CHECKOUT_CLEANUP_RETRY_BASE_MS * 2 ** (attempt - 1));
            console.warn(
              JSON.stringify({
                metric: "REVERSAL_TRANSACTION_VERSION_RETRY",
                paymentId: input.paymentId,
                giftId: reservation.giftId,
                attempt,
                maxAttempts: CHECKOUT_CLEANUP_MAX_ATTEMPTS,
                delayMs
              })
            );
            await delay(delayMs);
            continue;
          }
        }

        if (isConditionalTransactionCancellation(error)) {
          console.error(
            JSON.stringify({
              metric: "REVERSAL_TRANSACTION_INVARIANT_VIOLATION",
              paymentId: input.paymentId,
              giftId: reservation.giftId,
              adjustment: adjustment.kind,
              error: (error as Error).message
            })
          );
        }

        throw error;
      }
    }

    throw new Error("Reservation funding adjustment retry loop exited unexpectedly.");
  }

  async listStaleOpenReservations(cutoffIso: string, limit = 25): Promise<StoredPaymentReservation[]> {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI1_NAME,
        KeyConditionExpression: "GSI1PK = :open AND GSI1SK < :cutoff",
        ExpressionAttributeValues: {
          ":open": reservationOpenIndex(cutoffIso).GSI1PK,
          ":cutoff": cutoffIso
        },
        Limit: limit
      })
    );

    return (response.Items as StoredPaymentReservation[] | undefined) ?? [];
  }

  // Lazy-expiry entry point: same atomic transition as a CHECKOUT_EXPIRED
  // webhook, but losing a race (e.g. a confirmation landed first) is expected
  // and reported as `false` instead of bubbling the AWS exception into domain/.
  async tryExpireStalePayment(input: {
    paymentId: string;
    expectedCurrentStatus: PaymentStatus;
  }): Promise<boolean> {
    return this.retryCheckoutCleanup("expire_payment", input.paymentId, async () => {
      try {
        return await this.applyWebhookUpdate({
          paymentId: input.paymentId,
          expectedCurrentStatus: input.expectedCurrentStatus,
          nextStatus: "EXPIRED"
        });
      } catch (error) {
        if (isExpectedConditionalTransactionCancellation(error, [0, 1])) {
          return false;
        }

        throw error;
      }
    });
  }

  private async retryCheckoutCleanup<T>(
    operation: "expire_payment" | "release_orphan_reservation",
    paymentId: string,
    action: () => Promise<T>
  ): Promise<T> {
    for (let attempt = 1; attempt <= CHECKOUT_CLEANUP_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        if (
          !isTransactionConflictCancellation(error) ||
          attempt === CHECKOUT_CLEANUP_MAX_ATTEMPTS
        ) {
          throw error;
        }

        const retryLimitMs = CHECKOUT_CLEANUP_RETRY_BASE_MS * 2 ** (attempt - 1);
        const delayMs = Math.floor(Math.random() * retryLimitMs);
        console.warn(
          JSON.stringify({
            metric: "CHECKOUT_EXPIRY_TRANSACTION_CONFLICT_RETRY",
            operation,
            paymentId,
            attempt,
            maxAttempts: CHECKOUT_CLEANUP_MAX_ATTEMPTS,
            delayMs,
            cancellationReasons:
              error instanceof TransactionCanceledException
                ? error.CancellationReasons?.map((reason) => reason.Code)
                : undefined
          })
        );
        await delay(delayMs);
      }
    }

    throw new Error("Checkout cleanup retry loop exited unexpectedly.");
  }
}
