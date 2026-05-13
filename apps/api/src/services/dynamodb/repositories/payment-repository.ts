import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient
} from "@aws-sdk/lib-dynamodb";
import type { PaymentStatus, PaymentSummary } from "@brimax/contracts";
import { dynamoDbDocumentClient } from "../client";
import { getEnv } from "../../../lib/env";
import { AppError } from "../../../lib/errors";
import {
  asaasCheckoutLookupIndex,
  asaasPaymentLookupIndex,
  idempotencyKeys,
  paymentMessageKeys,
  paymentNotificationKeys,
  paymentKeys,
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

type IdempotencyReservation = {
  fingerprint: string;
  paymentId: string;
  status: "IN_PROGRESS" | "COMPLETED";
  paymentSnapshot?: PaymentSummary;
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
    paymentId: string;
    expectedCurrentStatus: PaymentStatus;
    nextStatus: PaymentStatus;
    confirmedOn?: string;
    receivedOn?: string;
    asaasPaymentId?: string;
    asaasCheckoutId?: string;
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

      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }

      throw error;
    }
  }
}
