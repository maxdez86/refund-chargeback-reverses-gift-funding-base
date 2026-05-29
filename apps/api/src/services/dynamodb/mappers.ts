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

type GroupedInvitationItems = {
  invitation: UnknownRecord;
  guests: UnknownRecord[];
  rsvp?: UnknownRecord;
};

function toEffectiveGuestSummary(
  guest: UnknownRecord,
  response?: { status?: unknown; isChildSixOrYounger?: unknown }
): GuestSummary {
  const status = response?.status;

  return {
    guestId: String(guest.guestId ?? ""),
    guestName: String(guest.guestName ?? ""),
    allowedPlusOnes: Number(guest.allowedPlusOnes ?? 0),
    rsvpStatus:
      status === "attending" || status === "declined"
        ? status
        : ((guest.rsvpStatus as GuestSummary["rsvpStatus"]) ?? "pending"),
    isChildSixOrYounger:
      typeof response?.isChildSixOrYounger === "boolean"
        ? response.isChildSixOrYounger
        : typeof guest.isChildSixOrYounger === "boolean"
          ? guest.isChildSixOrYounger
          : undefined,
    dietaryNotes: guest.dietaryNotes ? String(guest.dietaryNotes) : undefined
  };
}

export function toGuestProfile(item: UnknownRecord): GuestProfile {
  return {
    invitationCode: String(item.invitationCode ?? ""),
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

export function toHouseholdInvitation({
  invitation,
  guests,
  rsvp
}: GroupedInvitationItems): HouseholdInvitation {
  const responsesByGuestId = new Map<string, { status?: unknown; isChildSixOrYounger?: unknown }>(
    Array.isArray(rsvp?.guestResponses)
      ? (rsvp.guestResponses as UnknownRecord[]).map((response) => [
          String(response.guestId ?? ""),
          {
            status: response.status,
            isChildSixOrYounger: response.isChildSixOrYounger
          }
        ])
      : []
  );

  return {
    invitationCode: String(invitation.invitationCode ?? ""),
    householdName: String(invitation.householdName ?? ""),
    guests: guests
      .slice()
      .sort(
        (left, right) =>
          Number(left.sortOrder ?? Number.MAX_SAFE_INTEGER) -
          Number(right.sortOrder ?? Number.MAX_SAFE_INTEGER)
      )
      .map((guest) =>
        toEffectiveGuestSummary(guest, responsesByGuestId.get(String(guest.guestId ?? "")))
      )
  };
}

export function toAdminExportRows({
  invitation,
  guests,
  rsvp
}: GroupedInvitationItems): AdminGuestExportRow[] {
  const invitationCode = String(invitation.invitationCode ?? "");
  const householdName = String(invitation.householdName ?? "");
  const responsesByGuestId = new Map(
    Array.isArray(rsvp?.guestResponses)
      ? (rsvp.guestResponses as UnknownRecord[]).map((response) => [
          String(response.guestId ?? ""),
          {
            attending: response.status === "attending",
            isChildSixOrYoungerConfirmed:
              typeof response.isChildSixOrYounger === "boolean"
                ? response.isChildSixOrYounger
                : undefined
          }
        ])
      : []
  );

  return guests
    .slice()
    .sort(
      (left, right) =>
        Number(left.sortOrder ?? Number.MAX_SAFE_INTEGER) -
        Number(right.sortOrder ?? Number.MAX_SAFE_INTEGER)
    )
    .map((guest) => ({
      householdName,
      guestId: String(guest.guestId ?? ""),
      invitationCode,
      guestName: String(guest.guestName ?? ""),
      phoneNumber: guest.phoneNumber ? String(guest.phoneNumber) : undefined,
      rsvpStatus:
        (responsesByGuestId.get(String(guest.guestId ?? ""))?.attending === true
          ? "attending"
          : responsesByGuestId.has(String(guest.guestId ?? ""))
            ? "declined"
            : String(guest.rsvpStatus ?? "pending")) ?? "pending",
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
