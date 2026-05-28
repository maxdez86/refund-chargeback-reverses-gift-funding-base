import type {
  AdminGuestExportRow,
  GuestProfile,
  GuestSummary,
  HouseholdInvitation,
  RsvpSubmissionRequest
} from "@brimax/contracts";

type UnknownRecord = Record<string, unknown>;

type RsvpCounts = {
  attendingGuestCount: number;
  paidAttendingGuestCount: number;
  childSixOrYoungerAttendingCount: number;
};

export function toGuestProfile(item: UnknownRecord): GuestProfile {
  return {
    invitationCode: String(item.invitationCode ?? ""),
    householdId: String(item.householdId ?? ""),
    guestId: String(item.guestId ?? ""),
    guestName: String(item.guestName ?? ""),
    phoneNumber: item.phoneNumber ? String(item.phoneNumber) : undefined,
    allowedPlusOnes: Number(item.allowedPlusOnes ?? 0),
    rsvpStatus: (item.rsvpStatus as GuestProfile["rsvpStatus"]) ?? "pending",
    isChildSixOrYounger:
      typeof item.isChildSixOrYounger === "boolean"
        ? item.isChildSixOrYounger
        : undefined,
    dietaryNotes: item.dietaryNotes ? String(item.dietaryNotes) : undefined
  };
}

export function toHouseholdInvitation(item: UnknownRecord): HouseholdInvitation {
  const rawGuests = Array.isArray(item.guests) ? (item.guests as UnknownRecord[]) : [];
  const guests: GuestSummary[] = rawGuests.map((guest) => ({
    guestId: String(guest.guestId ?? ""),
    guestName: String(guest.guestName ?? ""),
    allowedPlusOnes: Number(guest.allowedPlusOnes ?? 0),
    rsvpStatus: (guest.rsvpStatus as GuestSummary["rsvpStatus"]) ?? "pending",
    isChildSixOrYounger:
      typeof guest.isChildSixOrYounger === "boolean"
        ? guest.isChildSixOrYounger
        : undefined,
    dietaryNotes: guest.dietaryNotes ? String(guest.dietaryNotes) : undefined
  }));

  return {
    invitationCode: String(item.invitationCode ?? ""),
    householdId: String(item.householdId ?? ""),
    householdName: String(item.householdName ?? ""),
    guests
  };
}

export function toAdminExportRows(item: UnknownRecord): AdminGuestExportRow[] {
  const householdId = String(item.householdId ?? "");
  const invitationCode = String(item.invitationCode ?? "");
  const phoneNumber = item.phoneNumber ? String(item.phoneNumber) : undefined;
  const rawGuests = Array.isArray(item.guests) ? (item.guests as UnknownRecord[]) : [];
  const rawGuestResponses = Array.isArray(item.rsvpGuestResponses)
    ? (item.rsvpGuestResponses as UnknownRecord[])
    : [];
  const responsesByGuestId = new Map(
    rawGuestResponses.map((response) => [
      String(response.guestId ?? ""),
      {
        attending: response.status === "attending",
        isChildSixOrYoungerConfirmed:
          typeof response.isChildSixOrYounger === "boolean"
            ? response.isChildSixOrYounger
            : undefined
      }
    ])
  );

  return rawGuests.map((guest) => ({
    householdId,
    guestId: String(guest.guestId ?? ""),
    invitationCode,
    guestName: String(guest.guestName ?? ""),
    phoneNumber,
    rsvpStatus: String(guest.rsvpStatus ?? "pending"),
    allowedPlusOnes: Number(guest.allowedPlusOnes ?? 0),
    attending: responsesByGuestId.get(String(guest.guestId ?? ""))?.attending,
    isChildSixOrYoungerSeed:
      typeof guest.isChildSixOrYounger === "boolean"
        ? guest.isChildSixOrYounger
        : undefined,
    isChildSixOrYoungerConfirmed: responsesByGuestId.get(String(guest.guestId ?? ""))
      ?.isChildSixOrYoungerConfirmed
  }));
}

export function deriveOverallRsvpStatus(request: RsvpSubmissionRequest): GuestProfile["rsvpStatus"] {
  return deriveRsvpCounts(request).attendingGuestCount > 0 ? "attending" : "declined";
}

export function deriveRsvpCounts(request: RsvpSubmissionRequest): RsvpCounts {
  return request.guestResponses.reduce<RsvpCounts>(
    (counts, response) => {
      if (response.status !== "attending") {
        return counts;
      }

      counts.attendingGuestCount += 1;

      if (response.isChildSixOrYounger) {
        counts.childSixOrYoungerAttendingCount += 1;
      } else {
        counts.paidAttendingGuestCount += 1;
      }

      return counts;
    },
    {
      attendingGuestCount: 0,
      paidAttendingGuestCount: 0,
      childSixOrYoungerAttendingCount: 0
    }
  );
}
