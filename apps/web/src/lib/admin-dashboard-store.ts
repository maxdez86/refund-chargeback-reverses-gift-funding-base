import type { RsvpStatus } from "@brimax/contracts";
import { deriveGift, recalculateRsvp, templateForSend } from "@/lib/admin-dashboard-model";
import type {
  AdminDashboardSnapshot,
  AdminGift,
  AdminGuest,
  AdminInvitation,
  AdminWhatsappMessage
} from "@/lib/admin-dashboard-types";

/**
 * Every mutation the panel performs, as one pure reducer.
 *
 * While the dashboard runs on fixtures these writes are local only. Once the admin
 * write endpoints exist, each case keeps its optimistic update and gains a request
 * behind it — the reducer stays the description of what the action means.
 */

export type AdminDashboardState = AdminDashboardSnapshot & {
  /** Invitation codes whose WhatsApp thread the operator has opened since load. */
  readChats: string[];
};

export type AdminDashboardAction =
  | { type: "confirm-guests"; invitationCode: string; guestIds: string[]; now: string }
  | { type: "set-guest-status"; guestId: string; status: RsvpStatus; now: string }
  | { type: "set-guest-child"; guestId: string; isChild: boolean; now: string }
  | { type: "remove-guest"; guestId: string; now: string }
  | { type: "delete-invitation"; invitationCode: string }
  | {
      type: "create-invitation";
      invitationCode: string;
      householdName: string;
      phoneNumber: string;
      guests: { name: string; isChild: boolean }[];
      now: string;
    }
  | {
      type: "add-guests";
      invitationCode: string;
      rows: { name: string; isChild: boolean }[];
      now: string;
    }
  | { type: "update-phone"; invitationCode: string; phoneNumber: string; now: string }
  | { type: "queue-send"; invitationCode: string; mode: "first" | "resend"; now: string }
  | { type: "toggle-message-hidden"; messageId: string }
  | {
      type: "save-gift";
      giftId: string;
      name: string;
      totalValueCents: number;
      fractional: boolean;
      paused: boolean;
      photoUrl: string | null;
      now: string;
    }
  | {
      type: "create-gift";
      name: string;
      totalValueCents: number;
      fractional: boolean;
      photoUrl: string | null;
      now: string;
    }
  | { type: "send-chat"; invitationCode: string; text: string; now: string }
  | { type: "open-chat"; invitationCode: string }
  | { type: "replace-snapshot"; snapshot: AdminDashboardSnapshot };

/**
 * The same actions with `now` supplied by the caller of `useAdminDashboard` instead of
 * every call site. Distributes over the union so each member keeps its own fields.
 */
export type AdminDashboardIntent =
  AdminDashboardAction extends infer Action
    ? Action extends { now: string }
      ? Omit<Action, "now"> & { now?: string }
      : Action
    : never;

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Replaces one invitation, leaving list order untouched. */
function mapInvitation(
  state: AdminDashboardState,
  invitationCode: string,
  update: (invitation: AdminInvitation) => AdminInvitation
): AdminDashboardState {
  let changed = false;
  const invitations = state.invitations.map((invitation) => {
    if (invitation.invitationCode !== invitationCode) return invitation;
    changed = true;
    return update(invitation);
  });
  return changed ? { ...state, invitations } : state;
}

function invitationOfGuest(state: AdminDashboardState, guestId: string) {
  return state.invitations.find((invitation) =>
    invitation.guests.some((guest) => guest.guestId === guestId)
  );
}

/** Slugifies a gift name into the id shape the catalog uses ("Jogo de jantar" -> "g-jogo-de-jantar"). */
export function giftIdFromName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `g-${slug}`;
}

/** Trailing inbound messages on a thread the operator has not opened yet. */
export function unreadCount(state: AdminDashboardState, invitationCode: string) {
  if (state.readChats.includes(invitationCode)) return 0;
  const thread = state.threads[invitationCode] ?? [];
  let count = 0;
  for (let index = thread.length - 1; index >= 0; index -= 1) {
    if (thread[index].direction === "outbound") break;
    count += 1;
  }
  return count;
}

export function createInitialState(snapshot: AdminDashboardSnapshot): AdminDashboardState {
  return { ...snapshot, readChats: [] };
}

