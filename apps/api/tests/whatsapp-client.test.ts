import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WHATSAPP_DEFAULT_TIMEOUT_MS,
  WhatsappApiError,
  WhatsappCloudApiClient,
  WhatsappConfigurationError
} from "../src/services/whatsapp/client";

const baseInput = {
  to: "5511999999999",
  template: { name: "wedding", language: "en" }
};

function client(fetchImpl: typeof fetch, overrides: { token?: string; phoneId?: string; timeoutMs?: number } = {}) {
  return new WhatsappCloudApiClient({
    fetch: fetchImpl,
    getAccessToken: async () => overrides.token ?? "test-access-token",
    getPhoneNumberId: () => overrides.phoneId ?? "123456789",
    timeoutMs: overrides.timeoutMs
  });
}

function responseWithBodyThatAborts(init: RequestInit | undefined, status: number) {
  const body = new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener("abort", () => {
        controller.error(new DOMException("raw body abort detail", "AbortError"));
      });
    }
  });

  return new Response(body, {
    status,
    headers: {
      "x-fb-trace-id": "trace-body-timeout",
      ...(status === 429 ? { "retry-after": "12" } : {})
    }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WhatsappCloudApiClient", () => {
  it("constructs the initial no-variable template request and extracts the message id", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          messaging_product: "whatsapp",
          contacts: [{ input: baseInput.to, wa_id: baseInput.to }],
          messages: [{ id: "wamid.outbound-1" }]
        }),
        { status: 200, headers: { "x-fb-trace-id": "trace-1" } }
      )
    );
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(client(fetchMock).sendTemplate(baseInput, { requestId: "request-1" })).resolves.toEqual({
      messageId: "wamid.outbound-1",
      recipientWaId: baseInput.to,
      providerTraceId: "trace-1"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v25.0/123456789/messages");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: "Bearer test-access-token",
        "content-type": "application/json"
      }
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: "whatsapp",
      to: baseInput.to,
      type: "template",
      template: { name: "wedding", language: { code: "en" } }
    });
  });

  it("serializes supported header, body, and button parameters", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.2" }] }))
    );
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const components = [
      {
        type: "header" as const,
        parameters: [{ type: "image" as const, image: { link: "https://example.com/image.jpg" } }]
      },
      {
        type: "body" as const,
        parameters: [
          { type: "text" as const, text: "Amanda" },
          {
            type: "currency" as const,
            currency: { fallback_value: "R$ 10,00", code: "BRL", amount_1000: 10_000 }
          },
          { type: "date_time" as const, date_time: { fallback_value: "6 Dec 2026" } },
          { type: "document" as const, document: { id: "doc-1", filename: "invite.pdf" } },
          { type: "video" as const, video: { id: "video-1" } }
        ]
      },
      {
        type: "button" as const,
        sub_type: "quick_reply" as const,
        index: "0",
        parameters: [{ type: "payload" as const, payload: "attending" }]
      }
    ];

    await client(fetchMock).sendTemplate(
      { ...baseInput, template: { ...baseInput.template, components } },
      { requestId: "request-components" }
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.template.components).toEqual(components);
  });

  it.each([
    ["", "123", "access token"],
    ["token", "", "phone-number ID"]
  ])("fails safely before fetch when configuration is missing", async (token, phoneId, message) => {
    const fetchMock = vi.fn<typeof fetch>();
    const failure = client(fetchMock, { token, phoneId }).sendTemplate(baseInput, { requestId: "config" });
    await expect(failure).rejects.toBeInstanceOf(WhatsappConfigurationError);
    await expect(failure).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, "invalid_request", false],
    [401, "unauthorized", false],
    [403, "unauthorized", false],
    [429, "rate_limited", true],
    [503, "transient", true]
  ] as const)("classifies Meta HTTP %i without retrying", async (status, category, retryable) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "private upstream detail", type: "OAuthException", code: 190, fbtrace_id: "trace-error" } }),
        { status, headers: status === 429 ? { "retry-after": "12" } : undefined }
      )
    );
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const error = await client(fetchMock).sendTemplate(baseInput, { requestId: "error" }).catch((value) => value);
    expect(error).toBeInstanceOf(WhatsappApiError);
    expect(error).toMatchObject({ category, retryable, upstreamStatus: status, providerCode: 190 });
    if (status === 429) expect(error.retryAfterSeconds).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid Meta success response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ messages: [] })));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(client(fetchMock).sendTemplate(baseInput, { requestId: "invalid" })).rejects.toMatchObject({
      category: "invalid_response"
    });
  });

  it("classifies network failures and performs no retry", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("socket included private data"));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(client(fetchMock).sendTemplate(baseInput, { requestId: "network" })).rejects.toMatchObject({
      category: "network",
      retryable: false
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(info.mock.calls.flat().join(" ")).toContain('"errorCategory":"network"');
    expect(info.mock.calls.flat().join(" ")).toContain('"retryable":false');
    expect(info.mock.calls.flat().join(" ")).not.toContain("private data");
  });

  it("aborts a timed-out request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(
      client(fetchMock, { timeoutMs: 5 }).sendTemplate(baseInput, { requestId: "timeout" })
    ).rejects.toMatchObject({ category: "timeout", retryable: false, upstreamStatus: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(info.mock.calls.flat().join(" ")).toContain('"errorCategory":"timeout"');
    expect(info.mock.calls.flat().join(" ")).toContain('"retryable":false');
  });

  it("uses a fifteen-second default timeout budget", () => {
    expect(WHATSAPP_DEFAULT_TIMEOUT_MS).toBe(15_000);
  });

  it("classifies a successful response body timeout as ambiguous delivery", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => responseWithBodyThatAborts(init, 200));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const error = await client(fetchMock, { token: "secret-body-token", timeoutMs: 5 })
      .sendTemplate(baseInput, { requestId: "body-timeout" })
      .catch((value) => value);

    expect(error).toBeInstanceOf(WhatsappApiError);
    expect(error).not.toBeInstanceOf(DOMException);
    expect(error).toMatchObject({
      category: "ambiguous_delivery",
      retryable: false,
      upstreamStatus: 200,
      providerTraceId: "trace-body-timeout"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const output = info.mock.calls.flat().join(" ");
    expect(output).toContain('"httpStatus":200');
    expect(output).toContain('"providerTraceId":"trace-body-timeout"');
    expect(output).toContain('"errorCategory":"ambiguous_delivery"');
    expect(output).toContain('"retryable":false');
    expect(output).not.toContain("secret-body-token");
    expect(output).not.toContain(baseInput.to);
    expect(output).not.toContain("raw body abort detail");
  });

  it("retains status classification when an error response body cannot be read", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => responseWithBodyThatAborts(init, 503));
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const error = await client(fetchMock, { timeoutMs: 5 })
      .sendTemplate(baseInput, { requestId: "error-body-timeout" })
      .catch((value) => value);

    expect(error).toBeInstanceOf(WhatsappApiError);
    expect(error).toMatchObject({
      category: "transient",
      retryable: true,
      upstreamStatus: 503,
      providerTraceId: "trace-body-timeout"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never persists token, recipient, parameters, or raw errors in logs", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "recipient 5511999999999 secret-value", code: 131000 } }), {
        status: 400
      })
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = await client(fetchMock, { token: "secret-value" })
      .sendTemplate(baseInput, { requestId: "safe-request", templatePurpose: "wedding_invitation", templateVersion: 1 })
      .catch((value) => value);
    const output = `${info.mock.calls.flat().join(" ")} ${JSON.stringify(error)}`;
    expect(output).toContain("safe-request");
    expect(output).not.toContain("secret-value");
    expect(output).not.toContain(baseInput.to);
  });
});
