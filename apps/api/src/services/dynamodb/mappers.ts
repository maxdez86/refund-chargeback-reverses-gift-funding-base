import {
  AdminDashboardInvitationSchema,
  AdminDashboardWhatsappConversationSchema,
  RsvpStatusSchema,
  WhatsappAttendanceEntrySchema,
  WhatsappFlowStageSchema,
  WhatsappFlowStatusSchema,
  WhatsappPhoneSourceSchema,
  WhatsappRsvpStatusResponseSchema
} from "@brimax/contracts";
import type {
  AdminGuestExportRow,
  AdminDashboardInvitation,
  AdminDashboardWhatsappConversation,
  GuestProfile,
  GuestSummary,
  HouseholdInvitation,
  RsvpGuestAnswer,
  RsvpStatus,
  RsvpSubmissionRequest,
  WhatsappRsvpStatusResponse
} from "@brimax/contracts";
import { RsvpResponseItemSchema } from "./rsvp-items";
import { actionForButtonId } from "../whatsapp/template-manifest";
import { deriveWhatsappRsvpSendAvailability } from "../../domain/whatsapp-rsvp-send-availability";
import { deriveWhatsappFreeTextWindow } from "../../domain/whatsapp-free-text-window";

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

/**
 * The dashboard grouping additionally carries the invitation's stored WhatsApp message records.
 * `toHouseholdInvitation()` and `toAdminExportRows()` keep the narrower shape — they never read
 * message items.
 */
type GroupedDashboardInvitationItems = GroupedInvitationItems & {
  messages: UnknownRecord[];
};

type DashboardInvitationOptions = {
  /** Invoked once per message record dropped for a missing messageId, direction, or createdAt. */
  onSkippedMessage?: () => void;
  /** Evaluation instant for time-derived state such as the free-text window. Injectable for tests. */
  now?: Date;
};

/**
 * Matches `AdminDashboardWhatsappConversationSchema`'s `lastMessagePreview` maximum. The single
 * truncation rule is a plain `slice` to this length with no ellipsis appended, so the truncated
 * value is always a prefix of the stored body and always satisfies the schema bound.
 */
const WHATSAPP_PREVIEW_MAX_LENGTH = 160;

type UsableWhatsappMessage = {
  messageId: string;
  createdAt: string;
  direction: "inbound" | "outbound";
  record: UnknownRecord;
};

/**
 * Aggregates the stored WhatsApp message records of one invitation into the dashboard summary.
 *
 * Pure by design so it can be unit-tested without a DynamoDB client. Only messages whose effective
 * correlation status is `matched` and that carry a non-empty `invitationCode` are counted — the
 * effective status mirrors `whatsapp-items.ts`, which treats an absent `correlationStatus` as
 * `matched` when an `invitationCode` is present. Returns `undefined` when nothing qualifies, which
 * is how the caller signals "no conversation" by omitting the field entirely.
 */
export function toAdminDashboardWhatsappConversation(
  messages: UnknownRecord[],
  options: DashboardInvitationOptions = {}
): AdminDashboardWhatsappConversation | undefined {
  const usable: UsableWhatsappMessage[] = [];

  for (const record of messages) {
    const messageId = typeof record.messageId === "string" ? record.messageId : "";
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
    const direction = record.direction;
    if (!messageId || !createdAt || (direction !== "inbound" && direction !== "outbound")) {
      options.onSkippedMessage?.();
      continue;
    }

    const invitationCode = typeof record.invitationCode === "string" ? record.invitationCode : "";
    const correlationStatus =
      record.correlationStatus ?? (invitationCode ? "matched" : "unmatched_sender");
    if (correlationStatus !== "matched" || !invitationCode) continue;

    usable.push({ messageId, createdAt, direction, record });
  }

  if (usable.length === 0) return undefined;

  usable.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.messageId.localeCompare(right.messageId)
  );

  const newest = usable[usable.length - 1]!;
  const newestOutbound = usable.filter((message) => message.direction === "outbound").at(-1);
  const newestInbound = usable.filter((message) => message.direction === "inbound").at(-1);
  let unreadCount = 0;
  for (let index = usable.length - 1; index >= 0 && usable[index]!.direction === "inbound"; index -= 1) {
    unreadCount += 1;
  }

  const body = newest.record.body;

  return AdminDashboardWhatsappConversationSchema.parse({
    messageCount: usable.length,
    unreadCount,
    lastMessageAt: newest.createdAt,
    lastMessageDirection: newest.direction,
    ...(newest.record.messageType === undefined ? {} : { lastMessageType: newest.record.messageType }),
    ...(optionalString(newest.record.templateId)
      ? { lastMessageTemplateId: optionalString(newest.record.templateId) }
      : {}),
    ...(messagePreview(body) ? { lastMessagePreview: messagePreview(body) } : {}),
    ...directionSummary("Outbound", newestOutbound),
    ...directionSummary("Inbound", newestInbound)
  });
}

