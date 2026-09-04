import { describe, expect, it } from "vitest";
import { deriveAdminRsvpStatus, deriveRsvpCounts } from "../src/services/dynamodb/mappers";

const answer = (status: "pending" | "attending" | "declined", isChildSixOrYounger = false) => ({
  guestId: `guest-${status}-${isChildSixOrYounger}`,
  status,
  isChildSixOrYounger
});

describe("deriveAdminRsvpStatus", () => {
  it("reports attending when at least one guest is attending", () => {
    expect(deriveAdminRsvpStatus([answer("attending")])).toBe("attending");
    expect(deriveAdminRsvpStatus([answer("attending"), answer("declined")])).toBe("attending");
    expect(deriveAdminRsvpStatus([answer("pending"), answer("attending")])).toBe("attending");
  });

  it("keeps a partially answered invitation pending", () => {
    expect(deriveAdminRsvpStatus([answer("pending")])).toBe("pending");
    expect(deriveAdminRsvpStatus([answer("declined"), answer("pending")])).toBe("pending");
  });

  it("reports declined only when every guest declined", () => {
    expect(deriveAdminRsvpStatus([answer("declined")])).toBe("declined");
    expect(deriveAdminRsvpStatus([answer("declined"), answer("declined")])).toBe("declined");
  });

  it("agrees with the counts an unanswered guest contributes", () => {
    const guestResponses = [answer("attending"), answer("pending"), answer("declined")];
    const counts = deriveRsvpCounts({
      invitationCode: "AB2345",
      submittedBy: "guest-1",
      guestResponses,
      attendingGuestCount: 1
    });

    expect(deriveAdminRsvpStatus(guestResponses)).toBe("attending");
    // A pending guest is neither confirmed nor paying until they answer.
    expect(counts).toEqual({
      attendingGuestCount: 1,
      paidAttendingGuestCount: 1,
      childSixOrYoungerAttendingCount: 0
    });
  });

  it("counts a confirmed under-six seat as a courtesy rather than a paying one", () => {
    const counts = deriveRsvpCounts({
      invitationCode: "AB2345",
      submittedBy: "guest-1",
      guestResponses: [answer("attending", true), answer("attending")],
      attendingGuestCount: 2
    });

    expect(counts).toEqual({
      attendingGuestCount: 2,
      paidAttendingGuestCount: 1,
      childSixOrYoungerAttendingCount: 1
    });
  });
});
