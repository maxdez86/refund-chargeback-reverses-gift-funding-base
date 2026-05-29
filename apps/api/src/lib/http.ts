type HeaderValue = string | number | boolean;

const ALLOWED_ORIGINS = new Set([
  "https://brimax.life",
  "https://www.brimax.life"
]);

function toHeaderRecord(headers: Record<string, HeaderValue>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

export function corsHeaders(requestOrigin: string | undefined): Record<string, string> {
  if (!requestOrigin || !ALLOWED_ORIGINS.has(requestOrigin)) {
    return { vary: "Origin" };
  }

  return {
    "access-control-allow-origin": requestOrigin,
    "access-control-allow-headers":
      "content-type,idempotency-key,x-turnstile-token,x-rsvp-lookup-proof",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
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

export function noContentResponse(headers: Record<string, HeaderValue> = {}) {
  return {
    statusCode: 204,
    headers: toHeaderRecord(headers)
  };
}
