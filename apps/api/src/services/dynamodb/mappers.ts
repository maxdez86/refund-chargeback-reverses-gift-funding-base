import type {
  AdminGuestExportRow,
  GuestProfile,
  GuestSummary,
  HouseholdInvitation,
  RsvpSubmissionRequest
} from "@brimax/contracts";

type UnknownRecord = Record<string, unknown>;

export function toGuestProfile(item: UnknownRecord): GuestProfile {
  return {
    invitationCode: String(item.invitationCode ?? ""),
    householdId: String(item.householdId ?? ""),
    guestId: String(item.guestId ?? ""),
    guestName: String(item.guestName ?? ""),
    phoneNumber: item.phoneNumber ? String(item.phoneNumber) : undefined,
    allowedPlusOnes: Number(item.allowedPlusOnes ?? 0),
    rsvpStatus: (item.rsvpStatus as GuestProfile["rsvpStatus"]) ?? "pending",
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

  return rawGuests.map((guest) => ({
    householdId,
    guestId: String(guest.guestId ?? ""),
    invitationCode,
    guestName: String(guest.guestName ?? ""),
    phoneNumber,
    rsvpStatus: String(guest.rsvpStatus ?? "pending"),
    allowedPlusOnes: Number(guest.allowedPlusOnes ?? 0)
  }));
}

export function deriveOverallRsvpStatus(request: RsvpSubmissionRequest): GuestProfile["rsvpStatus"] {
  return request.attendingGuestCount > 0 ? "attending" : "declined";
}
