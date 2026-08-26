import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { AppError } from "../src/lib/errors";

const queueAutoTemplateMock = vi.fn();

vi.mock("../src/services/dynamodb/repositories/wedding-repository", () => ({
  WeddingRepository: class {}
}));
vi.mock("../src/services/whatsapp/rsvp-send-service", () => ({
  WhatsappRsvpSendService: class {
    queueAutoTemplate = queueAutoTemplateMock;
  }
}));
vi.mock("../src/services/whatsapp/template-repository", () => ({ WhatsappTemplateRepository: class {} }));
vi.mock("../src/services/sqs/whatsapp-rsvp-publisher", () => ({ enqueueWhatsappRsvp: vi.fn() }));
vi.mock("../src/domain/whatsapp-template-variables", () => ({ validateWhatsappTemplateVariables: vi.fn() }));

const context = {} as Context;

function event(overrides: Partial<APIGatewayProxyEventV2> = {}) {
  return {
    headers: {},
    requestContext: { requestId: "req-auto-1" },
    pathParameters: { invitationCode: "SW2748" },
    ...overrides
  } as APIGatewayProxyEventV2;
}

function body(response: { body?: string }) {
  return JSON.parse(response.body ?? "{}");
}

describe("WhatsApp RSVP auto-send handler", () => {
  beforeEach(() => {
    queueAutoTemplateMock.mockReset();
  });

  it("defaults an absent body to a first send", async () => {
    queueAutoTemplateMock.mockResolvedValue({
      commandId: "cmd-1", invitationCode: "SW2748", templateId: "wedding_rsvp_reconfirmation_single",
      templateVersion: 1, status: "queued", replayed: false
    });

    const { handler } = await import("../src/functions/whatsapp-rsvp-auto-send/handler");
    const response = await handler(event({ headers: { "Idempotency-Key": "auto-key-1" } }), context);

    expect(response.statusCode).toBe(202);
    expect(body(response)).toMatchObject({ templateId: "wedding_rsvp_reconfirmation_single" });
    expect(queueAutoTemplateMock).toHaveBeenCalledWith(
      "SW2748", "first", "auto-key-1", { requestId: "req-auto-1" }
    );
  });

  it("parses and forwards resend mode", async () => {
    queueAutoTemplateMock.mockResolvedValue({
      commandId: "cmd-2", invitationCode: "SW2748", templateId: "wedding_rsvp_pending_reminder_single",
      templateVersion: 1, status: "queued", replayed: false
    });

    const { handler } = await import("../src/functions/whatsapp-rsvp-auto-send/handler");
    const response = await handler(event({ body: JSON.stringify({ mode: "resend" }) }), context);

    expect(response.statusCode).toBe(202);
    expect(body(response).templateId).toBe("wedding_rsvp_pending_reminder_single");
    expect(queueAutoTemplateMock).toHaveBeenCalledWith(
      "SW2748", "resend", undefined, { requestId: "req-auto-1" }
    );
  });

  it("rejects invalid modes before calling the service", async () => {
    const { handler } = await import("../src/functions/whatsapp-rsvp-auto-send/handler");
    const response = await handler(event({ body: JSON.stringify({ mode: "later" }) }), context);
    expect(response.statusCode).toBe(400);
    expect(queueAutoTemplateMock).not.toHaveBeenCalled();
  });

  it("validates the path and maps missing invitations and queue failures", async () => {
    const { handler } = await import("../src/functions/whatsapp-rsvp-auto-send/handler");
    const invalid = await handler(event({ pathParameters: { invitationCode: "" } }), context);
    expect(invalid.statusCode).toBe(400);
    expect(queueAutoTemplateMock).not.toHaveBeenCalled();

    const invalidHeader = await handler(event({ headers: { "Idempotency-Key": "short" } }), context);
    expect(invalidHeader.statusCode).toBe(400);
    expect(queueAutoTemplateMock).not.toHaveBeenCalled();

    queueAutoTemplateMock.mockRejectedValueOnce(new AppError("Invitation not found.", 404, "INVITATION_NOT_FOUND"));
    const missing = await handler(event(), context);
    expect(missing.statusCode).toBe(404);
    expect(body(missing)).toMatchObject({ code: "INVITATION_NOT_FOUND" });

    queueAutoTemplateMock.mockRejectedValueOnce(new AppError("Queue unavailable.", 503, "QUEUE_UNAVAILABLE"));
    const failed = await handler(event(), context);
    expect(failed.statusCode).toBe(503);
    expect(body(failed)).toMatchObject({ code: "QUEUE_UNAVAILABLE" });
  });
});
