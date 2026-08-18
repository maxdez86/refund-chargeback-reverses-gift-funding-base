import { resolveStage, stageAllowedOrigins } from "@brimax/config";

type HeaderValue = string | number | boolean;

function allowedOrigins() {
  const configured = process.env.ALLOWED_ORIGINS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  return stageAllowedOrigins(resolveStage(process.env.STAGE));
}

function toHeaderRecord(headers: Record<string, HeaderValue>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

export function corsHeaders(requestOrigin: string | undefined): Record<string, string> {
  const allowed = new Set(allowedOrigins());

  if (!requestOrigin || !allowed.has(requestOrigin)) {
    return { vary: "Origin" };
  }

  return {
    "access-control-allow-origin": requestOrigin,
    "access-control-allow-headers":
      "authorization,content-type,idempotency-key,x-turnstile-token,x-rsvp-lookup-proof",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    vary: "Origin"
  };
}

export function jsonResponse(statusCode: number, body: unknown, headers: Record<string, HeaderValue> = {}) {
  return {
    statusCode,
    headers: toHeaderRecord({
      "content-type": "application/json; charset=utf-8",
      ...headers
    }),
    body: JSON.stringify(body)
  };
}

export function headerValue(headers: Record<string, string | undefined>, name: string) {
  const expected = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === expected)?.[1];
}

export function noContentResponse(headers: Record<string, HeaderValue> = {}) {
  return {
    statusCode: 204,
    headers: toHeaderRecord(headers)
  };
}
