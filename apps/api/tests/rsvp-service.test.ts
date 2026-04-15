import { describe, expect, it, vi } from "vitest";
import type { RsvpSubmissionRequest } from "@brimax/contracts";
import { RsvpService } from "../src/domain/rsvp-service";

describe("RsvpService", () => {
  it("stores RSVP responses and returns normalized status", async () => {
    const repository = {
      upsertRsvp: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z")
    };
    const service = new RsvpService(repository as never);
    const request: RsvpSubmissionRequest = {
      invitationCode: "ABCD1234",
      householdId: "household-001",
      submittedBy: "Max",
      guestResponses: [{ guestId: "guest-001", status: "attending" }],
      attendingGuestCount: 1
    };

    const response = await service.submit(request);

    expect(repository.upsertRsvp).toHaveBeenCalled();
    expect(response.status).toBe("attending");
  });
});
