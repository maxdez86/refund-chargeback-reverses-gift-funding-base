import { describe, expect, it } from "vitest";
import { createRsvpOperationIdentity } from "../src/domain/rsvp-idempotency";

const request = {
  invitationCode: "AB2345",
  submittedBy: "guest-1",
  guestResponses: [
    { guestId: "guest-2", status: "declined" as const, isChildSixOrYounger: false },
    { guestId: "guest-1", status: "attending" as const, isChildSixOrYounger: false }
  ],
  attendingGuestCount: 1
};

describe("RSVP operation identity", () => {
  it("is stable when guest response order changes", () => {
    const reordered = {
      ...request,
      guestResponses: request.guestResponses.slice().reverse()
    };
    expect(createRsvpOperationIdentity(request)).toEqual(createRsvpOperationIdentity(reordered));
  });

  it("uses a key-derived identity without exposing the key", () => {
    const identity = createRsvpOperationIdentity(request, "safe-key-1");
    expect(identity.websiteOperationId).toMatch(/^website-[a-f0-9]{64}$/);
    expect(identity.websiteIdempotencyKeyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.websiteOperationId).not.toContain("safe-key-1");
  });
});
