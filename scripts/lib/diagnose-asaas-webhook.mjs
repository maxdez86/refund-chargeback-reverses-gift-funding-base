import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

function paymentKeys(paymentId) {
  return {
    PK: `PAYMENT#${paymentId}`,
    SK: "PAYMENT"
  };
}

function webhookKeys(eventId) {
  return {
    PK: "WEBHOOK#asaas",
    SK: `EVENT#${eventId}`
  };
}

function asaasPaymentLookupIndex(asaasPaymentId) {
  return {
    GSI1PK: `ASAAS#PAYMENT#${asaasPaymentId}`,
    GSI1SK: "PAYMENT"
  };
}

function asaasCheckoutLookupIndex(asaasCheckoutId) {
  return {
    GSI1PK: `ASAAS#CHECKOUT#${asaasCheckoutId}`,
    GSI1SK: "PAYMENT"
  };
}

function buildDefaultTableName(stage) {
  return `${stage === "prod" ? "" : "dev-"}brimax-wedding`;
}

function buildDefaultAsaasApiBaseUrl(stage) {
  return stage === "prod" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
}

function parseWebhookPayload(payload) {
  if (!payload) {
    return {};
  }

  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function extractReferences({ asaasPaymentId, webhookEvent }) {
  const payload = webhookEvent ? parseWebhookPayload(webhookEvent.payload) : {};

  return {
    asaasPaymentId: payload?.payment?.id ?? webhookEvent?.asaasPaymentId ?? asaasPaymentId,
    asaasCheckoutId: payload?.payment?.checkoutSession ?? webhookEvent?.asaasCheckoutId,
    externalReference: payload?.payment?.externalReference ?? payload?.externalReference ?? webhookEvent?.externalReference
  };
}

async function asaasRequest({ apiBaseUrl, apiKey, fetchImpl, path }) {
  const response = await fetchImpl(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      access_token: apiKey
    },
    method: "GET"
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = parsed?.errors ?? parsed?.message ?? `Asaas request failed with status ${response.status}.`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  return parsed;
}

export async function fetchAsaasPaymentById({
  apiBaseUrl,
  apiKey,
  fetchImpl = fetch,
  paymentId
}) {
  return asaasRequest({
    apiBaseUrl,
    apiKey,
    fetchImpl,
    path: `/payments/${paymentId}`
  });
}

export function createAwsWebhookRepository({
  documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({})),
  tableName
}) {
  return {
    async getPayment(paymentId) {
      const response = await documentClient.send(
        new GetCommand({
          Key: paymentKeys(paymentId),
          TableName: tableName
        })
      );

      return response.Item ?? null;
    },
    async getPaymentByAsaasCheckoutId(asaasCheckoutId) {
      const response = await documentClient.send(
        new QueryCommand({
          ExpressionAttributeValues: {
            ":gsi1pk": asaasCheckoutLookupIndex(asaasCheckoutId).GSI1PK,
            ":gsi1sk": asaasCheckoutLookupIndex(asaasCheckoutId).GSI1SK
          },
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
          Limit: 1,
          TableName: tableName
        })
      );

      return response.Items?.[0] ?? null;
    },
    async getPaymentByAsaasPaymentId(asaasPaymentId) {
      const response = await documentClient.send(
        new QueryCommand({
          ExpressionAttributeValues: {
            ":gsi1pk": asaasPaymentLookupIndex(asaasPaymentId).GSI1PK,
            ":gsi1sk": asaasPaymentLookupIndex(asaasPaymentId).GSI1SK
          },
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk",
          Limit: 1,
          TableName: tableName
        })
      );

      return response.Items?.[0] ?? null;
    },
    async getWebhookEvent(eventId) {
      const response = await documentClient.send(
        new GetCommand({
          Key: webhookKeys(eventId),
          TableName: tableName
        })
      );

      return response.Item ?? null;
    }
  };
}

async function lookupPayment(repository, references, resolutionSourceByLookup) {
  const localLookupMatches = {
    asaasCheckoutId: false,
    asaasPaymentId: false,
    externalReference: false
  };

  if (references.asaasPaymentId) {
    const payment = await repository.getPaymentByAsaasPaymentId(references.asaasPaymentId);
    if (payment) {
      localLookupMatches.asaasPaymentId = true;
      return {
        localLookupMatches,
        payment,
        resolutionSource: resolutionSourceByLookup.asaasPaymentId
      };
    }
  }

  if (references.asaasCheckoutId) {
    const payment = await repository.getPaymentByAsaasCheckoutId(references.asaasCheckoutId);
    if (payment) {
      localLookupMatches.asaasCheckoutId = true;
      return {
        localLookupMatches,
        payment,
        resolutionSource: resolutionSourceByLookup.asaasCheckoutId
      };
    }
  }

  if (references.externalReference) {
    const payment = await repository.getPayment(references.externalReference);
    if (payment) {
      localLookupMatches.externalReference = true;
      return {
        localLookupMatches,
        payment,
        resolutionSource: resolutionSourceByLookup.externalReference
      };
    }
  }

  return {
    localLookupMatches,
    payment: null,
    resolutionSource: "unresolved"
  };
}

