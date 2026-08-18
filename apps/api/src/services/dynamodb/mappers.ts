import {
  WhatsappAttendanceEntrySchema,
  WhatsappFlowStageSchema,
  WhatsappFlowStatusSchema,
  WhatsappPhoneSourceSchema,
  WhatsappRsvpStatusResponseSchema
} from "@brimax/contracts";
import type {
  AdminGuestExportRow,
  GuestProfile,
  GuestSummary,
  HouseholdInvitation,
  RsvpSubmissionRequest,
  WhatsappRsvpStatusResponse
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
    isChild: typeof guest.isChild === "boolean" ? guest.isChild : undefined,
    isChildSixOrYounger:
      typeof response?.isChildSixOrYounger === "boolean" ? response.isChildSixOrYounger : undefined,
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
    isChild: typeof item.isChild === "boolean" ? item.isChild : undefined,
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
    phoneNumber: invitation.phoneNumber ? String(invitation.phoneNumber) : undefined,
    whatsappFlowStatus: invitation.whatsappFlowStatus
      ? WhatsappFlowStatusSchema.parse(invitation.whatsappFlowStatus)
      : undefined,
    whatsappFlowStage: invitation.whatsappFlowStage
      ? WhatsappFlowStageSchema.parse(invitation.whatsappFlowStage)
      : undefined,
    whatsappLastOutboundMessageId: invitation.whatsappLastOutboundMessageId ? String(invitation.whatsappLastOutboundMessageId) : undefined,
    whatsappLastInboundMessageId: invitation.whatsappLastInboundMessageId ? String(invitation.whatsappLastInboundMessageId) : undefined,
    whatsappFlowUpdatedAt: invitation.whatsappFlowUpdatedAt ? String(invitation.whatsappFlowUpdatedAt) : undefined,
    whatsappFlowCompletedAt: invitation.whatsappFlowCompletedAt ? String(invitation.whatsappFlowCompletedAt) : undefined,
    whatsappFallbackSentAt: invitation.whatsappFallbackSentAt ? String(invitation.whatsappFallbackSentAt) : undefined,
    whatsappFailureReason: invitation.whatsappFailureReason ? String(invitation.whatsappFailureReason) : undefined,
    whatsappAttendance: Array.isArray(invitation.whatsappAttendance)
      ? invitation.whatsappAttendance.map((entry) => WhatsappAttendanceEntrySchema.parse(entry))
      : undefined,
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

export function toWhatsappRsvpStatus(invitation: UnknownRecord): WhatsappRsvpStatusResponse {
  return WhatsappRsvpStatusResponseSchema.parse({
    invitationCode: String(invitation.invitationCode ?? ""),
    phoneNumber: invitation.phoneNumber ? String(invitation.phoneNumber) : undefined,
    phoneNumberUpdatedAt: invitation.phoneNumberUpdatedAt
      ? String(invitation.phoneNumberUpdatedAt)
      : undefined,
    phoneNumberSource: invitation.phoneNumberSource
      ? WhatsappPhoneSourceSchema.parse(invitation.phoneNumberSource)
      : undefined,
    status: invitation.whatsappFlowStatus
      ? WhatsappFlowStatusSchema.parse(invitation.whatsappFlowStatus)
      : "idle",
    stage: invitation.whatsappFlowStage
      ? WhatsappFlowStageSchema.parse(invitation.whatsappFlowStage)
      : undefined,
    lastOutboundMessageId: invitation.whatsappLastOutboundMessageId
      ? String(invitation.whatsappLastOutboundMessageId)
      : undefined,
    lastInboundMessageId: invitation.whatsappLastInboundMessageId
      ? String(invitation.whatsappLastInboundMessageId)
      : undefined,
    updatedAt: invitation.whatsappFlowUpdatedAt
      ? String(invitation.whatsappFlowUpdatedAt)
      : undefined,
    completedAt: invitation.whatsappFlowCompletedAt
      ? String(invitation.whatsappFlowCompletedAt)
      : undefined,
    fallbackSentAt: invitation.whatsappFallbackSentAt
      ? String(invitation.whatsappFallbackSentAt)
      : undefined,
    failureReason: invitation.whatsappFailureReason
      ? String(invitation.whatsappFailureReason)
      : undefined
  });
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
      isChildSeed: typeof guest.isChild === "boolean" ? guest.isChild : undefined,
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
