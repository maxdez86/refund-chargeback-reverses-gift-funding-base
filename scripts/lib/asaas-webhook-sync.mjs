const MANAGED_ASAAS_WEBHOOK_EVENTS = [
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
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

async function asaasRequest({ apiBaseUrl, apiKey, body, fetchImpl, method = "GET", path }) {
  const response = await fetchImpl(`${normalizeBaseUrl(apiBaseUrl)}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      access_token: apiKey
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message =
      parsed?.errors ?? parsed?.message ?? `Asaas request failed with status ${response.status}.`;
    throw new Error(
      typeof message === "string" ? message : JSON.stringify(message)
    );
  }

  return parsed;
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
    return {
      action: "created",
      webhook: createdWebhook
    };
  }

  const updatedWebhook = await asaasRequest({
    apiBaseUrl,
    apiKey,
    body: desiredWebhook,
    fetchImpl,
    method: "PUT",
    path: `/webhooks/${existingWebhook.id}`
  });

  logger.info(`Updated Asaas webhook ${existingWebhook.id} for ${desiredWebhook.url}.`);
  return {
    action: "updated",
    webhook: updatedWebhook
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