function classifyDiagnosis(result) {
  if (result.payment) {
    return "stale-deployment";
  }

  if (!result.identifiers.asaasPaymentId && !result.identifiers.asaasCheckoutId && !result.identifiers.externalReference) {
    return "missing-webhook-identifiers";
  }

  if (
    result.asaasFallbackAttempted &&
    !result.recoveredIdentifiers.asaasCheckoutId &&
    !result.recoveredIdentifiers.externalReference
  ) {
    return "asaas-missing-references";
  }

  if (
    result.identifiers.asaasPaymentId ||
    result.identifiers.asaasCheckoutId ||
    result.identifiers.externalReference ||
    result.recoveredIdentifiers.asaasCheckoutId ||
    result.recoveredIdentifiers.externalReference
  ) {
    return "local-payment-missing";
  }

  return "unclassified";
}

export async function diagnoseAsaasWebhook({
  apiBaseUrl,
  apiKey,
  asaasPaymentId,
  eventId,
  fetchImpl = fetch,
  repository,
  webhookEvent
}) {
  if (!eventId && !asaasPaymentId) {
    throw new Error("Provide --event-id or --asaas-payment-id.");
  }

  const storedWebhookEvent = webhookEvent ?? (eventId ? await repository.getWebhookEvent(eventId) : null);
  const identifiers = extractReferences({
    asaasPaymentId,
    webhookEvent: storedWebhookEvent
  });

  const initialLookup = await lookupPayment(repository, identifiers, {
    asaasCheckoutId: "asaas_checkout_id",
    asaasPaymentId: "asaas_payment_id",
    externalReference: "external_reference"
  });

  let recoveredIdentifiers = {
    asaasCheckoutId: undefined,
    externalReference: undefined
  };
  let asaasFallbackAttempted = false;
  let asaasPayment = null;
  let finalLookup = initialLookup;

  if (!initialLookup.payment && identifiers.asaasPaymentId) {
    if (!apiBaseUrl || !apiKey) {
      throw new Error("ASAAS_API_KEY and ASAAS_API_BASE_URL are required when Asaas fallback lookup is needed.");
    }

    asaasFallbackAttempted = true;
    asaasPayment = await fetchAsaasPaymentById({
      apiBaseUrl,
      apiKey,
      fetchImpl,
      paymentId: identifiers.asaasPaymentId
    });
    recoveredIdentifiers = {
      asaasCheckoutId: asaasPayment.checkoutSession,
      externalReference: asaasPayment.externalReference
    };
    finalLookup = await lookupPayment(
      repository,
      {
        asaasCheckoutId: identifiers.asaasCheckoutId ?? recoveredIdentifiers.asaasCheckoutId,
        asaasPaymentId: identifiers.asaasPaymentId,
        externalReference: identifiers.externalReference ?? recoveredIdentifiers.externalReference
      },
      {
        asaasCheckoutId: "asaas_fallback_checkout_session",
        asaasPaymentId: "asaas_payment_id",
        externalReference: "asaas_fallback_external_reference"
      }
    );
  }

  const result = {
    asaasFallbackAttempted,
    asaasPayment,
    classification: "unclassified",
    eventFound: Boolean(storedWebhookEvent),
    eventId: eventId ?? storedWebhookEvent?.eventId,
    identifiers,
    localLookupMatches: finalLookup.localLookupMatches,
    payment: finalLookup.payment,
    recoveredIdentifiers,
    resolutionSource: finalLookup.resolutionSource,
    storedWebhookEvent
  };

  result.classification = classifyDiagnosis(result);
  return result;
}

function formatDiagnosis(result) {
  return [
    `Classification: ${result.classification}`,
    `Resolution source: ${result.resolutionSource}`,
    `Stored webhook event found: ${result.eventFound ? "yes" : "no"}`,
    `Asaas fallback attempted: ${result.asaasFallbackAttempted ? "yes" : "no"}`,
    "",
    JSON.stringify(
      {
        eventId: result.eventId,
        identifiers: result.identifiers,
        localLookupMatches: result.localLookupMatches,
        matchedPaymentId: result.payment?.paymentId,
        recoveredIdentifiers: result.recoveredIdentifiers
      },
      null,
      2
    )
  ].join("\n");
}

export async function runFromCli({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  logger = console
} = {}) {
  const options = parseArgs(argv);
  const stage = options.stage ?? env.STAGE ?? "prod";
  const tableName = env.WEDDING_TABLE_NAME ?? env.PAYMENTS_TABLE_NAME ?? buildDefaultTableName(stage);
  const apiBaseUrl = env.ASAAS_API_BASE_URL ?? buildDefaultAsaasApiBaseUrl(stage);
  const repository = createAwsWebhookRepository({ tableName });

  const result = await diagnoseAsaasWebhook({
    apiBaseUrl,
    apiKey: env.ASAAS_API_KEY,
    asaasPaymentId: options.asaasPaymentId,
    eventId: options.eventId,
    fetchImpl,
    repository
  });

  logger.log(formatDiagnosis(result));

  if (!result.payment) {
    process.exitCode = 1;
  }

  return result;
}

function parseArgs(argv) {
  const args = {
    asaasPaymentId: undefined,
    eventId: undefined,
    stage: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--event-id") {
      args.eventId = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--asaas-payment-id") {
      args.asaasPaymentId = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--stage") {
      args.stage = argv[index + 1];
      index += 1;
    }
  }

  return args;
}
