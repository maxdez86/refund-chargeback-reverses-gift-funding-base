"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// apps/api/src/functions/asaas-webhook-processor/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);

// apps/api/src/services/dynamodb/repositories/payment-repository.ts
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");

// apps/api/src/services/dynamodb/client.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var client = new import_client_dynamodb.DynamoDBClient({});
var dynamoDbDocumentClient = import_lib_dynamodb.DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

// apps/api/src/lib/env.ts
var cachedEnv = null;
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}
function getEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }
  cachedEnv = {
    adminExportToken: process.env.ADMIN_EXPORT_TOKEN ?? "",
    asaasApiBaseUrl: process.env.ASAAS_API_BASE_URL ?? "https://api-sandbox.asaas.com/v3",
    asaasApiSecretArn: process.env.ASAAS_API_SECRET_ARN ?? "",
    asaasWebhookSecretArn: process.env.ASAAS_WEBHOOK_SECRET_ARN ?? "",
    webhookQueueUrl: process.env.WEBHOOK_QUEUE_URL ?? "",
    weddingTableName: required("WEDDING_TABLE_NAME")
  };
  return cachedEnv;
}

// apps/api/src/lib/errors.ts
var AppError = class extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = "AppError";
  }
};

// apps/api/src/services/dynamodb/key-builder.ts
function webhookKeys(provider, eventId) {
  return {
    PK: `WEBHOOK#${provider}`,
    SK: `EVENT#${eventId}`
  };
}
function paymentKeys(paymentId) {
  return {
    PK: `PAYMENT#${paymentId}`,
    SK: "PAYMENT"
  };
}
function idempotencyKeys(idempotencyKey) {
  return {
    PK: `IDEMPOTENCY#${idempotencyKey}`,
    SK: "PAYMENT"
  };
}
function asaasPaymentLookupIndex(asaasPaymentId) {
  return {
    GSI1PK: `ASAAS#PAYMENT#${asaasPaymentId}`,
    GSI1SK: "PAYMENT"
  };
}

// apps/api/src/services/dynamodb/table.ts
var GSI1_NAME = "gsi1";
var TTL_ATTRIBUTE = "ttl";

// apps/api/src/domain/payment-state.ts
var PAYMENT_STATUS_RANK = {
  CREATED: 10,
  AWAITING_PAYMENT: 20,
  PROCESSING: 30,
  CONFIRMED: 40,
  RECEIVED: 50,
  EXPIRED: 60,
  CANCELED: 70,
  FAILED: 80,
  REFUNDED: 90,
  CHARGEBACK: 100
};
function mapAsaasWebhookToPaymentStatus(payload) {
  const status = String(payload.payment?.status ?? payload.status ?? "").toUpperCase();
  const event = String(payload.event ?? "").toUpperCase();
  if (status === "RECEIVED_IN_CASH" || status === "RECEIVED" || event.includes("RECEIVED")) {
    return "RECEIVED";
  }
  if (status === "CONFIRMED" || event.includes("CONFIRMED")) {
    return "CONFIRMED";
  }
  if (status === "REFUNDED" || event.includes("REFUND")) {
    return "REFUNDED";
  }
  if (status === "CHARGEBACK" || event.includes("CHARGEBACK")) {
    return "CHARGEBACK";
  }
  if (status === "CANCELED" || status === "CANCELLED" || event.includes("CANCELED")) {
    return "CANCELED";
  }
  if (status === "OVERDUE" || status === "EXPIRED" || event.includes("OVERDUE")) {
    return "EXPIRED";
  }
  if (status === "FAILED" || status === "ERROR" || event.includes("DENIED") || event.includes("REFUSED") || event.includes("FAILED")) {
    return "FAILED";
  }
  if (status === "PENDING" || event.includes("CREATED")) {
    return "AWAITING_PAYMENT";
  }
  if (status === "PROCESSING" || event.includes("PROCESSING")) {
    return "PROCESSING";
  }
  return "PROCESSING";
}