export function toEffectiveGuestSummary(
  guest: UnknownRecord,
  response?: { status?: unknown; isChildSixOrYounger?: unknown }
): GuestSummary {
  const status = response?.status;
  const seedStatus = RsvpStatusSchema.parse(guest.rsvpStatus ?? "pending");

  return {
    guestId: String(guest.guestId ?? ""),
    guestName: String(guest.guestName ?? ""),
    allowedPlusOnes: Number(guest.allowedPlusOnes ?? 0),
    rsvpStatus:
      status === "attending" || status === "declined"
        ? status
        : seedStatus,
    isChild: typeof guest.isChild === "boolean" ? guest.isChild : undefined,
    isChildSixOrYounger:
      typeof response?.isChildSixOrYounger === "boolean" ? response.isChildSixOrYounger : undefined,
    dietaryNotes: guest.dietaryNotes ? String(guest.dietaryNotes) : undefined
  };
}

function optionalString(value: unknown) {
  return value === undefined || value === null ? undefined : String(value);
}

function messagePreview(value: unknown) {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, WHATSAPP_PREVIEW_MAX_LENGTH)
    : undefined;
}

function directionSummary(
  direction: "Outbound" | "Inbound",
  message: UsableWhatsappMessage | undefined
) {
  if (!message) return {};

  const templateId = optionalString(message.record.templateId);
  const preview = messagePreview(message.record.body);
  const buttonId = optionalString(message.record.buttonId);
  const buttonAction = buttonId ? actionForButtonId(buttonId) : undefined;
  return {
    ...(templateId ? { [`last${direction}MessageTemplateId`]: templateId } : {}),
    ...(preview ? { [`last${direction}MessagePreview`]: preview } : {}),
    ...(direction === "Inbound" && buttonId ? { lastInboundMessageButtonId: buttonId } : {}),
    ...(direction === "Inbound" && buttonAction ? { lastInboundMessageButtonAction: buttonAction } : {})
  };
}

function compareDashboardGuests(left: UnknownRecord, right: UnknownRecord) {
  const leftOrder = typeof left.sortOrder === "number" && Number.isInteger(left.sortOrder) && left.sortOrder > 0
    ? left.sortOrder
    : Number.POSITIVE_INFINITY;
  const rightOrder = typeof right.sortOrder === "number" && Number.isInteger(right.sortOrder) && right.sortOrder > 0
    ? right.sortOrder
    : Number.POSITIVE_INFINITY;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;

  const idComparison = String(left.guestId ?? "").localeCompare(String(right.guestId ?? ""));
  return idComparison || String(left.guestName ?? "").localeCompare(String(right.guestName ?? ""));
}

