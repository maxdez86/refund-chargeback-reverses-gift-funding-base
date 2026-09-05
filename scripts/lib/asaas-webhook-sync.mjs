const MANAGED_ASAAS_WEBHOOK_EVENTS = [
  "CHECKOUT_CREATED",
  "CHECKOUT_CANCELED",
  "CHECKOUT_EXPIRED",
  "CHECKOUT_PAID",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL"
];

const MANAGED_STAGES = new Set(["prod", "dev"]);

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const id = String(item.id ?? "");

    if (!id || seen.has(id)) {
      return false;
    }

    seen.add(id);
    return true;
  });
}

export function buildManagedWebhookConfig({
  apiDomain,
  contactEmail,
  stage,
  webhookToken,
  webhookUrl
}) {
  return {
    name: `brimax-${stage}-asaas-webhook`,
    url: webhookUrl ?? `https://${apiDomain}/webhooks/asaas`,
    email: contactEmail,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken: webhookToken,
    sendType: "SEQUENTIALLY",
    events: [...MANAGED_ASAAS_WEBHOOK_EVENTS]
  };
}

export function findManagedWebhook(webhooks, desiredWebhook) {
  const urlMatches = uniqueById(webhooks.filter((webhook) => webhook.url === desiredWebhook.url));
  const nameMatches = uniqueById(webhooks.filter((webhook) => webhook.name === desiredWebhook.name));

  if (urlMatches.length > 1) {
    throw new Error(
      `Found multiple Asaas webhooks with URL ${desiredWebhook.url}. Refusing to choose one automatically.`
    );
  }

  if (urlMatches.length === 1) {
    return urlMatches[0];
  }

  if (nameMatches.length > 1) {
    throw new Error(
      `Found multiple Asaas webhooks with name ${desiredWebhook.name}. Refusing to choose one automatically.`
    );
  }

  return nameMatches[0] ?? null;
}

export function verifyManagedWebhook(webhook, desiredWebhook) {
  const actualEvents = [...(Array.isArray(webhook.events) ? webhook.events : [])].sort();
  const expectedEvents = [...desiredWebhook.events].sort();
  const mismatches = [];

  for (const field of ["name", "url", "email", "enabled", "interrupted", "apiVersion", "sendType"]) {
    if (webhook[field] !== desiredWebhook[field]) {
      mismatches.push(`${field}=${JSON.stringify(webhook[field])}`);
    }
  }

  if (webhook.hasAuthToken !== true) {
    mismatches.push(`hasAuthToken=${JSON.stringify(webhook.hasAuthToken)}`);
  }

  if (JSON.stringify(actualEvents) !== JSON.stringify(expectedEvents)) {
    const missingEvents = expectedEvents.filter((event) => !actualEvents.includes(event));
    const unexpectedEvents = actualEvents.filter((event) => !expectedEvents.includes(event));
    mismatches.push(
      `events missing=${JSON.stringify(missingEvents)} unexpected=${JSON.stringify(unexpectedEvents)}`
    );
  }

  if (mismatches.length > 0) {
    throw new Error(`Asaas webhook verification failed: ${mismatches.join(", ")}.`);
  }

  return webhook;
}

// Asaas (and the gateway/WAF in front of it) occasionally answers with a
// non-JSON body — an HTML error/maintenance page on 5xx, a throttling page on
// 429, or a block page. Parsing that as JSON used to throw the opaque
// "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON" and hid the real
// HTTP status. These statuses are transient and safe to retry on reads.
const TRANSIENT_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_GET_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeResponseBody(text) {
  const trimmed = (text ?? "").trim();

  if (!trimmed) {
    return "<empty response body>";
  }

  const singleLine = trimmed.replace(/\s+/g, " ");
  return singleLine.length > 200 ? `${singleLine.slice(0, 200)}…` : singleLine;
}

