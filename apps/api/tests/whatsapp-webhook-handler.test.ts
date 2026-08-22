import { createHmac } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getAppSecretMock = vi.fn();
let handler: typeof import("../src/functions/whatsapp-webhook/handler").handler;
let createWhatsappWebhookHandler: typeof import("../src/functions/whatsapp-webhook/handler").createWhatsappWebhookHandler;

vi.mock("../src/services/secrets-manager/app-secrets", () => ({
  getAppSecret: (...args: unknown[]) => getAppSecretMock(...args)
}));

const context = {} as never;
const appSecret = "meta-app-secret";
const verifyToken = "stage-verify-token";

function signature(body: string) {
  return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}

function buildEvent(
  method: "GET" | "POST",
  options: Partial<APIGatewayProxyEventV2> = {}
) {
  return {
    headers: {},
    isBase64Encoded: false,
    requestContext: {
      http: { method },
      requestId: "request-1"
    },
    queryStringParameters: {},
    ...options
  } as APIGatewayProxyEventV2;
}

function payload(value: Record<string, unknown> = { messages: [] }) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value }] }]
  });
}

describe("WhatsApp webhook handler", () => {
  beforeAll(async () => {
    ({ handler, createWhatsappWebhookHandler } = await import("../src/functions/whatsapp-webhook/handler"));
  });

  beforeEach(() => {
    getAppSecretMock.mockReset().mockImplementation(async (key: string) =>
      key === "whatsappVerifyToken" ? verifyToken : appSecret
    );
  });

  it("returns the exact challenge for valid Meta verification", async () => {
    const response = await handler(
      buildEvent("GET", {
        queryStringParameters: {
          "hub.mode": "subscribe",
          "hub.verify_token": verifyToken,
          "hub.challenge": "challenge-123"
        }
      }),
      context
    );

    expect(response).toMatchObject({ statusCode: 200, body: "challenge-123" });
    expect(getAppSecretMock).toHaveBeenCalledWith("whatsappVerifyToken");
  });

  it.each([
    ["invalid token", { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "c" }],
    ["invalid mode", { "hub.mode": "not-subscribe", "hub.verify_token": verifyToken, "hub.challenge": "c" }],
    ["missing challenge", { "hub.mode": "subscribe", "hub.verify_token": verifyToken }]
  ])("returns 403 for %s", async (_name, queryStringParameters) => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await handler(buildEvent("GET", { queryStringParameters }), context);

      expect(response.statusCode).toBe(403);
      const logged = errorLog.mock.calls.flat().join(" ");
      expect(logged).toContain('"metric":"WHATSAPP_WEBHOOK_VERIFY_FAILED"');
      expect(logged).toContain('"requestId":"request-1"');
      expect(logged).not.toContain(verifyToken);
      expect(logged).not.toContain("wrong");
    } finally {
      errorLog.mockRestore();
    }
  });

  it("accepts a signed text message, including a base64 body and mixed-case header, without logging private content", async () => {
    const body = payload({
      messages: [{ id: "wamid.message-1", type: "text", text: { body: "Olá, Brimax!" } }],
      contacts: [{ wa_id: "5511999999999", profile: { name: "Private Name" } }]
    });
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      const response = await handler(
        buildEvent("POST", {
          body: Buffer.from(body).toString("base64"),
          isBase64Encoded: true,
          headers: { "X-Hub-Signature-256": signature(body) }
        }),
        context
      );

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(JSON.stringify({ ok: true, received: true }));
      const logged = infoLog.mock.calls.flat().join(" ");
      expect(logged).toContain('"metric":"WHATSAPP_WEBHOOK_PARSED"');
      expect(logged).toContain('"eventType":"text"');
      expect(logged).toContain('"messageId":"wamid.message-1"');
      expect(logged).not.toContain("Olá, Brimax!");
      expect(logged).not.toContain("5511999999999");
      expect(logged).not.toContain("Private Name");
      expect(logged).not.toContain(appSecret);
    } finally {
      infoLog.mockRestore();
    }
  });

  it("accepts a signed status update", async () => {
    const body = payload({ statuses: [{ id: "wamid.message-1", status: "delivered" }] });

    const response = await handler(
      buildEvent("POST", {
        body,
        headers: { "x-hub-signature-256": signature(body) }
      }),
      context
    );

    expect(response.statusCode).toBe(200);
  });

  it("logs only allowlisted identifiers for replies, media, status errors, and duplicates", async () => {
    const body = payload({
      metadata: {
        display_phone_number: "private-display-number",
        phone_number_id: "private-phone-number-id"
      },
      contacts: [{ wa_id: "private-sender", profile: { name: "Private Profile" } }],
      messages: [
        {
          id: "wamid.button",
          from: "private-sender",
          type: "interactive",
          interactive: {
            type: "button_reply",
            button_reply: { id: "safe-button-id", title: "Private Button Label" }
          }
        },
        {
          id: "wamid.media",
          from: "private-sender",
          type: "image",
          image: { id: "private-media-id", caption: "Private Caption", url: "https://private.invalid" }
        }
      ],
      statuses: [
        {
          id: "wamid.status",
          status: "failed",
          recipient_id: "private-recipient",
          errors: [{ code: 131000, title: "Private Error Title", message: "Private Error Message" }]
        },
        {
          id: "wamid.status",
          status: "failed",
          recipient_id: "private-recipient",
          errors: [{ code: 131000, title: "Private Error Title", message: "Private Error Message" }]
        }
      ]
    });
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      const response = await handler(
        buildEvent("POST", { body, headers: { "x-hub-signature-256": signature(body) } }),
        context
      );
      const logged = infoLog.mock.calls.flat().join(" ");

      expect(response.statusCode).toBe(200);
      expect(logged).toContain('"buttonId":"safe-button-id"');
      expect(logged).toContain('"errorCodes":[131000]');
      expect(logged).toContain('"duplicateWithinPayload":true');
      for (const privateValue of [
        "private-display-number",
        "private-phone-number-id",
        "private-sender",
        "Private Profile",
        "Private Button Label",
        "private-media-id",
        "Private Caption",
        "https://private.invalid",
        "private-recipient",
        "Private Error Title",
        "Private Error Message"
      ]) {
        expect(logged).not.toContain(privateValue);
      }
    } finally {
      infoLog.mockRestore();
    }
  });

  it("does not requeue a terminal failed webhook marker", async () => {
    const enqueue = vi.fn();
    const terminalHandler = createWhatsappWebhookHandler({
      repository: {
        recordWebhookEventIfNew: vi.fn().mockResolvedValue(false),
        getWebhookEvent: vi.fn().mockResolvedValue({
          processingStatus: "failed",
          retryDisposition: "terminal"
        })
      } as never,
      enqueue
    });
    const body = payload({
      messages: [{
        id: "wamid.terminal",
        from: "5511963656517",
        type: "text",
        text: { body: "private body" }
      }]
    });

    const response = await terminalHandler(buildEvent("POST", {
      body,
      headers: { "x-hub-signature-256": signature(body) }
    }));

    expect(response.statusCode).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("acknowledges malformed child items but rejects an invalid foundational envelope", async () => {
    const malformedChild = payload({ messages: [null] });
    const wrongProduct = payload({ messaging_product: "messenger", messages: [] });

    const acceptedResponse = await handler(
      buildEvent("POST", {
        body: malformedChild,
        headers: { "x-hub-signature-256": signature(malformedChild) }
      }),
      context
    );
    const rejectedResponse = await handler(
      buildEvent("POST", {
        body: wrongProduct,
        headers: { "x-hub-signature-256": signature(wrongProduct) }
      }),
      context
    );

    expect(acceptedResponse.statusCode).toBe(200);
    expect(rejectedResponse.statusCode).toBe(400);
  });

  it("rejects missing or invalid signatures", async () => {
    const body = payload();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(
        handler(buildEvent("POST", { body }), context)
      ).resolves.toMatchObject({ statusCode: 403 });
      await expect(
        handler(buildEvent("POST", { body, headers: { "x-hub-signature-256": "sha256=wrong" } }), context)
      ).resolves.toMatchObject({ statusCode: 403 });

      const logged = errorLog.mock.calls.flat().join(" ");
      expect(logged).toContain('"metric":"WHATSAPP_WEBHOOK_AUTH_FAILED"');
      expect(logged).toContain('"requestId":"request-1"');
    } finally {
      errorLog.mockRestore();
    }
  });

  it("rejects malformed JSON and invalid WABA envelopes", async () => {
    const malformed = "{";
    const invalid = JSON.stringify({ object: "not-whatsapp", entry: [] });

    for (const body of [malformed, invalid]) {
      const response = await handler(
        buildEvent("POST", { body, headers: { "x-hub-signature-256": signature(body) } }),
        context
      );
      expect(response.statusCode).toBe(400);
    }
  });
});