export function toAdminDashboardInvitation(
  { invitation, guests, rsvp, messages }: GroupedDashboardInvitationItems,
  options: DashboardInvitationOptions = {}
): AdminDashboardInvitation {
  const parsedRsvp = rsvp ? RsvpResponseItemSchema.parse(rsvp) : undefined;
  const responsesByGuestId = new Map(
    parsedRsvp?.guestResponses.map((response) => [response.guestId, response]) ?? []
  );

  const householdInvitation = toHouseholdInvitation({ invitation, guests, rsvp });
  const now = options.now ?? new Date();
  return AdminDashboardInvitationSchema.parse({
    invitationCode: String(invitation.invitationCode ?? ""),
    householdName: String(invitation.householdName ?? ""),
    phoneNumber: optionalString(invitation.phoneNumber),
    phoneNumberSource: invitation.phoneNumberSource,
    phoneNumberUpdatedAt: optionalString(invitation.phoneNumberUpdatedAt),
    whatsappFlowStatus: invitation.whatsappFlowStatus,
    whatsappFlowStage: invitation.whatsappFlowStage,
    whatsappFlowUpdatedAt: optionalString(invitation.whatsappFlowUpdatedAt),
    whatsappFlowCompletedAt: optionalString(invitation.whatsappFlowCompletedAt),
    whatsappFallbackSentAt: optionalString(invitation.whatsappFallbackSentAt),
    whatsappLastInboundMessageId: optionalString(invitation.whatsappLastInboundMessageId),
    whatsappLastOutboundMessageId: optionalString(invitation.whatsappLastOutboundMessageId),
    whatsappFailureReason: optionalString(invitation.whatsappFailureReason),
    whatsappSendAvailability: deriveWhatsappRsvpSendAvailability(householdInvitation),
    whatsappFreeTextWindow: deriveWhatsappFreeTextWindow(householdInvitation, now),
    whatsappConversation: toAdminDashboardWhatsappConversation(messages, options),
    guests: guests
      .slice()
      .sort(compareDashboardGuests)
      .map((guest) =>
        toEffectiveGuestSummary(guest, responsesByGuestId.get(String(guest.guestId ?? "")))
      ),
    rsvp: parsedRsvp
      ? {
          status: parsedRsvp.status,
          updatedAt: parsedRsvp.updatedAt,
          submittedBy: parsedRsvp.submittedBy,
          attending: parsedRsvp.attendingGuestCount,
          paid: parsedRsvp.paidAttendingGuestCount,
          childrenSixOrYounger: parsedRsvp.childSixOrYoungerAttendingCount,
          note: parsedRsvp.note
        }
      : {
          status: "pending",
          updatedAt: null,
          submittedBy: null,
          attending: 0,
          paid: 0,
          childrenSixOrYounger: 0
        }
  });
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
    whatsappLastInboundAt: invitation.whatsappLastInboundAt ? String(invitation.whatsappLastInboundAt) : undefined,
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

export function toWhatsappRsvpStatus(
  invitation: UnknownRecord,
  householdInvitation: HouseholdInvitation,
  now: Date = new Date()
): WhatsappRsvpStatusResponse {
  return WhatsappRsvpStatusResponseSchema.parse({
    invitationCode: String(invitation.invitationCode ?? ""),
    sendAvailability: deriveWhatsappRsvpSendAvailability(householdInvitation),
    freeTextWindow: deriveWhatsappFreeTextWindow(householdInvitation, now),
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

/**
 * Overall invitation status for a partially answered RSVP.
 *
 * `deriveOverallRsvpStatus()` cannot serve here: a website submission answers for every guest at
 * once, so it only ever yields `attending` or `declined`. An admin correction touches one guest at
 * a time and leaves the rest unanswered, which has to stay visible as `pending` rather than being
 * rounded down to `declined`.
 *
 * The rule is the one the dashboard's own `recalculateRsvp()` already applies, so the value the API
 * stores and the value the panel would compute can never disagree. The guest list is never empty —
 * `HouseholdInvitationSchema` requires at least one guest — so the empty case is unreachable.
 */
export function deriveAdminRsvpStatus(
  guestResponses: Pick<RsvpGuestAnswer, "status">[]
): RsvpStatus {
  if (guestResponses.some((response) => response.status === "attending")) return "attending";
  return guestResponses.some((response) => response.status === "pending") ? "pending" : "declined";
}

export function deriveOverallRsvpStatus(request: RsvpSubmissionRequest): GuestProfile["rsvpStatus"] {
  return deriveRsvpCounts(request).attendingGuestCount > 0 ? "attending" : "declined";
}

/**
 * Aggregates from a set of answers. Takes only `guestResponses` so the admin path can pass the
 * invitation's effective per-guest view — which includes guests who have no stored answer yet —
 * without inventing the rest of a submission request.
 */
export function deriveRsvpCounts(
  request: Pick<RsvpSubmissionRequest, "guestResponses">
): RsvpCounts {
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
