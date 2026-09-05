import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { AppError } from "../src/lib/errors";

const queueTemplateMock = vi.fn();
const getStatusMock = vi.fn();
const getCommandStatusMock = vi.fn();
const updatePhoneMock = vi.fn();

vi.mock("../src/domain/whatsapp-rsvp-service", () => ({
  WhatsappRsvpService: class {
    getStatus = getStatusMock;
    getCommandStatus = getCommandStatusMock;
    updatePhone = updatePhoneMock;
  }
}));
vi.mock("../src/services/whatsapp/rsvp-send-service", () => ({
  WhatsappRsvpSendService: class {
    queueTemplate = queueTemplateMock;
  }
}));
vi.mock("../src/services/dynamodb/repositories/wedding-repository", () => ({ WeddingRepository: class {} }));
vi.mock("../src/services/whatsapp/template-repository", () => ({ WhatsappTemplateRepository: class {} }));
vi.mock("../src/services/sqs/whatsapp-rsvp-publisher", () => ({ enqueueWhatsappRsvp: vi.fn() }));
vi.mock("../src/domain/whatsapp-template-variables", () => ({ validateWhatsappTemplateVariables: vi.fn() }));

const context = {} as Context;

function event(overrides: Partial<APIGatewayProxyEventV2> = {}) {
  return {
    headers: {},
    requestContext: { requestId: "req-1" },
    ...overrides
  } as APIGatewayProxyEventV2;
}

function body(response: { body?: string }) {
  return JSON.parse(response.body ?? "{}");
}

