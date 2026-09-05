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
  const regularPartsRemaining = Math.max(0, regularPartsTotal - soldParts);
  const regularPartsToTake = Math.min(quantity, regularPartsRemaining);
  const finalPartsToTake = quantity - regularPartsToTake;

  if (finalPartsToTake > 1) {
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
      input.reservationStatus !== "RELEASED" && input.reservationStatus !== "CONSUMED";

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

    // CONSUMED (funded) or RECOVERY_HOLD (deliberate hold) must never be
    // released by orphan cleanup; only open checkouts are eligible below.
    if (reservation.status === "CONSUMED" || reservation.status === "RECOVERY_HOLD") {
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
    const shouldConsumeReservation =
      reservation &&
      (input.nextStatus === "CONFIRMED" || input.nextStatus === "RECEIVED") &&
      input.expectedCurrentStatus !== "CONFIRMED" &&
      input.expectedCurrentStatus !== "RECEIVED";
    const shouldReleaseReservation =
      reservation &&
      (input.nextStatus === "EXPIRED" || input.nextStatus === "CANCELED" || input.nextStatus === "FAILED") &&
      reservation.status !== "RELEASED" &&
      reservation.status !== "CONSUMED";

    if (!shouldConsumeReservation && !shouldReleaseReservation) {
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
    const nextFullyFunded =
      nextConfirmedAmount >= gift.totalValueCents ||
      state.partsFunded + (shouldConsumeReservation ? quantity : 0) >= (gift.fractional ? (gift.totalParts ?? 0) : 1);

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
            ConditionExpression: "attribute_exists(PK) AND #status <> :released AND #status <> :consumed",
            UpdateExpression: "SET #status = :reservationStatus, updatedAt = :updatedAt REMOVE GSI1PK, GSI1SK",
            ExpressionAttributeNames: {
              "#status": "status"
            },
            ExpressionAttributeValues: {
              ":consumed": "CONSUMED",
              ":released": "RELEASED",
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
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }

      throw error;
    }
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
