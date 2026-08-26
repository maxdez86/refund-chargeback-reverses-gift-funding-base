import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDashboardMock = vi.fn();
const reportHandledErrorMock = vi.fn();

vi.mock("../src/domain/admin-dashboard-service", () => ({
  AdminDashboardService: class {
    getDashboard = getDashboardMock;
  }
}));

vi.mock("../src/lib/sentry", () => ({
  reportHandledError: (...args: unknown[]) => reportHandledErrorMock(...args),
  wrapLambdaHandler: <T>(handler: T) => handler
}));

function event() {
  return {
    headers: { origin: "https://dev.brimax.life" },
    requestContext: { requestId: "request-1" }
  } as APIGatewayProxyEventV2;
}

describe("GET /admin/dashboard", () => {
  beforeEach(() => {
    vi.stubEnv("STAGE", "dev");
    getDashboardMock.mockReset();
    reportHandledErrorMock.mockReset();
  });

  it.each([
    ["empty", { ok: true, invitations: [], gifts: [], guestMessages: [] }],
    ["populated", {
      ok: true,
      invitations: [{
        invitationCode: "AB2345",
        householdName: "Amanda",
        whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
        whatsappFreeTextWindow: { open: false },
        guests: [{ guestId: "g1", guestName: "Amanda", allowedPlusOnes: 0, rsvpStatus: "pending" }],
        rsvp: {
          status: "pending",
          updatedAt: null,
          submittedBy: null,
          attending: 0,
          paid: 0,
          childrenSixOrYounger: 0
        }
      }],
      gifts: [],
      guestMessages: []
    }]
  ])("returns a contract-valid %s dashboard", async (_label, dashboard) => {
    getDashboardMock.mockResolvedValueOnce(dashboard);
    const { handler } = await import("../src/functions/admin-dashboard/handler");

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "null")).toEqual(dashboard);
    expect(response.headers).toMatchObject({
      "access-control-allow-origin": "https://dev.brimax.life"
    });
  });

  it.each([
    ["service failure", new Error("DynamoDB unavailable")],
    ["invalid service response", undefined]
  ])("returns a safe error for %s", async (_label, failure) => {
    if (failure) getDashboardMock.mockRejectedValueOnce(failure);
    else getDashboardMock.mockResolvedValueOnce({ ok: true, invitations: [{ invitationCode: "bad" }], gifts: [], guestMessages: [] });
    const { handler } = await import("../src/functions/admin-dashboard/handler");

    const response = await handler(event());

    expect(response.statusCode).toBe(500);
    expect(response.body).toBe(JSON.stringify({ message: "Unexpected administrator dashboard error." }));
    expect(reportHandledErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        context: { requestId: "request-1" },
        metric: "ADMIN_DASHBOARD_LOOKUP_FAILED",
        statusCode: 500
      })
    );
  });
});
