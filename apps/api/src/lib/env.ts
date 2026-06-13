import { resolveStage, stageAllowedOrigins, stageSiteUrl } from "@brimax/config";

type Env = {
  allowedOrigins: string[];
  asaasApiBaseUrl: string;
  asaasCheckoutBaseUrl: string;
  appSecretArn: string;
  contactEmail: string;
  emailFrom: string;
  emailConfigurationSetName?: string;
  expiryQueueUrl: string;
  hostedCheckoutSuccessUrl: string;
  rsvpNotificationTo: string;
  siteBaseUrl: string;
  siteLabel: string;
  siteOrigin: string;
  webhookQueueUrl: string;
  weddingTableName: string;
};

let cachedEnv: Env | null = null;

function required(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
}

function configuredSiteBaseUrl() {
  const stage = resolveStage(process.env.STAGE);
  const defaultUrl = stageSiteUrl(stage);

  return (
    process.env.SITE_BASE_URL?.trim() ||
    process.env.PAYMENTS_SITE_BASE_URL?.trim() ||
    process.env.HOSTED_CHECKOUT_SUCCESS_URL?.trim() ||
    defaultUrl
  );
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

export function resolveSiteBaseUrl() {
  return configuredSiteBaseUrl();
}

export function resolveSiteOrigin() {
  return normalizeOrigin(resolveSiteBaseUrl());
}

export function resolveSiteLabel() {
  const siteBaseUrl = resolveSiteBaseUrl();

  try {
    return new URL(siteBaseUrl).host;
  } catch {
    return siteBaseUrl.replace(/^https?:\/\//, "");
  }
}

function configuredAllowedOrigins(siteOrigin: string) {
  const configured = process.env.ALLOWED_ORIGINS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  const stage = resolveStage(process.env.STAGE);
  const defaults = stageAllowedOrigins(stage);

  return defaults.length > 0 ? defaults : [siteOrigin];
}

export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const contactEmail = process.env.CONTACT_EMAIL ?? "casamento@brimax.life";
  const siteBaseUrl = resolveSiteBaseUrl();
  const siteOrigin = resolveSiteOrigin();
  const siteLabel = resolveSiteLabel();
  const stage = resolveStage(process.env.STAGE);

  cachedEnv = {
    allowedOrigins: configuredAllowedOrigins(siteOrigin),
    asaasApiBaseUrl:
      process.env.ASAAS_API_BASE_URL ??
      (stage === "prod" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3"),
    asaasCheckoutBaseUrl:
      process.env.ASAAS_CHECKOUT_BASE_URL ??
      (stage === "prod"
        ? "https://www.asaas.com/checkoutSession/show"
        : "https://sandbox.asaas.com/checkoutSession/show"),
    appSecretArn: process.env.APP_SECRET_ARN ?? "",
    contactEmail,
    emailFrom: process.env.EMAIL_FROM ?? contactEmail,
    emailConfigurationSetName: process.env.EMAIL_CONFIGURATION_SET_NAME?.trim() || undefined,
    expiryQueueUrl: process.env.EXPIRY_QUEUE_URL ?? "",
    hostedCheckoutSuccessUrl: process.env.HOSTED_CHECKOUT_SUCCESS_URL?.trim() || siteBaseUrl,
    rsvpNotificationTo: process.env.RSVP_NOTIFICATION_TO ?? contactEmail,
    siteBaseUrl,
    siteLabel,
    siteOrigin,
    webhookQueueUrl: process.env.WEBHOOK_QUEUE_URL ?? "",
    weddingTableName: required("WEDDING_TABLE_NAME")
  };

  return cachedEnv;
}