async function asaasRequest({ apiBaseUrl, apiKey, body, fetchImpl, method = "GET", path }) {
  const url = `${normalizeBaseUrl(apiBaseUrl)}${path}`;
  // Only idempotent reads are retried; a create/update must never be replayed.
  const maxAttempts = method === "GET" ? MAX_GET_ATTEMPTS : 1;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(url, {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        access_token: apiKey
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    let parsed;
    let parseFailed = false;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parseFailed = true;
    }

    if (response.ok && !parseFailed) {
      return parsed;
    }

    // Build an actionable error: the real status plus the structured Asaas error
    // when present, or a snippet of the raw (likely HTML) body otherwise.
    const structuredDetail = !parseFailed && parsed ? parsed.errors ?? parsed.message : undefined;
    const detail = structuredDetail ?? summarizeResponseBody(text);
    const detailText = typeof detail === "string" ? detail : JSON.stringify(detail);
    lastError = new Error(
      response.ok
        ? `Asaas ${method} ${path} returned a non-JSON ${response.status} response: ${detailText}`
        : `Asaas ${method} ${path} failed with status ${response.status}: ${detailText}`
    );

    const transient = TRANSIENT_RETRY_STATUSES.has(response.status) || (response.ok && parseFailed);
    if (attempt < maxAttempts && transient) {
      await sleep(RETRY_BASE_DELAY_MS * attempt);
      continue;
    }

    throw lastError;
  }

  // Loop always returns or throws above; this satisfies control-flow analysis.
  throw lastError ?? new Error(`Asaas ${method} ${path} failed.`);
}

export async function syncAsaasWebhook({
  apiBaseUrl,
  apiDomain,
  apiKey,
  contactEmail,
  fetchImpl = fetch,
  logger = console,
  stage,
  webhookToken,
  webhookUrl
}) {
  if (!MANAGED_STAGES.has(stage)) {
    logger.info(`Skipping Asaas webhook sync for STAGE=${stage}. Only prod and dev are managed.`);
    return {
      action: "skipped",
      reason: "unsupported-stage"
    };
  }

  const desiredWebhook = buildManagedWebhookConfig({
    apiDomain,
    contactEmail,
    stage,
    webhookToken,
    webhookUrl
  });
  const listResponse = await asaasRequest({
    apiBaseUrl,
    apiKey,
    fetchImpl,
    path: "/webhooks?limit=100"
  });
  const webhooks = Array.isArray(listResponse.data) ? listResponse.data : [];
  const existingWebhook = findManagedWebhook(webhooks, desiredWebhook);
  let action;
  let webhookId;

  if (!existingWebhook) {
    const createdWebhook = await asaasRequest({
      apiBaseUrl,
      apiKey,
      body: desiredWebhook,
      fetchImpl,
      method: "POST",
      path: "/webhooks"
    });

    logger.info(`Created Asaas webhook for ${desiredWebhook.url}.`);
    action = "created";
    webhookId = createdWebhook.id;
  } else {
    const updatedWebhook = await asaasRequest({
      apiBaseUrl,
      apiKey,
      body: desiredWebhook,
      fetchImpl,
      method: "PUT",
      path: `/webhooks/${existingWebhook.id}`
    });

    logger.info(`Updated Asaas webhook ${existingWebhook.id} for ${desiredWebhook.url}.`);
    action = "updated";
    webhookId = updatedWebhook.id ?? existingWebhook.id;
  }

  if (!webhookId) {
    throw new Error("Asaas webhook synchronization did not return a webhook id.");
  }

  const verifiedWebhook = verifyManagedWebhook(
    await asaasRequest({
      apiBaseUrl,
      apiKey,
      fetchImpl,
      path: `/webhooks/${webhookId}`
    }),
    desiredWebhook
  );

  logger.info(`Verified Asaas webhook ${webhookId} for ${desiredWebhook.url}.`);
  return {
    action,
    webhook: verifiedWebhook
  };
}

export async function runFromEnv({ fetchImpl = fetch, logger = console } = {}) {
  const stage = process.env.STAGE ?? "prod";
  const apiBaseUrl = process.env.ASAAS_API_BASE_URL ?? "https://api.asaas.com/v3";
  const apiDomain = requiredEnv("API_DOMAIN");
  const contactEmail = requiredEnv("CONTACT_EMAIL");
  const apiKey = requiredEnv("ASAAS_API_KEY");
  const webhookToken = requiredEnv("ASAAS_WEBHOOK_TOKEN");
  const webhookUrl = process.env.PAYMENTS_WEBHOOK_URL ?? `https://${apiDomain}/webhooks/asaas`;

  return syncAsaasWebhook({
    apiBaseUrl,
    apiDomain,
    apiKey,
    contactEmail,
    fetchImpl,
    logger,
    stage,
    webhookToken,
    webhookUrl
  });
}

export { MANAGED_ASAAS_WEBHOOK_EVENTS };
