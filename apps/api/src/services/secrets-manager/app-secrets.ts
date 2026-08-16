import { getEnv } from "../../lib/env";
import { getSecretValueWithMetadata } from "./secret-cache";

export type AppSecretKey =
  | "asaasApiKey"
  | "asaasWebhookToken"
  | "turnstileSecretKey"
  | "lookupProofSecret"
  | "whatsappVerifyToken"
  | "whatsappAppSecret"
  | "whatsappAccessToken";

function parseBucket(raw: string): Partial<Record<AppSecretKey, string>> {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Partial<Record<AppSecretKey, string>>;
  } catch {
    return {};
  }
}

export async function getAppSecretWithMetadata(key: AppSecretKey) {
  const { cacheHit, value } = await getSecretValueWithMetadata(getEnv().appSecretArn);
  return { cacheHit, value: parseBucket(value)[key] ?? "" };
}

export async function getAppSecret(key: AppSecretKey) {
  return (await getAppSecretWithMetadata(key)).value;
}
