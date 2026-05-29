import { afterEach, describe, expect, it, vi } from "vitest";

describe("rsvp-api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("fetchInvitation requests the normalized code and parses the response", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          invitationCode: "AB2345",
          householdName: "Amanda e Chris",
          guests: [
            {
              guestId: "g1",
              guestName: "Amanda",
              allowedPlusOnes: 0,
              rsvpStatus: "pending",
              isChildSixOrYounger: true
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { fetchInvitation } = await import("@/lib/rsvp-api");
    const invitation = await fetchInvitation("  ab-2345 ");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/invitation/AB2345"
    );
    expect(invitation.householdName).toBe("Amanda e Chris");
    expect(invitation.guests).toHaveLength(1);
    expect(invitation.guests[0]?.isChildSixOrYounger).toBe(true);
  });

  it("fetchInvitation throws RsvpApiError with status=404 when not found", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    // Each invocation gets a fresh Response so the body can be re-read.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ message: "Invitation not found." }), {
        status: 404,
        headers: { "content-type": "application/json" }
      })
    );

    const { fetchInvitation, RsvpApiError } = await import("@/lib/rsvp-api");
    await expect(fetchInvitation("MISSING1")).rejects.toMatchObject({
      status: 404
    });
    await expect(fetchInvitation("MISSING1")).rejects.toBeInstanceOf(
      RsvpApiError
    );
  });

  it("fetchInvitation rejects a malformed payload", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ invitationCode: "AB2345" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const { fetchInvitation } = await import("@/lib/rsvp-api");
    await expect(fetchInvitation("AB2345")).rejects.toThrow(
      /Resposta inválida/
    );
  });

  it("submitRsvp posts with an idempotency-key header and content-type", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          invitationCode: "AB2345",
          status: "attending",
          updatedAt: "2026-05-14T00:00:00.000Z"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const { submitRsvp } = await import("@/lib/rsvp-api");
    const response = await submitRsvp({
      invitationCode: "AB2345",
      submittedBy: "g1",
      guestResponses: [{ guestId: "g1", status: "attending", isChildSixOrYounger: false }],
      attendingGuestCount: 1
    });

    expect(response.status).toBe("attending");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/rsvp");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["idempotency-key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("submitRsvp surfaces server errors as RsvpApiError", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "boom" }), { status: 500 })
    );

    const { submitRsvp, RsvpApiError } = await import("@/lib/rsvp-api");
    await expect(
      submitRsvp({
        invitationCode: "AB2345",
        submittedBy: "g1",
        guestResponses: [{ guestId: "g1", status: "attending", isChildSixOrYounger: false }],
        attendingGuestCount: 1
      })
    ).rejects.toBeInstanceOf(RsvpApiError);
  });
});