describe("WhatsApp RSVP operator handlers", () => {
  beforeEach(() => {
    queueTemplateMock.mockReset();
    getStatusMock.mockReset();
    getCommandStatusMock.mockReset();
    updatePhoneMock.mockReset();
  });

  it("rejects malformed send JSON and invalid idempotency keys with the shared error shape", async () => {
    const { handler } = await import("../src/functions/whatsapp-rsvp-send/handler");
    const malformed = await handler(event({ body: "{" }), context);
    expect(malformed.statusCode).toBe(400);
    expect(body(malformed)).toMatchObject({ code: "VALIDATION_ERROR" });

    const invalidHeader = await handler(event({
      body: JSON.stringify({ invitationCode: "SW2748", templateId: "wedding_rsvp_pending_reminder_group" }),
      headers: { "Idempotency-Key": "short" }
    }), context);
    expect(invalidHeader.statusCode).toBe(400);
    expect(body(invalidHeader)).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(queueTemplateMock).not.toHaveBeenCalled();
  }, 15000);

  it("uses a case-insensitive idempotency header and returns 202", async () => {
    queueTemplateMock.mockResolvedValue({
      commandId: "cmd-1", invitationCode: "SW2748", templateId: "wedding_rsvp_pending_reminder_group",
      templateVersion: 1, status: "queued", replayed: false
    });
    const { handler } = await import("../src/functions/whatsapp-rsvp-send/handler");
    const response = await handler(event({
      body: JSON.stringify({ invitationCode: "SW2748", templateId: "wedding_rsvp_pending_reminder_group" }),
      headers: { "IDEMPOTENCY-KEY": "valid-key-1" }
    }), context);
    expect(response.statusCode).toBe(202);
    expect(queueTemplateMock).toHaveBeenCalledWith("SW2748", "wedding_rsvp_pending_reminder_group", "valid-key-1", { requestId: "req-1" });
  });

  it("maps queue failures to 503", async () => {
    queueTemplateMock.mockRejectedValueOnce(new AppError("Queue unavailable.", 503, "QUEUE_UNAVAILABLE"));
    const { handler } = await import("../src/functions/whatsapp-rsvp-send/handler");
    const response = await handler(event({
      body: JSON.stringify({ invitationCode: "SW2748", templateId: "wedding_rsvp_pending_reminder_group" })
    }), context);
    expect(response.statusCode).toBe(503);
    expect(body(response)).toMatchObject({ code: "QUEUE_UNAVAILABLE" });
  });

  it("validates the status path before reading DynamoDB and returns safe paginated history", async () => {
    const { handler } = await import("../src/functions/whatsapp-rsvp-status/handler");
    const invalid = await handler(event({ pathParameters: { invitationCode: "" } }), context);
    expect(invalid.statusCode).toBe(400);
    expect(getStatusMock).not.toHaveBeenCalled();

    getStatusMock.mockResolvedValue({
      invitationCode: "SW2748", status: "message_sent", phoneNumber: "5511963656517",
      sendAvailability: { firstAllowed: false, resendAllowed: false },
      freeTextWindow: { open: false },
      history: [{ kind: "message", id: "wamid.1", direction: "outbound", status: "sent", createdAt: "2026-08-17T12:00:00.000Z" }],
      nextCursor: "cursor-1"
    });
    const response = await handler(event({
      pathParameters: { invitationCode: "SW2748" },
      queryStringParameters: { limit: "10", cursor: "cursor-0", order: "desc" }
    }), context);
    expect(response.statusCode).toBe(200);
    expect(getStatusMock).toHaveBeenCalledWith("SW2748", { limit: 10, cursor: "cursor-0", order: "desc" });
    expect(body(response).nextCursor).toBe("cursor-1");
  });

  it("defaults status history to ascending order for existing callers", async () => {
    getStatusMock.mockResolvedValue({ invitationCode: "SW2748", status: "idle", history: [] });
    const { handler } = await import("../src/functions/whatsapp-rsvp-status/handler");

    await handler(event({ pathParameters: { invitationCode: "SW2748" } }), context);

    expect(getStatusMock).toHaveBeenCalledWith("SW2748", { limit: 50, order: "asc" });
  });

  it("maps unknown invitations and infrastructure failures consistently", async () => {
    const { handler: statusHandler } = await import("../src/functions/whatsapp-rsvp-status/handler");
    getStatusMock.mockRejectedValueOnce(new AppError("Invitation not found.", 404, "INVITATION_NOT_FOUND"));
    const missing = await statusHandler(event({ pathParameters: { invitationCode: "SW2748" } }), context);
    expect(missing.statusCode).toBe(404);
    expect(body(missing)).toMatchObject({ code: "INVITATION_NOT_FOUND" });

    const { handler: phoneHandler } = await import("../src/functions/whatsapp-rsvp-phone/handler");
    updatePhoneMock.mockRejectedValueOnce(new Error("Dynamo unavailable"));
    const failed = await phoneHandler(event({
      pathParameters: { invitationCode: "SW2748" },
      body: JSON.stringify({ phoneNumber: "+55 (11) 96365-6517" })
    }), context);
    expect(failed.statusCode).toBe(500);
    expect(body(failed)).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("returns command status and maps an unknown command to 404", async () => {
    const { handler } = await import("../src/functions/whatsapp-rsvp-command-status/handler");
    getCommandStatusMock.mockResolvedValue({
      commandId: "cmd-1", invitationCode: "SW2748", templateId: "wedding_rsvp_pending_reminder_group",
      templateVersion: 1, status: "sent", retryCount: 1, reconciliationStatus: "none",
      providerMessageId: "wamid.1", createdAt: "2026-08-17T12:00:00.000Z"
    });
    const response = await handler(event({ pathParameters: { commandId: "cmd-1" } }), context);
    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({ commandId: "cmd-1", status: "sent" });

    getCommandStatusMock.mockRejectedValueOnce(new AppError("WhatsApp command not found.", 404, "COMMAND_NOT_FOUND"));
    const missing = await handler(event({ pathParameters: { commandId: "cmd-1" } }), context);
    expect(missing.statusCode).toBe(404);
    expect(body(missing)).toMatchObject({ code: "COMMAND_NOT_FOUND" });
  });
});
