import type {
  Gift,
  GuestMessage,
  RsvpStatus,
  WhatsappCommandStatus,
  WhatsappFlowStage,
  WhatsappFlowStatus,
  WhatsappPhoneSource,
  WhatsappReconciliationStatus,
  WhatsappRsvpTemplatePurpose
} from "@brimax/contracts";

/**
 * View model for the administrative dashboard. The shapes deliberately extend the
 * published contracts so swapping the fixture source for real admin endpoints is a
 * mapping exercise, not a rewrite — see `admin-dashboard-source.ts`.
 */

/** One person on an invitation. Mirrors `GuestSummary` plus the fields the panel shows. */
export type AdminGuest = {
  guestId: string;
  guestName: string;
  /**
   * Operator seed, stored on the guest item: this person is 0–11. It is what makes the
   * RSVP page ask the guest for the age band; it says nothing about who pays.
   */
  isChild: boolean;
  /**
   * The guest's own answer to that age question, kept on the RSVP response. `true` is the
   * courtesy seat — attending but never charged. `undefined` while no answer is recorded;
   * the dashboard only ever reads this field, the guest is the one who sets it.
   */
  isChildSixOrYounger?: boolean;
  allowedPlusOnes: number;
  rsvpStatus: RsvpStatus;
};

/** One outbound send intent, as surfaced by `GET /admin/whatsapp/invitations/{code}`. */
export type AdminWhatsappCommand = {
  commandId: string;
  createdAt: string;
  templateId: WhatsappRsvpTemplatePurpose;
  stage: WhatsappFlowStage;
  status: WhatsappCommandStatus;
  retryCount: number;
  reconciliationStatus: WhatsappReconciliationStatus;
};

/** The invitation-level RSVP roll-up the panel reads; derived from the guest answers. */
export type AdminRsvpSummary = {
  status: RsvpStatus;
  updatedAt: string;
  /** `guestId` of whoever submitted, or `null` while nobody has answered. */
  submittedBy: string | null;
  attending: number;
  /** Attending guests that did not confirm ≤6 — the seats that get charged. `paidAttendingGuestCount`. */
  paid: number;
  /** Attending guests who confirmed they are ≤6. `childSixOrYoungerAttendingCount`. */
  childrenSixOrYounger: number;
};

/** Mirrors `HouseholdInvitation` plus the operational WhatsApp state admins act on. */
export type AdminInvitation = {
  invitationCode: string;
  householdName: string;
  phoneNumber: string;
  phoneNumberSource: WhatsappPhoneSource;
  phoneNumberUpdatedAt: string;
  whatsappFlowStatus: WhatsappFlowStatus;
  whatsappFlowStage: WhatsappFlowStage;
  whatsappFlowUpdatedAt: string;
  whatsappFlowCompletedAt: string | null;
  whatsappFallbackSentAt: string | null;
  whatsappLastInboundMessageId: string | null;
  whatsappLastOutboundMessageId: string | null;
  reconciliationStatus: WhatsappReconciliationStatus;
  rsvp: AdminRsvpSummary;
  /** Ordered; index 0 is the primary guest who answers for the invitation. */
  guests: AdminGuest[];
  /** Newest first. */
  commands: AdminWhatsappCommand[];
};

export type AdminWhatsappMessage = {
  direction: "inbound" | "outbound";
  sentAt: string;
  text: string;
  /** Set when the message was delivered from a template rather than typed by an operator. */
  templateId?: WhatsappRsvpTemplatePurpose;
  failed?: boolean;
};

/** A guest message plus the moderation flag that only the panel sees. */
export type AdminGuestMessage = GuestMessage & { hidden: boolean };

/** Mirrors `Gift` plus the catalog controls that live behind the admin panel. */
export type AdminGift = Gift & {
  paused: boolean;
  /** Optimistic-concurrency version of the catalog row. */
  version: number;
  /** Object URL for a freshly picked image, before any upload exists. */
  photoUrl: string | null;
};

/** Everything one dashboard load needs. */
export type AdminDashboardSnapshot = {
  invitations: AdminInvitation[];
  guestMessages: AdminGuestMessage[];
  gifts: AdminGift[];
  /** WhatsApp conversation history keyed by invitation code, oldest message first. */
  threads: Record<string, AdminWhatsappMessage[]>;
};

/** A guest flattened onto its invitation — one row of the Convidados table. */
export type AdminGuestRow = AdminGuest & {
  invitationCode: string;
  householdName: string;
  phoneNumber: string;
  /** 1-based position on the invitation; 1 is the primary guest. */
  sortOrder: number;
  invitation: AdminInvitation;
};
