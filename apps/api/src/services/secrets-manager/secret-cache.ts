import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

type CachedSecret = {
  expiresAt: number;
  value: string;
};

const client = new SecretsManagerClient({});
const cache = new Map<string, CachedSecret>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export async function getSecretValue(secretId: string, ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now();
  const cached = cache.get(secretId);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const response = await client.send(
    new GetSecretValueCommand({
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
