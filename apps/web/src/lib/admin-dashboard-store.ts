import type { RsvpStatus, WhatsappRsvpSendResponse } from "@brimax/contracts";
import {
  deriveGift,
  recalculateRsvp,
  trailingInboundCount
} from "@/lib/admin-dashboard-model";
import type {
  AdminDashboardSnapshot,
  AdminGift,
  AdminGuest,
  AdminInvitation,
  AdminWhatsappFlowSnapshot,
  AdminWhatsappMessage,
  AdminWhatsappThreadLoadState,
  AdminWhatsappThreadPage
} from "@/lib/admin-dashboard-types";

/**
 * Every mutation the panel performs, as one pure reducer.
 *
 * While the dashboard runs on fixtures these writes are local only. Once the admin
 * write endpoints exist, each case keeps its optimistic update and gains a request
 * behind it — the reducer stays the description of what the action means.
 */

export type AdminDashboardState = AdminDashboardSnapshot & {
  threadLoads: Record<string, AdminWhatsappThreadLoadState>;
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
  | { type: "whatsapp-send-accepted"; response: WhatsappRsvpSendResponse; now: string }
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
  | { type: "send-chat"; invitationCode: string; messageId: string; text: string; now: string }
  | { type: "chat-send-succeeded"; invitationCode: string; messageId: string }
  | { type: "chat-send-failed"; invitationCode: string; messageId: string }
  | { type: "thread-load-started"; invitationCode: string; loadMore: boolean }
  | { type: "thread-load-succeeded"; page: AdminWhatsappThreadPage; loadMore: boolean }
  | { type: "thread-load-failed"; invitationCode: string; loadMore: boolean }
  | { type: "thread-error-cleared"; invitationCode: string }
  | { type: "whatsapp-invitation-refreshed"; invitationCode: string; flow: AdminWhatsappFlowSnapshot }
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

/** Whether the newest page of a conversation is in `state.threads`. */
function hasNewestPage(load: AdminWhatsappThreadLoadState | undefined) {
  if (!load) return false;
  if (load.status === "loaded") return true;
  return (load.status === "loading" || load.status === "error") && load.hasLoaded;
}

/**
 * Trailing inbound messages that still await an outbound reply.
 *
 * The precedence is deliberate and exhaustive, so no two sources of the number can ever be on
 * screen at once:
 *
 * 1. Newest page loaded → the trailing inbound run over the loaded thread. A partially loaded
 *    conversation counts here too: only older pages are ever appended, so the first page always
 *    holds the newest end where the unread run lives.
 * 2. Otherwise → the dashboard summary's `unreadCount`, which the backend derives with the same
 *    trailing-inbound rule.
 *
 * `null` now means only "no summary and not loaded". For a conversation listed in the WhatsApp
 * tab that is unreachable — the tab lists exactly the invitations that have a summary. It still
 * occurs for the invitations that have never exchanged a message, which the Overview card reads
 * over the whole invitation list.
 */
export function unreadCount(state: AdminDashboardState, invitationCode: string): number | null {
  if (hasNewestPage(state.threadLoads[invitationCode])) {
    return trailingInboundCount(state.threads[invitationCode] ?? []);
  }
  const summary = state.invitations.find(
    (invitation) => invitation.invitationCode === invitationCode
  )?.whatsappConversation;
  return summary ? summary.unreadCount : null;
}

export function createInitialState(snapshot: AdminDashboardSnapshot): AdminDashboardState {
  const threadLoads = Object.fromEntries(
    snapshot.invitations.map((invitation) => [
      invitation.invitationCode,
      snapshot.threads[invitation.invitationCode]
        ? { status: "loaded" as const, nextCursor: null }
        : { status: "unloaded" as const }
    ])
  );
  return { ...snapshot, threadLoads };
}

/** Optimistic composer bubbles carry a client id; persisted ones carry the provider's `wamid`. */
export function isLocalMessageId(messageId: string) {
  return messageId.startsWith("local-");
}

function deduplicateMessages(messages: AdminWhatsappMessage[]) {
  const seen = new Set<string>();
  return messages.filter((message) => !seen.has(message.messageId) && !!seen.add(message.messageId));
}

function mergeCommands(
  current: AdminInvitation["commands"],
  incoming: AdminInvitation["commands"]
) {
  const byId = new Map(current.map((command) => [command.commandId, command]));
  for (const command of incoming) byId.set(command.commandId, command);
  return [...byId.values()].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || left.commandId.localeCompare(right.commandId)
  );
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
      const threadLoads = { ...state.threadLoads };
      delete threadLoads[action.invitationCode];
      return { ...state, invitations, threads, threadLoads };
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
        whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
        // A brand-new invitation has never received a reply, so free text is not yet deliverable.
        whatsappFreeTextWindow: { open: false },
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
        commands: [],
        // Nothing has been sent yet, so the invitation owns no message and stays out of the
        // WhatsApp tab until a real conversation exists.
        whatsappConversation: null
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

    case "whatsapp-send-accepted": {
      return mapInvitation(state, action.response.invitationCode, (invitation) => {
        if (invitation.commands.some((command) => command.commandId === action.response.commandId)) {
          return invitation;
        }
        const stage = action.response.templateId.includes("reconfirmation") ? "reconfirmation" : "pending";
        return {
          ...invitation,
          commands: [{
            commandId: action.response.commandId,
            createdAt: action.now,
            templateId: action.response.templateId,
            stage,
            status: action.response.status,
            retryCount: 0,
            reconciliationStatus: "none",
            replayed: action.response.replayed
          }, ...invitation.commands]
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
      // The caller owns the id so it can settle this exact bubble once the request resolves.
      // Two sends in the same millisecond would otherwise collide and lose one to deduplication.
      const message: AdminWhatsappMessage = {
        messageId: action.messageId,
        direction: "outbound",
        sentAt: action.now,
        text,
        pending: true
      };
      return {
        ...state,
        threads: {
          ...state.threads,
          [action.invitationCode]: [...(state.threads[action.invitationCode] ?? []), message]
        }
      };
    }

    case "chat-send-succeeded":
    case "chat-send-failed": {
      const existing = state.threads[action.invitationCode];
      if (!existing) return state;
      const failed = action.type === "chat-send-failed";
      let changed = false;
      const messages = existing.map((message) => {
        if (message.messageId !== action.messageId) return message;
        changed = true;
        return { ...message, pending: false, ...(failed ? { failed: true } : {}) };
      });
      if (!changed) return state;
      return { ...state, threads: { ...state.threads, [action.invitationCode]: messages } };
    }

    case "thread-load-started": {
      const current = state.threadLoads[action.invitationCode];
      const hasLoaded = action.loadMore || current?.status === "loaded" || current?.status === "error" && current.hasLoaded;
      const nextCursor = current && "nextCursor" in current ? current.nextCursor : null;
      return {
        ...state,
        threadLoads: {
          ...state.threadLoads,
          [action.invitationCode]: { status: "loading", hasLoaded, nextCursor }
        }
      };
    }

    case "thread-load-succeeded": {
      const { invitationCode } = action.page;
      const existing = state.threads[invitationCode] ?? [];
      // API pages predate any local composer message created while the request was in flight,
      // but a settled optimistic bubble is now also present in the page under its provider id.
      // Drop those; keep failed ones, which never reached the server and are the only record
      // the operator has of what did not send.
      const newestServerSentAt = action.page.messages.at(-1)?.sentAt;
      const retained = newestServerSentAt === undefined
        ? existing
        : existing.filter((message) =>
          message.failed ||
            message.pending ||
            !isLocalMessageId(message.messageId) ||
            message.sentAt > newestServerSentAt);
      const messages = deduplicateMessages([...action.page.messages, ...retained]);
      return mapInvitation(
        {
          ...state,
          threads: { ...state.threads, [invitationCode]: messages },
          threadLoads: {
            ...state.threadLoads,
            [invitationCode]: { status: "loaded", nextCursor: action.page.nextCursor }
          }
        },
        invitationCode,
        (invitation) => ({
          ...invitation,
          commands: mergeCommands(invitation.commands, action.page.commands)
        })
      );
    }

    case "thread-load-failed": {
      const current = state.threadLoads[action.invitationCode];
      const nextCursor = current && "nextCursor" in current ? current.nextCursor : null;
      return {
        ...state,
        threadLoads: {
          ...state.threadLoads,
          [action.invitationCode]: {
            status: "error",
            hasLoaded: action.loadMore || !!(current && "hasLoaded" in current && current.hasLoaded),
            nextCursor
          }
        }
      };
    }

    /**
     * Retires a failed *load-more* without touching the messages it already holds.
     *
     * A pagination failure belongs to that one attempt, not to the conversation: the newest page
     * is still loaded and still correct. Reopening the conversation therefore drops the alert and
     * puts the load-older control back, with no request behind it — the cursor is retained, so the
     * operator can try the same older page again whenever they want. A failed *first* load has no
     * page to fall back on and is left alone, so reopening still retries it.
     */
    case "thread-error-cleared": {
      const current = state.threadLoads[action.invitationCode];
      if (!current || current.status !== "error" || !current.hasLoaded) return state;
      return {
        ...state,
        threadLoads: {
          ...state.threadLoads,
          [action.invitationCode]: { status: "loaded", nextCursor: current.nextCursor }
        }
      };
    }

    /**
     * Replaces flow fields for one invitation when refreshed from the backend.
     *
     * Precedence rule for local mutations vs server refresh:
     * - Phone fields (phoneNumber, phoneNumberSource, phoneNumberUpdatedAt): If the local invitation
     *   has a local update (phoneNumberUpdatedAt is non-null) that is newer than flow.phoneNumberUpdatedAt
     *   (!flow.phoneNumberUpdatedAt || invitation.phoneNumberUpdatedAt > flow.phoneNumberUpdatedAt),
     *   the local operator edit takes precedence and is retained.
     * - Flow fields (status, stage, timestamps, failureReason, reconciliationStatus): If the local
     *   invitation has a local mutation (whatsappFlowUpdatedAt is non-null) that is newer than
     *   flow.whatsappFlowUpdatedAt (!flow.whatsappFlowUpdatedAt || invitation.whatsappFlowUpdatedAt > flow.whatsappFlowUpdatedAt),
     *   the optimistic local mutation (e.g. queue-send or local confirm) is retained so in-flight refreshes
     *   cannot silently revert an operator's local action.
     * - In all other cases (initial load, server timestamp >= local timestamp, or no local update), the
     *   refreshed server flow snapshot replaces the local flow attributes.
     * - Non-flow fields (householdName, rsvp, guests, commands, whatsappConversation) and other invitations
     *   are completely untouched, and list order is preserved via mapInvitation.
     */
    case "whatsapp-invitation-refreshed": {
      return mapInvitation(state, action.invitationCode, (invitation) => {
        const keepLocalPhone = Boolean(
          invitation.phoneNumberUpdatedAt &&
            action.flow.phoneNumberUpdatedAt &&
            invitation.phoneNumberUpdatedAt > action.flow.phoneNumberUpdatedAt
        );

        const keepLocalFlow = Boolean(
          invitation.whatsappFlowUpdatedAt &&
            action.flow.whatsappFlowUpdatedAt &&
            invitation.whatsappFlowUpdatedAt > action.flow.whatsappFlowUpdatedAt
        );

        return {
          ...invitation,
          phoneNumber: keepLocalPhone ? invitation.phoneNumber : action.flow.phoneNumber,
          phoneNumberSource: keepLocalPhone
            ? invitation.phoneNumberSource
            : action.flow.phoneNumberSource,
          phoneNumberUpdatedAt: keepLocalPhone
            ? invitation.phoneNumberUpdatedAt
            : action.flow.phoneNumberUpdatedAt,
          whatsappFlowStatus: keepLocalFlow
            ? invitation.whatsappFlowStatus
            : action.flow.whatsappFlowStatus,
          whatsappFlowStage: keepLocalFlow
            ? invitation.whatsappFlowStage
            : action.flow.whatsappFlowStage,
          whatsappFlowUpdatedAt: keepLocalFlow
            ? invitation.whatsappFlowUpdatedAt
            : action.flow.whatsappFlowUpdatedAt,
          whatsappFlowCompletedAt: keepLocalFlow
            ? invitation.whatsappFlowCompletedAt
            : action.flow.whatsappFlowCompletedAt,
          whatsappFallbackSentAt: keepLocalFlow
            ? invitation.whatsappFallbackSentAt
            : action.flow.whatsappFallbackSentAt,
          whatsappLastInboundMessageId: keepLocalFlow
            ? invitation.whatsappLastInboundMessageId
            : action.flow.whatsappLastInboundMessageId,
          whatsappLastOutboundMessageId: keepLocalFlow
            ? invitation.whatsappLastOutboundMessageId
            : action.flow.whatsappLastOutboundMessageId,
          whatsappFailureReason: keepLocalFlow
            ? invitation.whatsappFailureReason
            : action.flow.whatsappFailureReason,
          whatsappSendAvailability: action.flow.whatsappSendAvailability,
          // Time-derived and server-authoritative; a local snapshot of it is always the stale one.
          whatsappFreeTextWindow: action.flow.whatsappFreeTextWindow,
          reconciliationStatus: keepLocalFlow
            ? invitation.reconciliationStatus
            : action.flow.reconciliationStatus
        };
      });
    }

    case "replace-snapshot":
      return createInitialState(action.snapshot);

    default:
      return state;
  }
}
