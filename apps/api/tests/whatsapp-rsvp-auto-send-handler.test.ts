import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { AppError } from "../src/lib/errors";

const getInvitationMock = vi.fn();
const queueTemplateMock = vi.fn();

vi.mock("../src/services/dynamodb/repositories/wedding-repository", () => ({
  WeddingRepository: class {
    getInvitationByCode = getInvitationMock;
  }
}));
vi.mock("../src/services/whatsapp/rsvp-send-service", () => ({
  WhatsappRsvpSendService: class {
    queueTemplate = queueTemplateMock;
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
    getInvitationMock.mockReset();
    queueTemplateMock.mockReset();
  });

  it("selects reconfirmation for an invitation with an attending guest", async () => {
    getInvitationMock.mockResolvedValue({
      invitationCode: "SW2748",
      guests: [{ guestId: "g1", guestName: "Ana", allowedPlusOnes: 0, rsvpStatus: "attending" }]
    });
    queueTemplateMock.mockResolvedValue({
      commandId: "cmd-1", invitationCode: "SW2748", templateId: "wedding_rsvp_reconfirmation_single",
      templateVersion: 1, status: "queued", replayed: false
    });

    const { handler } = await import("../src/functions/whatsapp-rsvp-auto-send/handler");
    const response = await handler(event({ headers: { "Idempotency-Key": "auto-key-1" } }), context);

    expect(response.statusCode).toBe(202);
    expect(body(response)).toMatchObject({ templateId: "wedding_rsvp_reconfirmation_single" });
    expect(queueTemplateMock).toHaveBeenCalledWith(
      "SW2748", "wedding_rsvp_reconfirmation_single", "auto-key-1", { requestId: "req-auto-1" }
    );
  });

  it("selects the single pending reminder when no guest is attending", async () => {
    getInvitationMock.mockResolvedValue({
      invitationCode: "SW2748",
      guests: [{ guestId: "g1", guestName: "Ana", allowedPlusOnes: 0, rsvpStatus: "pending" }]
    });
    queueTemplateMock.mockResolvedValue({
      commandId: "cmd-2", invitationCode: "SW2748", templateId: "wedding_rsvp_pending_reminder_single",
      templateVersion: 1, status: "queued", replayed: false
    });

    const { handler } = await import("../src/functions/whatsapp-rsvp-auto-send/handler");
    const response = await handler(event(), context);

    expect(response.statusCode).toBe(202);
    expect(body(response).templateId).toBe("wedding_rsvp_pending_reminder_single");
    expect(queueTemplateMock).toHaveBeenCalledWith(
      "SW2748", "wedding_rsvp_pending_reminder_single", undefined, { requestId: "req-auto-1" }
    );
  });

  it("keeps group routing for a multi-guest invitation with one attendee", async () => {
    getInvitationMock.mockResolvedValue({
      invitationCode: "SW2748",
      guests: [
        { guestId: "g1", guestName: "Ana", allowedPlusOnes: 0, rsvpStatus: "attending" },
        { guestId: "g2", guestName: "Bruno", allowedPlusOnes: 0, rsvpStatus: "pending" }
      ]
    });
    queueTemplateMock.mockResolvedValue({
      commandId: "cmd-3", invitationCode: "SW2748", templateId: "wedding_rsvp_reconfirmation",
      templateVersion: 1, status: "queued", replayed: false
    });

    const { handler } = await import("../src/functions/whatsapp-rsvp-auto-send/handler");
    await handler(event(), context);

    expect(queueTemplateMock).toHaveBeenCalledWith(
      "SW2748", "wedding_rsvp_reconfirmation", undefined, { requestId: "req-auto-1" }
    );
  });

  it("validates the path and maps missing invitations and queue failures", async () => {
    const { handler } = await import("../src/functions/whatsapp-rsvp-auto-send/handler");
    const invalid = await handler(event({ pathParameters: { invitationCode: "" } }), context);
    expect(invalid.statusCode).toBe(400);
    expect(getInvitationMock).not.toHaveBeenCalled();

    const invalidHeader = await handler(event({ headers: { "Idempotency-Key": "short" } }), context);
    expect(invalidHeader.statusCode).toBe(400);
    expect(getInvitationMock).not.toHaveBeenCalled();

    getInvitationMock.mockResolvedValueOnce(null);
    const missing = await handler(event(), context);
    expect(missing.statusCode).toBe(404);
    expect(body(missing)).toMatchObject({ code: "INVITATION_NOT_FOUND" });

    getInvitationMock.mockResolvedValueOnce({
      invitationCode: "SW2748",
      guests: [{ guestId: "g1", guestName: "Ana", allowedPlusOnes: 0, rsvpStatus: "declined" }]
    });
    queueTemplateMock.mockRejectedValueOnce(new AppError("Queue unavailable.", 503, "QUEUE_UNAVAILABLE"));
    const failed = await handler(event(), context);
    expect(failed.statusCode).toBe(503);
    expect(body(failed)).toMatchObject({ code: "QUEUE_UNAVAILABLE" });
  });
});
