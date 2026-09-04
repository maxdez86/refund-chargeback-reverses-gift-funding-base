import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { ZodError } from "zod";
import { AppError } from "../src/lib/errors";

const updateGuestMock = vi.fn();
const confirmGuestsMock = vi.fn();
const reportHandledErrorMock = vi.fn();

vi.mock("../src/domain/admin-guest-rsvp-service", () => ({
  AdminGuestRsvpService: class {
    updateGuest = updateGuestMock;
    confirmGuests = confirmGuestsMock;
  }
}));
vi.mock("../src/lib/sentry", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/sentry")>("../src/lib/sentry");
  return { ...actual, reportHandledError: reportHandledErrorMock };
});

const context = {} as Context;

const written = {
  ok: true as const,
  invitationCode: "SW2748",
  guests: [
    {
      guestId: "SW2748--guest-01",
      guestName: "Amanda",
      allowedPlusOnes: 0,
      rsvpStatus: "attending" as const
    }
  ],
  rsvp: {
    status: "attending" as const,
    updatedAt: "2026-08-20T12:00:00.000Z",
    submittedBy: "SW2748--guest-01",
    attending: 1,
    paid: 1,
    childrenSixOrYounger: 0
  },
  updatedAt: "2026-08-20T12:00:00.000Z"
};

function event(overrides: Partial<APIGatewayProxyEventV2> = {}) {
  return {
    headers: { origin: "https://brimax.life" },
    requestContext: { requestId: "req-admin-1" },
    pathParameters: { invitationCode: "SW2748", guestId: "SW2748--guest-01" },
    body: JSON.stringify({ rsvpStatus: "attending" }),
    ...overrides
  } as unknown as APIGatewayProxyEventV2;
}

function body(response: { body?: string }) {
  return JSON.parse(response.body ?? "{}");
}

beforeEach(() => {
  updateGuestMock.mockReset();
  confirmGuestsMock.mockReset();
  reportHandledErrorMock.mockReset();
  process.env.ALLOWED_ORIGINS = "https://brimax.life";
});

describe("admin guest update handler", () => {
  it("returns the reconciliation payload with CORS headers", async () => {
    updateGuestMock.mockResolvedValue(written);
    const { handler } = await import("../src/functions/admin-guest-update/handler");

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(200);
    expect(body(response)).toEqual(written);
    expect(response.headers?.["access-control-allow-origin"]).toBe("https://brimax.life");
    expect(updateGuestMock).toHaveBeenCalledWith("SW2748", "SW2748--guest-01", {
      rsvpStatus: "attending"
    });
  });

  it("passes an empty object through when the request carries no body", async () => {
    updateGuestMock.mockResolvedValue(written);
    const { handler } = await import("../src/functions/admin-guest-update/handler");

    await handler(event({ body: undefined }), context);

    expect(updateGuestMock).toHaveBeenCalledWith("SW2748", "SW2748--guest-01", {});
  });

  it("rejects a request that is missing either path parameter", async () => {
    const { handler } = await import("../src/functions/admin-guest-update/handler");

    const withoutGuest = await handler(
      event({ pathParameters: { invitationCode: "SW2748" } as never }),
      context
    );
    const withoutInvitation = await handler(
      event({ pathParameters: { guestId: "SW2748--guest-01" } as never }),
      context
    );

    expect(withoutGuest.statusCode).toBe(400);
    expect(body(withoutGuest)).toEqual({ message: "Missing invitation code or guest id." });
    expect(withoutInvitation.statusCode).toBe(400);
    expect(updateGuestMock).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed body rather than failing as a 500", async () => {
    const { handler } = await import("../src/functions/admin-guest-update/handler");

    const response = await handler(event({ body: "{not json" }), context);

    expect(response.statusCode).toBe(400);
    expect(body(response)).toEqual({ message: "Invalid guest update request." });
    expect(updateGuestMock).not.toHaveBeenCalled();
  });

  it("maps a rejected payload to 400 without leaking the Zod issues", async () => {
    updateGuestMock.mockRejectedValue(new ZodError([]));
    const { handler } = await import("../src/functions/admin-guest-update/handler");

    const response = await handler(event({ body: JSON.stringify({}) }), context);

    expect(response.statusCode).toBe(400);
    expect(body(response)).toEqual({ message: "Invalid guest update request." });
    expect(reportHandledErrorMock).toHaveBeenCalledWith(
      expect.any(ZodError),
      expect.objectContaining({ metric: "ADMIN_GUEST_UPDATE_FAILED", statusCode: 400 })
    );
  });

  it("passes an AppError's status and message straight through", async () => {
    updateGuestMock.mockRejectedValue(new AppError("Guest not found.", 404));
    const { handler } = await import("../src/functions/admin-guest-update/handler");

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(404);
    expect(body(response)).toEqual({ message: "Guest not found." });
    expect(reportHandledErrorMock).toHaveBeenCalledWith(
      expect.any(AppError),
      expect.objectContaining({
        metric: "ADMIN_GUEST_UPDATE_FAILED",
        context: expect.objectContaining({
          invitationCode: "SW2748",
          guestId: "SW2748--guest-01",
          requestId: "req-admin-1"
        })
      })
    );
  });

  it("hides an unexpected failure behind a 500", async () => {
    updateGuestMock.mockRejectedValue(new Error("dynamo exploded"));
    const { handler } = await import("../src/functions/admin-guest-update/handler");

    const response = await handler(event(), context);

    expect(response.statusCode).toBe(500);
    expect(body(response)).toEqual({ message: "Unexpected guest update error." });
    expect(body(response).message).not.toContain("dynamo");
  });
});

