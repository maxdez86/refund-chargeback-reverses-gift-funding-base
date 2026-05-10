import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient
} from "@aws-sdk/lib-dynamodb";
import type { PaymentMethod, PaymentStatus, PaymentSummary } from "@brimax/contracts";
import { dynamoDbDocumentClient } from "../client";
import { getEnv } from "../../../lib/env";
import { AppError } from "../../../lib/errors";
import {
  asaasPaymentLookupIndex,
  idempotencyKeys,
  paymentKeys,
  webhookKeys
} from "../key-builder";
import { GSI1_NAME, TTL_ATTRIBUTE } from "../table";
import { PAYMENT_STATUS_RANK } from "../../../domain/payment-state";

type StoredPayment = PaymentSummary & {
  asaasPaymentId: string;
  externalReference: string;
  payerCpfHash: string;
  payerCpfMasked: string;
  payerEmail: string;
  payerName: string;
};

type StoredWebhookEvent = {
  eventId: string;
  eventType: string;
  payload: string;
  asaasPaymentId?: string;
  externalReference?: string;
  processedAt?: string;
};

type IdempotencyReservation = {
  fingerprint: string;
  paymentId: string;
  status: "IN_PROGRESS" | "COMPLETED";
};

export class PaymentRepository {
  constructor(
    private readonly documentClient: DynamoDBDocumentClient = dynamoDbDocumentClient,
    private readonly tableName = getEnv().weddingTableName
  ) {}

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

  async completeCreatePayment(idempotencyKey: string) {
    await this.documentClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: idempotencyKeys(idempotencyKey),
        UpdateExpression: "SET #status = :status, completedAt = :completedAt",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "COMPLETED",
          ":completedAt": new Date().toISOString()
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
      status: String(response.Item.status) as IdempotencyReservation["status"]
    };
  }

  async putPayment(payment: StoredPayment) {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...paymentKeys(payment.paymentId),
            ...asaasPaymentLookupIndex(payment.asaasPaymentId),
            entityType: "Payment",
            ...payment,
            statusRank: PAYMENT_STATUS_RANK[payment.status]
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

  async getPayment(paymentId: string): Promise<StoredPayment | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: paymentKeys(paymentId)
      })
    );

    return (response.Item as StoredPayment | undefined) ?? null;
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

  async recordWebhookEventIfNew(input: {
    eventId: string;
    eventType: string;
    payload: string;
    asaasPaymentId?: string;
    externalReference?: string;
    ttlInSeconds?: number;
  }) {
    const ttlInSeconds = input.ttlInSeconds ?? 30 * 24 * 60 * 60;

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
            payload: input.payload,
            asaasPaymentId: input.asaasPaymentId,
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
    paymentId: string;
    nextStatus: PaymentStatus;
    confirmedOn?: string;
    receivedOn?: string;
    asaasPaymentId: string;
  }) {
    const statusRank = PAYMENT_STATUS_RANK[input.nextStatus];
    const updateParts = [
      "#status = :status",
      "statusRank = :statusRank",
      "updatedAt = :updatedAt",
      "asaasPaymentId = :asaasPaymentId"
    ];
    const expressionAttributeValues: Record<string, unknown> = {
      ":status": input.nextStatus,
      ":statusRank": statusRank,
      ":updatedAt": new Date().toISOString(),
      ":asaasPaymentId": input.asaasPaymentId
    };

    if (input.confirmedOn) {
      updateParts.push("confirmedOn = if_not_exists(confirmedOn, :confirmedOn)");
      expressionAttributeValues[":confirmedOn"] = input.confirmedOn;
    }

    if (input.receivedOn) {
      updateParts.push("receivedOn = if_not_exists(receivedOn, :receivedOn)");
      expressionAttributeValues[":receivedOn"] = input.receivedOn;
    }

    try {
      await this.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: paymentKeys(input.paymentId),
          ConditionExpression: "attribute_not_exists(statusRank) OR statusRank <= :statusRank",
          UpdateExpression: `SET ${updateParts.join(", ")}`,
          ExpressionAttributeNames: {
            "#status": "status"
          },
          ExpressionAttributeValues: expressionAttributeValues
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
}
