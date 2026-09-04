import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { ZodError } from "zod";
import { AppError } from "../src/lib/errors";

const createInvitationMock = vi.fn();
const deleteInvitationMock = vi.fn();
const addGuestsMock = vi.fn();
const removeGuestMock = vi.fn();
const reportHandledErrorMock = vi.fn();

vi.mock("../src/domain/admin-invitation-provisioning-service", () => ({
  AdminInvitationProvisioningService: class {
    createInvitation = createInvitationMock;
    deleteInvitation = deleteInvitationMock;
    addGuests = addGuestsMock;
    removeGuest = removeGuestMock;
  }
}));
vi.mock("../src/lib/sentry", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/sentry")>("../src/lib/sentry");
  return { ...actual, reportHandledError: reportHandledErrorMock };
});

const context = {} as Context;

const rsvpWrite = {
  ok: true as const,
  invitationCode: "SW2748",
  guests: [
    {
      guestId: "SW2748--guest-01",
      guestName: "Amanda",
      allowedPlusOnes: 0,
      rsvpStatus: "pending" as const
    }
  ],
  rsvp: {
    status: "pending" as const,
    updatedAt: "2026-08-20T12:00:00.000Z",
    submittedBy: "SW2748--guest-01",
    attending: 0,
    paid: 0,
    childrenSixOrYounger: 0
  },
  updatedAt: "2026-08-20T12:00:00.000Z"
};

function event(overrides: Partial<APIGatewayProxyEventV2> = {}) {
  return {
    headers: { origin: "https://brimax.life" },
    requestContext: { requestId: "req-admin-1" },
    pathParameters: { invitationCode: "SW2748", guestId: "SW2748--guest-01" },
    body: JSON.stringify({ guests: [{ guestName: "Duda" }] }),
    ...overrides
  } as unknown as APIGatewayProxyEventV2;
}

function body(response: { body?: string }) {
  return JSON.parse(response.body ?? "{}");
}

beforeEach(() => {
  createInvitationMock.mockReset();
  deleteInvitationMock.mockReset();
  addGuestsMock.mockReset();
  removeGuestMock.mockReset();
  reportHandledErrorMock.mockReset();
  process.env.ALLOWED_ORIGINS = "https://brimax.life";
});

