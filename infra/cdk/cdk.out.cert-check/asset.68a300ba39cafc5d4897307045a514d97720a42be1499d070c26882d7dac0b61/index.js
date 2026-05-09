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

// apps/api/src/functions/asaas-webhook/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_client_sqs = require("@aws-sdk/client-sqs");

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

// apps/api/src/lib/http.ts
function toHeaderRecord(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}
function jsonResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: toHeaderRecord({
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,idempotency-key,x-admin-token,asaas-access-token",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      ...headers
    }),
    body: JSON.stringify(body)
  };
}
function noContentResponse(headers = {}) {
  return {
    statusCode: 204,
    headers: toHeaderRecord({
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,idempotency-key,x-admin-token,asaas-access-token",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      ...headers
    })
  };
}

// apps/api/src/lib/security.ts
var import_node_crypto = require("node:crypto");
function hashValue(value) {
  return (0, import_node_crypto.createHash)("sha256").update(value).digest("hex");
}
function rawBodyHash(value) {
  return hashValue(value);
}
function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return (0, import_node_crypto.timingSafeEqual)(leftBuffer, rightBuffer);
}

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

// apps/api/src/services/secrets-manager/secret-cache.ts
var import_client_secrets_manager = require("@aws-sdk/client-secrets-manager");
var client2 = new import_client_secrets_manager.SecretsManagerClient({});
var cache = /* @__PURE__ */ new Map();
var DEFAULT_TTL_MS = 5 * 60 * 1e3;
async function getSecretValue(secretId, ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now();
  const cached = cache.get(secretId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const response = await client2.send(
    new import_client_secrets_manager.GetSecretValueCommand({
      SecretId: secretId
    })
  );
  const value = response.SecretString ?? "";
  cache.set(secretId, {
    expiresAt: now + ttlMs,
    value
  });
  return value;
}

// apps/api/src/functions/asaas-webhook/handler.ts
var repository = new PaymentRepository();
var sqsClient = new import_client_sqs.SQSClient({});
function parseWebhookSecret(secretValue) {
  try {
    const parsed = JSON.parse(secretValue);
    return parsed.value ?? parsed.token ?? secretValue;
  } catch {
    return secretValue;
  }
}
async function handler(event) {
  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse();
  }
  const tokenHeader = event.headers["asaas-access-token"] ?? event.headers["Asaas-Access-Token"];
  const webhookSecretArn = getEnv().asaasWebhookSecretArn;
  const webhookSecret = parseWebhookSecret(await getSecretValue(webhookSecretArn));
  if (!tokenHeader || !safeEqual(tokenHeader, webhookSecret)) {
    console.error(JSON.stringify({ metric: "WEBHOOK_AUTH_FAILED" }));
    return jsonResponse(403, { message: "Forbidden." });
  }
  const rawBody = event.body ?? "{}";
  const payload = JSON.parse(rawBody);
  const eventId = rawBodyHash(rawBody);
  const accepted = await repository.recordWebhookEventIfNew({
    eventId,
    eventType: String(payload.event ?? "UNKNOWN"),
    payload: rawBody,
    asaasPaymentId: payload.payment?.id ?? payload.id,
    externalReference: payload.payment?.externalReference ?? payload.externalReference
  });
  if (accepted) {
    await sqsClient.send(
      new import_client_sqs.SendMessageCommand({
        QueueUrl: getEnv().webhookQueueUrl,
        MessageBody: JSON.stringify({ eventId })
      })
    );
  } else {
    console.info(JSON.stringify({ metric: "WEBHOOK_DUPLICATE", eventId }));
  }
  return jsonResponse(200, {
    ok: true,
    duplicate: !accepted,
    eventId
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
