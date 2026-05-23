type Env = {
  adminExportToken: string;
  asaasApiBaseUrl: string;
  asaasCheckoutBaseUrl: string;
  asaasApiSecretArn: string;
  asaasWebhookSecretArn: string;
  contactEmail: string;
  emailFrom: string;
  emailConfigurationSetName?: string;
  hostedCheckoutSuccessUrl: string;
  rsvpNotificationTo: string;
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

export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const contactEmail = process.env.CONTACT_EMAIL ?? "casamento@brimax.life";

  cachedEnv = {
    adminExportToken: process.env.ADMIN_EXPORT_TOKEN ?? "",
    asaasApiBaseUrl: process.env.ASAAS_API_BASE_URL ?? "https://api-sandbox.asaas.com/v3",
    asaasCheckoutBaseUrl:
      process.env.ASAAS_CHECKOUT_BASE_URL ?? "https://www.asaas.com/checkoutSession/show",
    asaasApiSecretArn: process.env.ASAAS_API_SECRET_ARN ?? "",
    asaasWebhookSecretArn: process.env.ASAAS_WEBHOOK_SECRET_ARN ?? "",
    contactEmail,
    emailFrom: process.env.EMAIL_FROM ?? contactEmail,
    emailConfigurationSetName: process.env.EMAIL_CONFIGURATION_SET_NAME?.trim() || undefined,
    hostedCheckoutSuccessUrl: process.env.HOSTED_CHECKOUT_SUCCESS_URL ?? "https://brimax.life",
    rsvpNotificationTo: process.env.RSVP_NOTIFICATION_TO ?? contactEmail,
    webhookQueueUrl: process.env.WEBHOOK_QUEUE_URL ?? "",
    weddingTableName: required("WEDDING_TABLE_NAME")
  };

  return cachedEnv;
}