describe("POST /admin/invitations", () => {
  const load = () => import("../src/functions/admin-invitation-create/handler");
  const created = {
    ok: true as const,
    invitation: {
      invitationCode: "SW2748",
      householdName: "Casa Silva",
      whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
      whatsappFreeTextWindow: { open: false },
      guests: rsvpWrite.guests,
      rsvp: { ...rsvpWrite.rsvp, updatedAt: null, submittedBy: null }
    },
    createdAt: "2026-08-20T12:00:00.000Z"
  };

  it("answers 201 with the new dashboard row and CORS headers", async () => {
    createInvitationMock.mockResolvedValue(created);
    const { handler } = await load();

    const response = await handler(event({ body: JSON.stringify({ invitationCode: "SW2748" }) }), context);

    expect(response.statusCode).toBe(201);
    expect(body(response)).toEqual(created);
    expect(response.headers?.["access-control-allow-origin"]).toBe("https://brimax.life");
    expect(createInvitationMock).toHaveBeenCalledWith({ invitationCode: "SW2748" });
  });

  it("omits the allow-origin header for an origin outside the allowlist", async () => {
    createInvitationMock.mockResolvedValue(created);
    const { handler } = await load();

    const response = await handler(
      event({ headers: { origin: "https://evil.example" } } as Partial<APIGatewayProxyEventV2>),
      context
    );

    expect(response.headers?.["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers 400 for a malformed body rather than failing as a 500", async () => {
    const { handler } = await load();

    const response = await handler(event({ body: "{not json" }), context);

    expect(response.statusCode).toBe(400);
    expect(body(response)).toEqual({ message: "Invalid invitation request." });
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it("maps a rejected payload to 400 without leaking the Zod issues", async () => {
    createInvitationMock.mockRejectedValue(new ZodError([]));
    const { handler } = await load();

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(400);
    expect(reportHandledErrorMock).toHaveBeenCalledWith(
      expect.any(ZodError),
      expect.objectContaining({ metric: "ADMIN_INVITATION_CREATE_FAILED", statusCode: 400 })
    );
  });

  it("surfaces a duplicate code as a 409 carrying the service's own message", async () => {
    createInvitationMock.mockRejectedValue(new AppError("Invitation code already in use.", 409));
    const { handler } = await load();

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(409);
    expect(body(response)).toEqual({ message: "Invitation code already in use." });
  });

  it("hides an unexpected failure behind a 500", async () => {
    createInvitationMock.mockRejectedValue(new Error("dynamo exploded"));
    const { handler } = await load();

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(500);
    expect(body(response)).toEqual({ message: "Unexpected invitation create error." });
    expect(body(response).message).not.toContain("dynamo");
  });
});

describe("DELETE /admin/invitations/{invitationCode}", () => {
  const load = () => import("../src/functions/admin-invitation-delete/handler");
  const deleted = {
    ok: true as const,
    invitationCode: "SW2748",
    deletedAt: "2026-08-20T12:00:00.000Z",
    deleted: { guests: 2, rsvp: 1, whatsappItems: 7, phoneLookups: 1 }
  };

  it("answers with what the cascade removed", async () => {
    deleteInvitationMock.mockResolvedValue(deleted);
    const { handler } = await load();

    const response = await handler(event({ body: undefined }), context);

    expect(response.statusCode).toBe(200);
    expect(body(response)).toEqual(deleted);
    expect(deleteInvitationMock).toHaveBeenCalledWith("SW2748");
  });

  it("answers 400 for a missing invitation code without reaching the service", async () => {
    const { handler } = await load();

    const response = await handler(event({ pathParameters: {} }), context);

    expect(response.statusCode).toBe(400);
    expect(body(response)).toEqual({ message: "Missing invitation code." });
    expect(deleteInvitationMock).not.toHaveBeenCalled();
  });

  it("surfaces an unknown invitation as a 404", async () => {
    deleteInvitationMock.mockRejectedValue(new AppError("Invitation not found.", 404));
    const { handler } = await load();

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(404);
    expect(reportHandledErrorMock).toHaveBeenCalledWith(
      expect.any(AppError),
      expect.objectContaining({
        metric: "ADMIN_INVITATION_DELETE_FAILED",
        context: expect.objectContaining({ invitationCode: "SW2748", requestId: "req-admin-1" })
      })
    );
  });

  it("hides an unexpected failure behind a 500", async () => {
    deleteInvitationMock.mockRejectedValue(new Error("dynamo exploded"));
    const { handler } = await load();

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(500);
    expect(body(response)).toEqual({ message: "Unexpected invitation delete error." });
    expect(body(response).message).not.toContain("dynamo");
  });
});

describe("POST /admin/invitations/{invitationCode}/guests", () => {
  const load = () => import("../src/functions/admin-invitation-guests-add/handler");

  it("answers with the reconciliation payload", async () => {
    addGuestsMock.mockResolvedValue(rsvpWrite);
    const { handler } = await load();

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(200);
    expect(body(response)).toEqual(rsvpWrite);
    expect(addGuestsMock).toHaveBeenCalledWith("SW2748", { guests: [{ guestName: "Duda" }] });
  });

  it("answers 400 for a malformed body rather than failing as a 500", async () => {
    const { handler } = await load();

    const response = await handler(event({ body: "{not json" }), context);

    expect(response.statusCode).toBe(400);
    expect(body(response)).toEqual({ message: "Invalid add guests request." });
    expect(addGuestsMock).not.toHaveBeenCalled();
  });

  it("maps a rejected payload to 400", async () => {
    addGuestsMock.mockRejectedValue(new ZodError([]));
    const { handler } = await load();

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(400);
    expect(reportHandledErrorMock).toHaveBeenCalledWith(
      expect.any(ZodError),
      expect.objectContaining({ metric: "ADMIN_INVITATION_GUESTS_ADD_FAILED", statusCode: 400 })
    );
  });

  it("hides an unexpected failure behind a 500", async () => {
    addGuestsMock.mockRejectedValue(new Error("dynamo exploded"));
    const { handler } = await load();

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(500);
    expect(body(response)).toEqual({ message: "Unexpected add guests error." });
    expect(body(response).message).not.toContain("dynamo");
  });
});

describe("DELETE /admin/invitations/{invitationCode}/guests/{guestId}", () => {
  const load = () => import("../src/functions/admin-invitation-guest-remove/handler");

  it("answers with the reconciliation payload and ignores any body", async () => {
    removeGuestMock.mockResolvedValue(rsvpWrite);
    const { handler } = await load();

    const response = await handler(event({ body: undefined }), context);

    expect(response.statusCode).toBe(200);
    expect(body(response)).toEqual(rsvpWrite);
    expect(removeGuestMock).toHaveBeenCalledWith("SW2748", "SW2748--guest-01");
  });

  it("answers 400 for a missing guest id without reaching the service", async () => {
    const { handler } = await load();

    const response = await handler(event({ pathParameters: { invitationCode: "SW2748" } }), context);

    expect(response.statusCode).toBe(400);
    expect(body(response)).toEqual({ message: "Missing invitation code or guest id." });
    expect(removeGuestMock).not.toHaveBeenCalled();
  });

  it("surfaces the last-guest refusal as a 409 carrying the service's own message", async () => {
    removeGuestMock.mockRejectedValue(
      new AppError("Cannot remove the last guest of an invitation. Delete the invitation instead.", 409)
    );
    const { handler } = await load();

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(409);
    expect(body(response).message).toContain("Delete the invitation instead.");
  });

  it("hides an unexpected failure behind a 500", async () => {
    removeGuestMock.mockRejectedValue(new Error("dynamo exploded"));
    const { handler } = await load();

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(500);
    expect(body(response)).toEqual({ message: "Unexpected guest removal error." });
    expect(body(response).message).not.toContain("dynamo");
  });
});
