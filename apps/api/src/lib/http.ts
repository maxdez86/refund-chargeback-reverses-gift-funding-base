type HeaderValue = string | number | boolean;

function toHeaderRecord(headers: Record<string, HeaderValue>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

export function jsonResponse(statusCode: number, body: unknown, headers: Record<string, HeaderValue> = {}) {
  return {
    statusCode,
    headers: toHeaderRecord({
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "content-type,idempotency-key,x-admin-token,asaas-access-token",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      ...headers
    }),
    body: JSON.stringify(body)
  };
}

export function noContentResponse(headers: Record<string, HeaderValue> = {}) {
  return {
    statusCode: 204,
    headers: toHeaderRecord({
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "content-type,idempotency-key,x-admin-token,asaas-access-token",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      ...headers
    })
  };
}