export function adminDashboardReducer(
  state: AdminDashboardState,
  action: AdminDashboardAction
): AdminDashboardState {
  switch (action.type) {
    case "confirm-guests": {
      if (action.guestIds.length === 0) return state;
      return mapInvitation(state, action.invitationCode, (invitation) => {
        const guests = invitation.guests.map((guest) =>
          action.guestIds.includes(guest.guestId)
            ? { ...guest, rsvpStatus: "attending" as const }
            : guest
        );
        return {
          ...invitation,
          guests,
          rsvp: {
            ...recalculateRsvp(guests, invitation.rsvp, action.now),
            submittedBy: invitation.rsvp.submittedBy ?? guests[0]?.guestId ?? null
          },
          whatsappFlowStatus: "attendance_confirmed_whatsapp",
          whatsappFlowUpdatedAt: action.now
        };
      });
    }

    case "set-guest-status": {
      const invitation = invitationOfGuest(state, action.guestId);
      if (!invitation) return state;
      return mapInvitation(state, invitation.invitationCode, (current) => {
        const guests = current.guests.map((guest) =>
          guest.guestId === action.guestId ? { ...guest, rsvpStatus: action.status } : guest
        );
        return {
          ...current,
          guests,
          rsvp: recalculateRsvp(guests, current.rsvp, action.now),
          whatsappFlowUpdatedAt: action.now
        };
      });
    }

    case "set-guest-child": {
      const invitation = invitationOfGuest(state, action.guestId);
      if (!invitation) return state;
      return mapInvitation(state, invitation.invitationCode, (current) => {
        const guests = current.guests.map((guest) =>
          guest.guestId === action.guestId
            ? {
                ...guest,
                isChild: action.isChild,
                // Clearing the seed retires the age question, so any ≤6 answer it produced
                // goes with it — otherwise a phantom courtesy would outlive the flag. Setting
                // it leaves an existing answer alone; only the guest can give a new one.
                isChildSixOrYounger: action.isChild ? guest.isChildSixOrYounger : undefined
              }
            : guest
        );
        return {
          ...current,
          guests,
          rsvp: recalculateRsvp(guests, current.rsvp, action.now)
        };
      });
    }

    case "remove-guest": {
      const invitation = invitationOfGuest(state, action.guestId);
      // The primary guest answers for the invitation, so removing them means deleting
      // the whole invitation — the UI routes that to the delete confirmation instead.
      if (!invitation || invitation.guests[0]?.guestId === action.guestId) return state;
      return mapInvitation(state, invitation.invitationCode, (current) => {
        const guests = current.guests.filter((guest) => guest.guestId !== action.guestId);
        return {
          ...current,
          guests,
          rsvp: recalculateRsvp(guests, current.rsvp, action.now),
          whatsappFlowUpdatedAt: action.now
        };
      });
    }

    case "delete-invitation": {
      const invitations = state.invitations.filter(
        (invitation) => invitation.invitationCode !== action.invitationCode
      );
      if (invitations.length === state.invitations.length) return state;
      const threads = { ...state.threads };
      delete threads[action.invitationCode];
      return { ...state, invitations, threads };
    }

    case "create-invitation": {
      const invitationCode = action.invitationCode.trim().toUpperCase();
      const guests: AdminGuest[] = action.guests.map((row, index) => ({
        guestId: `${invitationCode}--guest-${pad2(index + 1)}`,
        guestName: row.name.trim(),
        // `isChildSixOrYounger` is left unset on purpose: nobody has answered the RSVP yet,
        // and the ≤6 answer that grants the courtesy is the guest's to give.
        isChild: row.isChild,
        allowedPlusOnes: 0,
        rsvpStatus: "pending"
      }));
      const invitation: AdminInvitation = {
        invitationCode,
        householdName: action.householdName.trim(),
        phoneNumber: action.phoneNumber.replace(/\D/g, ""),
        phoneNumberSource: "operator",
        phoneNumberUpdatedAt: action.now,
        whatsappFlowStatus: "idle",
        whatsappFlowStage: "pending",
        whatsappFlowUpdatedAt: action.now,
        whatsappFlowCompletedAt: null,
        whatsappFallbackSentAt: null,
        whatsappLastInboundMessageId: null,
        whatsappLastOutboundMessageId: null,
        reconciliationStatus: "none",
        rsvp: {
          status: "pending",
          updatedAt: action.now,
          submittedBy: null,
          attending: 0,
          paid: 0,
          childrenSixOrYounger: 0
        },
        guests,
        commands: []
      };
      return { ...state, invitations: [invitation, ...state.invitations] };
    }

    case "add-guests": {
      if (action.rows.length === 0) return state;
      return mapInvitation(state, action.invitationCode, (invitation) => {
        const base = invitation.guests.length;
        const added: AdminGuest[] = action.rows.map((row, index) => ({
          guestId: `${invitation.invitationCode}--guest-${pad2(base + index + 1)}`,
          guestName: row.name.trim(),
          // As in "create-invitation": a new guest carries the criança seed and no age answer.
          isChild: row.isChild,
          allowedPlusOnes: 0,
          rsvpStatus: "pending"
        }));
        const guests = [...invitation.guests, ...added];
        return {
          // Recalculated rather than left alone: a new pending guest can move a fully
          // declined invitation back to pending, and the roll-up has to reflect that.
          ...invitation,
          guests,
          rsvp: recalculateRsvp(guests, invitation.rsvp, action.now)
        };
      });
    }

    case "update-phone": {
      const digits = action.phoneNumber.replace(/\D/g, "");
      if (!digits) return state;
      return mapInvitation(state, action.invitationCode, (invitation) => ({
        ...invitation,
        phoneNumber: digits,
        phoneNumberSource: "operator",
        phoneNumberUpdatedAt: action.now
      }));
    }

    case "queue-send": {
      return mapInvitation(state, action.invitationCode, (invitation) => {
        const templateId = templateForSend(invitation, action.mode);
        const previousAttempts = invitation.commands.filter(
          (command) => command.templateId === templateId
        ).length;
        return {
          ...invitation,
          whatsappFlowStatus: "send_queued",
          whatsappFlowUpdatedAt: action.now,
          commands: [
            {
              commandId: `cmd-${invitation.invitationCode}-${action.now}`,
              createdAt: action.now,
              templateId,
              stage: action.mode === "first" ? "pending" : invitation.whatsappFlowStage,
              status: "queued",
              retryCount: action.mode === "first" ? 0 : previousAttempts,
              reconciliationStatus: "none"
            },
            ...invitation.commands
          ]
        };
      });
    }

    case "toggle-message-hidden": {
      return {
        ...state,
        guestMessages: state.guestMessages.map((message) =>
          message.messageId === action.messageId
            ? { ...message, hidden: !message.hidden }
            : message
        )
      };
    }

    case "save-gift": {
      return {
        ...state,
        gifts: state.gifts.map((gift) =>
          gift.id !== action.giftId
            ? gift
            : deriveGift({
                ...gift,
                name: action.name.trim() || gift.name,
                totalValueCents: action.totalValueCents,
                fractional: action.fractional,
                paused: action.paused,
                photoUrl: action.photoUrl,
                updatedAt: action.now,
                version: gift.version + 1
              })
        )
      };
    }

    case "create-gift": {
      const gift: AdminGift = deriveGift({
        id: giftIdFromName(action.name),
        name: action.name.trim(),
        image: "upload",
        fractional: action.fractional,
        totalValueCents: action.totalValueCents,
        partsFunded: 0,
        partsReserved: 0,
        paused: false,
        photoUrl: action.photoUrl,
        updatedAt: action.now,
        version: 1
      });
      return { ...state, gifts: [gift, ...state.gifts] };
    }

    case "send-chat": {
      const text = action.text.trim();
      if (!text) return state;
      const message: AdminWhatsappMessage = {
        direction: "outbound",
        sentAt: action.now,
        text
      };
      return {
        ...state,
        threads: {
          ...state.threads,
          [action.invitationCode]: [...(state.threads[action.invitationCode] ?? []), message]
        },
        readChats: state.readChats.includes(action.invitationCode)
          ? state.readChats
          : [...state.readChats, action.invitationCode]
      };
    }

    case "open-chat": {
      if (state.readChats.includes(action.invitationCode)) return state;
      return { ...state, readChats: [...state.readChats, action.invitationCode] };
    }

    case "replace-snapshot":
      return createInitialState(action.snapshot);

    default:
      return state;
  }
}
