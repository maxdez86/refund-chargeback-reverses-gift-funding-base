import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { AppError } from "../src/lib/errors";

const queueTextMock = vi.fn();

vi.mock("../src/services/dynamodb/repositories/wedding-repository", () => ({
  WeddingRepository: class {}
}));
vi.mock("../src/services/whatsapp/operator-text-service", () => ({
  WhatsappOperatorTextService: class {
    queueText = queueTextMock;
  }
}));
vi.mock("../src/services/sqs/whatsapp-rsvp-publisher", () => ({ enqueueWhatsappRsvp: vi.fn() }));

const context = {} as Context;

function event(overrides: Partial<APIGatewayProxyEventV2> = {}) {
  return {
    headers: {},
    requestContext: { requestId: "req-text-1" },
    pathParameters: { invitationCode: "SW2748" },
    body: JSON.stringify({ body: "Oi! Podemos ajudar?" }),
    ...overrides
  } as APIGatewayProxyEventV2;
}

function body(response: { body?: string }) {
  return JSON.parse(response.body ?? "{}");
}

const accepted = {
  commandId: "idempotency-text-key-1",
  invitationCode: "SW2748",
  status: "queued" as const,
  replayed: false
};

describe("WhatsApp operator free-text handler", () => {
  beforeEach(() => {
    queueTextMock.mockReset();
  });

  it("accepts a composed message and returns 202 with the command", async () => {
    queueTextMock.mockResolvedValue(accepted);
    const { handler } = await import("../src/functions/whatsapp-operator-text/handler");
    const response = await handler(event({
      headers: { "Idempotency-Key": "text-key-1" },
      body: JSON.stringify({ body: "Oi! Podemos ajudar?" })
    }), context);

    expect(response.statusCode).toBe(202);
    expect(body(response)).toEqual(accepted);
    expect(queueTextMock).toHaveBeenCalledWith(
      "SW2748", "Oi! Podemos ajudar?", "text-key-1", { requestId: "req-text-1" }
    );
  });

  it("reads the idempotency header case-insensitively and tolerates its absence", async () => {
    queueTextMock.mockResolvedValue(accepted);
    const { handler } = await import("../src/functions/whatsapp-operator-text/handler");

    await handler(event({ headers: { "IDEMPOTENCY-KEY": "text-key-1" } }), context);
    expect(queueTextMock).toHaveBeenCalledWith("SW2748", expect.any(String), "text-key-1", expect.anything());

    await handler(event(), context);
    expect(queueTextMock).toHaveBeenLastCalledWith("SW2748", expect.any(String), undefined, expect.anything());
  });

  it("rejects an invalid path, header, or body before reaching the service", async () => {
    const { handler } = await import("../src/functions/whatsapp-operator-text/handler");

    const badPath = await handler(event({ pathParameters: { invitationCode: "" } }), context);
    expect(badPath.statusCode).toBe(400);

    const badHeader = await handler(event({ headers: { "Idempotency-Key": "short" } }), context);
    expect(badHeader.statusCode).toBe(400);

    const emptyBody = await handler(event({ body: JSON.stringify({ body: "" }) }), context);
    expect(emptyBody.statusCode).toBe(400);

    const oversized = await handler(event({ body: JSON.stringify({ body: "a".repeat(4097) }) }), context);
    expect(oversized.statusCode).toBe(400);

    const unknownField = await handler(event({ body: JSON.stringify({ body: "Oi!", to: "x" }) }), context);
    expect(unknownField.statusCode).toBe(400);

    const malformed = await handler(event({ body: "{" }), context);
    expect(malformed.statusCode).toBe(400);

    expect(queueTextMock).not.toHaveBeenCalled();
  });

  it("maps service failures onto their WhatsApp RSVP error codes", async () => {
    const { handler } = await import("../src/functions/whatsapp-operator-text/handler");

    queueTextMock.mockRejectedValueOnce(new AppError("Window closed.", 409, "FREE_TEXT_WINDOW_CLOSED"));
    const closed = await handler(event(), context);
    expect(closed.statusCode).toBe(409);
    expect(body(closed)).toMatchObject({ code: "FREE_TEXT_WINDOW_CLOSED" });

    queueTextMock.mockRejectedValueOnce(new AppError("Invitation not found.", 404, "INVITATION_NOT_FOUND"));
    const missing = await handler(event(), context);
    expect(missing.statusCode).toBe(404);
    expect(body(missing)).toMatchObject({ code: "INVITATION_NOT_FOUND" });

    queueTextMock.mockRejectedValueOnce(new AppError("No phone.", 422, "INVALID_INVITATION_STATE"));
    const invalid = await handler(event(), context);
    expect(invalid.statusCode).toBe(422);

    queueTextMock.mockRejectedValueOnce(new AppError("Queue unavailable.", 503, "QUEUE_UNAVAILABLE"));
    const queueFailure = await handler(event(), context);
    expect(queueFailure.statusCode).toBe(503);
    expect(body(queueFailure)).toMatchObject({ code: "QUEUE_UNAVAILABLE" });
  });
});
