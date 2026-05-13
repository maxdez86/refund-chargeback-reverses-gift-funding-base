import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

type CachedSecret = {
  expiresAt: number;
  value: string;
};

type SecretValueResult = {
  cacheHit: boolean;
  value: string;
};

const client = new SecretsManagerClient({});
const cache = new Map<string, CachedSecret>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export async function getSecretValue(secretId: string, ttlMs = DEFAULT_TTL_MS) {
  const result = await getSecretValueWithMetadata(secretId, ttlMs);
  return result.value;
}

export async function getSecretValueWithMetadata(
  secretId: string,
  ttlMs = DEFAULT_TTL_MS
): Promise<SecretValueResult> {
  const now = Date.now();
  const cached = cache.get(secretId);

  if (cached && cached.expiresAt > now) {
    return {
      cacheHit: true,
      value: cached.value
    };
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

  return {
    cacheHit: false,
    value
  };
}