describe("admin confirm-all handler", () => {
  it("confirms the selected guests and returns the reconciliation payload", async () => {
    confirmGuestsMock.mockResolvedValue(written);
    const { handler } = await import("../src/functions/admin-invitation-confirm-guests/handler");

    const response = await handler(
      event({
        pathParameters: { invitationCode: "SW2748" } as never,
        body: JSON.stringify({ guestIds: ["SW2748--guest-01"] })
      }),
      context
    );

    expect(response.statusCode).toBe(200);
    expect(body(response)).toEqual(written);
    expect(confirmGuestsMock).toHaveBeenCalledWith("SW2748", {
      guestIds: ["SW2748--guest-01"]
    });
  });

  it("rejects a missing invitation code and a malformed body", async () => {
    const { handler } = await import("../src/functions/admin-invitation-confirm-guests/handler");

    const withoutCode = await handler(event({ pathParameters: undefined }), context);
    const malformed = await handler(
      event({ pathParameters: { invitationCode: "SW2748" } as never, body: "{" }),
      context
    );

    expect(withoutCode.statusCode).toBe(400);
    expect(body(withoutCode)).toEqual({ message: "Missing invitation code." });
    expect(malformed.statusCode).toBe(400);
    expect(body(malformed)).toEqual({ message: "Invalid guest confirmation request." });
    expect(confirmGuestsMock).not.toHaveBeenCalled();
  });

  it("maps service failures onto the shared envelopes", async () => {
    const { handler } = await import("../src/functions/admin-invitation-confirm-guests/handler");

    confirmGuestsMock.mockRejectedValue(new ZodError([]));
    const invalid = await handler(
      event({ pathParameters: { invitationCode: "SW2748" } as never }),
      context
    );
    confirmGuestsMock.mockRejectedValue(new AppError("Invitation not found.", 404));
    const missing = await handler(
      event({ pathParameters: { invitationCode: "SW2748" } as never }),
      context
    );
    confirmGuestsMock.mockRejectedValue(new Error("dynamo exploded"));
    const broken = await handler(
      event({ pathParameters: { invitationCode: "SW2748" } as never }),
      context
    );

    expect(invalid.statusCode).toBe(400);
    expect(body(invalid)).toEqual({ message: "Invalid guest confirmation request." });
    expect(missing.statusCode).toBe(404);
    expect(body(missing)).toEqual({ message: "Invitation not found." });
    expect(broken.statusCode).toBe(500);
    expect(body(broken)).toEqual({ message: "Unexpected guest confirmation error." });
    expect(reportHandledErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ metric: "ADMIN_CONFIRM_GUESTS_FAILED", statusCode: 500 })
    );
  });
});
