import type { AdminGuestExportRow, GuestProfile, RsvpSubmissionRequest } from "@brimax/contracts";

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

export function toAdminExportRow(item: UnknownRecord): AdminGuestExportRow {
  return {
    householdId: String(item.householdId ?? ""),
    guestId: String(item.guestId ?? ""),
    invitationCode: String(item.invitationCode ?? ""),
    guestName: String(item.guestName ?? ""),
    phoneNumber: item.phoneNumber ? String(item.phoneNumber) : undefined,
    rsvpStatus: String(item.rsvpStatus ?? "pending"),
    allowedPlusOnes: Number(item.allowedPlusOnes ?? 0)
  };
}

export function deriveOverallRsvpStatus(request: RsvpSubmissionRequest): GuestProfile["rsvpStatus"] {
  return request.attendingGuestCount > 0 ? "attending" : "declined";
}
