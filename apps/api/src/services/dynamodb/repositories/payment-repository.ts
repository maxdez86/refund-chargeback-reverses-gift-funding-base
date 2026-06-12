import {
  ConditionalCheckFailedException,
  TransactionCanceledException
} from "@aws-sdk/client-dynamodb";
import {
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
  if (gift.fractional) {
    return Math.max(0, (gift.totalParts ?? 0) - state.partsFunded - state.partsReserved);
  }

  return Math.max(0, 1 - state.partsFunded - state.partsReserved);
}

function buildQuotaSelection(gift: PaymentGift, state: StoredGiftState, quantity: number): ReservedQuotaSelection {
  if (!gift.fractional) {
    if (quantity !== 1) {
      throw new AppError("This gift does not allow fractional contributions.", 400);
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
  const soldParts = state.partsFunded + state.partsReserved;
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
      if (error instanceof ConditionalCheckFailedException) {
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

  async releaseReservationAfterCheckoutFailure(paymentId: string) {
    const reservation = await this.getPaymentReservation(paymentId);
    if (!reservation) {
      return;
    }

    if (reservation.status === "RELEASED" || reservation.status === "CONSUMED") {
      return;
    }

    const gift = await this.getGift(reservation.giftId);
    const state = gift ? (await this.getGiftState(reservation.giftId)) ?? defaultGiftState(reservation.giftId) : null;
    const shell = await this.getPaymentShell(paymentId);
    const now = new Date().toISOString();

    if (!gift || !state) {
      return;
    }

    const transactItems: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]>["TransactItems"] = [
      {
        Update: {
          TableName: this.tableName,
          Key: giftStateKeys(reservation.giftId),
          ConditionExpression: "attribute_exists(PK)",
          UpdateExpression:
            "SET partsReserved = if_not_exists(partsReserved, :zero) - :partsReservedDecrement, " +
            "reservedAmountCents = if_not_exists(reservedAmountCents, :zero) - :amountDecrement, " +
            "updatedAt = :updatedAt, version = if_not_exists(version, :zero) + :versionIncrement, fullyFunded = :fullyFunded",
          ExpressionAttributeValues: {
            ":amountDecrement": reservation.amountCents,
            ":fullyFunded": false,
            ":partsReservedDecrement": reservation.quantity,
            ":updatedAt": now,
            ":versionIncrement": 1,
            ":zero": 0
          }
        }
      },
      {
        Update: {
          TableName: this.tableName,
          Key: paymentReservationKeys(paymentId),
          // Guard against a concurrent release/consume double-decrementing
          // the gift counters: the whole transaction cancels if another
          // writer already moved the reservation out of its held state.
          ConditionExpression:
            "attribute_exists(PK) AND #status <> :released AND #status <> :consumed",
          UpdateExpression: "SET #status = :status, updatedAt = :updatedAt REMOVE GSI1PK, GSI1SK",
          ExpressionAttributeNames: {
            "#status": "status"
          },
          ExpressionAttributeValues: {
            ":consumed": "CONSUMED",
            ":released": "RELEASED",
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
    } catch (error) {
      if (error instanceof TransactionCanceledException && isConditionalCheckOnlyCancellation(error)) {
        console.warn(
          JSON.stringify({
            metric: "RESERVATION_RELEASE_RACE_LOST",
            paymentId,
            cancellationReasons: error.CancellationReasons?.map((reason) => reason.Code)
          })
        );
        return;
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
        {
          Update: {
            TableName: this.tableName,
            Key: giftStateKeys(giftId),
            ConditionExpression: "attribute_exists(PK)",
            UpdateExpression:
              "SET partsReserved = if_not_exists(partsReserved, :zero) - :partsDelta, " +
              "reservedAmountCents = if_not_exists(reservedAmountCents, :zero) - :amountDelta, " +
              "updatedAt = :updatedAt, version = if_not_exists(version, :zero) + :versionIncrement, fullyFunded = :fullyFunded",
            ExpressionAttributeValues: {
              ":amountDelta": reservation.amountCents,
              ":fullyFunded": state.confirmedAmountCents >= gift.totalValueCents,
              ":partsDelta": quantity,
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
    try {
      return await this.applyWebhookUpdate({
        paymentId: input.paymentId,
        expectedCurrentStatus: input.expectedCurrentStatus,
        nextStatus: "EXPIRED"
      });
    } catch (error) {
      if (error instanceof TransactionCanceledException && isConditionalCheckOnlyCancellation(error)) {
        return false;
      }

      throw error;
    }
  }
}