// apps/api/src/services/dynamodb/repositories/payment-repository.ts
var PaymentRepository = class {
  constructor(documentClient = dynamoDbDocumentClient, tableName = getEnv().weddingTableName) {
    this.documentClient = documentClient;
    this.tableName = tableName;
  }
  async reserveCreatePayment(idempotencyKey, fingerprint, paymentId) {
    try {
      await this.documentClient.send(
        new import_lib_dynamodb2.PutCommand({
          TableName: this.tableName,
          Item: {
            ...idempotencyKeys(idempotencyKey),
            entityType: "PaymentIdempotency",
            idempotencyKey,
            fingerprint,
            paymentId,
            status: "IN_PROGRESS",
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );
      return { accepted: true, reservation: null };
    } catch (error) {
      if (!(error instanceof import_client_dynamodb2.ConditionalCheckFailedException)) {
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
  async completeCreatePayment(idempotencyKey) {
    await this.documentClient.send(
      new import_lib_dynamodb2.UpdateCommand({
        TableName: this.tableName,
        Key: idempotencyKeys(idempotencyKey),
        UpdateExpression: "SET #status = :status, completedAt = :completedAt",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "COMPLETED",
          ":completedAt": (/* @__PURE__ */ new Date()).toISOString()
        }
      })
    );
  }
  async getIdempotencyReservation(idempotencyKey) {
    const response = await this.documentClient.send(
      new import_lib_dynamodb2.GetCommand({
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
      status: String(response.Item.status)
    };
  }
  async putPayment(payment) {
    try {
      await this.documentClient.send(
        new import_lib_dynamodb2.PutCommand({
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
      if (error instanceof import_client_dynamodb2.ConditionalCheckFailedException) {
        return;
      }
      throw error;
    }
  }
  async getPayment(paymentId) {
    const response = await this.documentClient.send(
      new import_lib_dynamodb2.GetCommand({
        TableName: this.tableName,
        Key: paymentKeys(paymentId)
      })
    );
    return response.Item ?? null;
  }
  async getPaymentByAsaasPaymentId(asaasPaymentId) {
    const response = await this.documentClient.send(
      new import_lib_dynamodb2.QueryCommand({
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
    return response.Items?.[0] ?? null;
  }
  async recordWebhookEventIfNew(input) {
    const ttlInSeconds = input.ttlInSeconds ?? 30 * 24 * 60 * 60;
    try {
      await this.documentClient.send(
        new import_lib_dynamodb2.PutCommand({
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
            receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
            [TTL_ATTRIBUTE]: Math.floor(Date.now() / 1e3) + ttlInSeconds
          },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );
      return true;
    } catch (error) {
      if (error instanceof import_client_dynamodb2.ConditionalCheckFailedException) {
        return false;
      }
      throw error;
    }
  }
  async getWebhookEvent(eventId) {
    const response = await this.documentClient.send(
      new import_lib_dynamodb2.GetCommand({
        TableName: this.tableName,
        Key: webhookKeys("asaas", eventId)
      })
    );
    return response.Item ?? null;
  }
  async markWebhookProcessed(eventId, processingResult) {
    await this.documentClient.send(
      new import_lib_dynamodb2.UpdateCommand({
        TableName: this.tableName,
        Key: webhookKeys("asaas", eventId),
        UpdateExpression: "SET processedAt = :processedAt, processingResult = :processingResult",
        ExpressionAttributeValues: {
          ":processedAt": (/* @__PURE__ */ new Date()).toISOString(),
          ":processingResult": processingResult
        }
      })
    );
  }
  async applyWebhookUpdate(input) {
    const statusRank = PAYMENT_STATUS_RANK[input.nextStatus];
    const updateParts = [
      "#status = :status",
      "statusRank = :statusRank",
      "updatedAt = :updatedAt",
      "asaasPaymentId = :asaasPaymentId"
    ];
    const expressionAttributeValues = {
      ":status": input.nextStatus,
      ":statusRank": statusRank,
      ":updatedAt": (/* @__PURE__ */ new Date()).toISOString(),
      ":asaasPaymentId": input.asaasPaymentId
    };
    if (input.confirmedAt) {
      updateParts.push("confirmedAt = if_not_exists(confirmedAt, :confirmedAt)");
      expressionAttributeValues[":confirmedAt"] = input.confirmedAt;
    }
    if (input.receivedAt) {
      updateParts.push("receivedAt = if_not_exists(receivedAt, :receivedAt)");
      expressionAttributeValues[":receivedAt"] = input.receivedAt;
    }
    try {
      await this.documentClient.send(
        new import_lib_dynamodb2.UpdateCommand({
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
      if (error instanceof import_client_dynamodb2.ConditionalCheckFailedException) {
        return false;
      }
      throw error;
    }
  }
};

// apps/api/src/domain/webhook-processor.ts
var WebhookProcessor = class {
  constructor(repository = new PaymentRepository()) {
    this.repository = repository;
  }
  async processEvent(eventId) {
    const storedEvent = await this.repository.getWebhookEvent(eventId);
    if (!storedEvent) {
      throw new AppError("Webhook event not found.", 404);
    }
    if (storedEvent.processedAt) {
      return { duplicate: true };
    }
    const payload = JSON.parse(storedEvent.payload);
    const asaasPaymentId = payload.payment?.id ?? storedEvent.asaasPaymentId;
    const externalReference = payload.payment?.externalReference ?? storedEvent.externalReference;
    if (!asaasPaymentId && !externalReference) {
      throw new AppError("Webhook payload does not contain a payment reference.", 400);
    }
    const payment = (asaasPaymentId ? await this.repository.getPaymentByAsaasPaymentId(asaasPaymentId) : null) ?? (externalReference ? await this.repository.getPayment(externalReference) : null);
    if (!payment) {
      throw new AppError("Payment not found for webhook event.", 404);
    }
    const nextStatus = mapAsaasWebhookToPaymentStatus(payload);
    const applied = await this.repository.applyWebhookUpdate({
      paymentId: payment.paymentId,
      nextStatus,
      confirmedAt: payload.payment?.confirmedDate ?? void 0,
      receivedAt: payload.payment?.clientPaymentDate ?? payload.payment?.paymentDate ?? void 0,
      asaasPaymentId: asaasPaymentId ?? payment.asaasPaymentId
    });
    await this.repository.markWebhookProcessed(eventId, applied ? "updated" : "ignored_stale");
    return { duplicate: false, updated: applied };
  }
};

// apps/api/src/functions/asaas-webhook-processor/handler.ts
var processor = new WebhookProcessor();
async function handler(event) {
  for (const record of event.Records) {
    const message = JSON.parse(record.body);
    const result = await processor.processEvent(message.eventId);
    console.info(
      JSON.stringify({
        metric: "PAYMENT_STATE_TRANSITION",
        eventId: message.eventId,
        duplicate: result.duplicate
      })
    );
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
