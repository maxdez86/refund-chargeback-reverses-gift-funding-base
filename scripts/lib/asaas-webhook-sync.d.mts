export const MANAGED_ASAAS_WEBHOOK_EVENTS: string[];

export function buildManagedWebhookConfig(input: {
  apiDomain: string;
  contactEmail: string;
  webhookToken: string;
  webhookUrl?: string;
}): {
  name: string;
  url: string;
  email: string;
  enabled: boolean;
  interrupted: boolean;
  apiVersion: number;
  authToken: string;
  sendType: string;
  events: string[];
};

export function findManagedWebhook(
  webhooks: Array<Record<string, unknown>>,
  desiredWebhook: { name: string; url: string }
): Record<string, unknown> | null;

export function syncAsaasWebhook(input: {
  apiBaseUrl: string;
  apiDomain: string;
  apiKey: string;
  contactEmail: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "info" | "error">;
  stage: string;
  webhookToken: string;
  webhookUrl?: string;
}): Promise<{
  action: "skipped" | "created" | "updated";
  reason?: string;
  webhook?: unknown;
}>;

export function runFromEnv(input?: {
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "info" | "error">;
}): Promise<{
  action: "skipped" | "created" | "updated";
  reason?: string;
  webhook?: unknown;
}>;
