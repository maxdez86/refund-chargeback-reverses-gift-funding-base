import { createHash, timingSafeEqual } from "node:crypto";

export function normalizeCpf(value: string) {
  return value.replace(/\D/g, "");
}

export function maskCpf(value: string) {
  const normalized = normalizeCpf(value);

  if (normalized.length < 4) {
    return normalized;
  }

  return `***.***.***-${normalized.slice(-2)}`;
}

export function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJsonHash(value: unknown) {
  return hashValue(JSON.stringify(value));
}

export function rawBodyHash(value: string) {
  return hashValue(value);
}

export function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
