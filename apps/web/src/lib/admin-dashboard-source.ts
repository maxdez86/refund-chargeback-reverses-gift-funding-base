import type { AdminDashboardResponse, WhatsappOperatorTextSendResponse, WhatsappRsvpSendMode, WhatsappRsvpSendResponse, WhatsappRsvpStatusResponse } from "@brimax/contracts";
import {
  AdminApiError,
  getAdminDashboard,
  getAdminWhatsappThread,
  sendAdminWhatsappRsvp,
  sendAdminWhatsappText,
  type AdminTokenAccessor
} from "@/lib/admin-api";
import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import { deriveReconciliationStatus, messageFallback } from "@/lib/admin-dashboard-model";
import type {
  AdminDashboardSnapshot,
  AdminWhatsappFlowSnapshot,
  AdminWhatsappInvitationPage,
  AdminWhatsappThreadPage
} from "@/lib/admin-dashboard-types";

/**
 * The one seam between the dashboard UI and its data.
 *
 * Both fixture and live data map onto the same local reducer state. Mutations remain
 * browser-local demonstrations; this source owns the initial snapshot and lazy history reads.
 */
export type AdminDashboardSource = {
  /** Whether the data is demonstration-only; drives the banner that says so. */
  readonly demo: boolean;
  load(signal?: AbortSignal): Promise<AdminDashboardSnapshot>;
  loadWhatsappInvitation(
    invitationCode: string,
    cursor?: string,
    signal?: AbortSignal
  ): Promise<AdminWhatsappInvitationPage>;
  sendWhatsappRsvp?(
    invitationCode: string,
    mode: WhatsappRsvpSendMode,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<WhatsappRsvpSendResponse>;
  sendWhatsappText?(
    invitationCode: string,
    body: string,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<WhatsappOperatorTextSendResponse>;
};

export const fixtureDashboardSource: AdminDashboardSource = {
  demo: true,
  async load() {
    const snapshot = createFixtureDashboardSnapshot();
    return {
      ...snapshot,
      threads: {}
    };
  },
  async loadWhatsappInvitation(invitationCode) {
    const snapshot = createFixtureDashboardSnapshot();
    const invitation = snapshot.invitations.find((item) => item.invitationCode === invitationCode);
    const flow: AdminWhatsappFlowSnapshot = {
      phoneNumber: invitation?.phoneNumber ?? "",
      phoneNumberSource: invitation?.phoneNumberSource ?? "import",
      phoneNumberUpdatedAt: invitation?.phoneNumberUpdatedAt ?? null,
      whatsappFlowStatus: invitation?.whatsappFlowStatus ?? "idle",
      whatsappFlowStage: invitation?.whatsappFlowStage ?? "pending",
      whatsappFlowUpdatedAt: invitation?.whatsappFlowUpdatedAt ?? null,
      whatsappFlowCompletedAt: invitation?.whatsappFlowCompletedAt ?? null,
      whatsappFallbackSentAt: invitation?.whatsappFallbackSentAt ?? null,
      whatsappLastInboundMessageId: invitation?.whatsappLastInboundMessageId ?? null,
      whatsappLastOutboundMessageId: invitation?.whatsappLastOutboundMessageId ?? null,
      whatsappFailureReason: invitation?.whatsappFailureReason ?? null,
      whatsappSendAvailability: invitation?.whatsappSendAvailability ?? {
        firstAllowed: true,
        resendAllowed: false
      },
      whatsappFreeTextWindow: invitation?.whatsappFreeTextWindow ?? { open: false },
      reconciliationStatus: invitation?.reconciliationStatus ?? "none"
    };
    return {
      flow,
      page: {
        invitationCode,
        messages: snapshot.threads[invitationCode] ?? [],
        commands:
          snapshot.invitations.find((item) => item.invitationCode === invitationCode)?.commands ?? [],
        nextCursor: null
      }
    };
  },
  async sendWhatsappRsvp(invitationCode, mode, idempotencyKey) {
    const snapshot = createFixtureDashboardSnapshot();
    const invitation = snapshot.invitations.find((item) => item.invitationCode === invitationCode);
    if (!invitation) throw new AdminApiError("Este convite não está mais disponível.", "rejected", 404, "INVITATION_NOT_FOUND");
    const confirmed = invitation.guests.some((guest) => guest.rsvpStatus === "attending");
    const single = invitation.guests.length === 1;
    const templateId = confirmed
      ? single ? "wedding_rsvp_reconfirmation_single" : "wedding_rsvp_reconfirmation"
      : single ? "wedding_rsvp_pending_reminder_single" : "wedding_rsvp_pending_reminder_group";
    return {
      commandId: `idempotency-${idempotencyKey}`,
      invitationCode,
      templateId,
      templateVersion: 1,
      status: "queued",
      replayed: false
    };
  },
  async sendWhatsappText(invitationCode, _body, idempotencyKey) {
    const snapshot = createFixtureDashboardSnapshot();
    const invitation = snapshot.invitations.find((item) => item.invitationCode === invitationCode);
    if (!invitation) throw new AdminApiError("Este convite não está mais disponível.", "rejected", 404, "INVITATION_NOT_FOUND");
    if (!invitation.whatsappFreeTextWindow.open) {
      throw new AdminApiError(
        "A janela de 24 horas do WhatsApp expirou. Envie um modelo aprovado.",
        "rejected",
        409,
        "FREE_TEXT_WINDOW_CLOSED"
      );
    }
    return {
      commandId: `idempotency-${idempotencyKey}`,
      invitationCode,
      status: "queued",
      replayed: false
    };
  }
};

/** Maps one newest-first API page without changing the accumulated thread order. */
export function mapAdminWhatsappThreadPage(
  invitationCode: string,
  response: WhatsappRsvpStatusResponse
): AdminWhatsappThreadPage {
  const history = response.history ?? [];
  const messages = history
    .filter((entry) => entry.kind === "message" && entry.direction)
    .map((entry) => ({
      messageId: entry.id,
      direction: entry.direction!,
      sentAt: entry.createdAt,
      text: entry.body ?? messageFallback(entry),
      buttonId: entry.buttonId,
      buttonAction: entry.buttonAction,
      templateId: entry.templateId,
      failed: entry.status === "failed"
    }))
    .reverse();
  const commands = history
    .filter((entry) => entry.kind === "command" && entry.commandId && entry.templateId)
    .map((entry) => ({
      commandId: entry.commandId!,
      createdAt: entry.createdAt,
      templateId: entry.templateId!,
      stage: entry.stage ?? "pending",
      status: entry.status as AdminWhatsappThreadPage["commands"][number]["status"],
      retryCount: entry.retryCount ?? 0,
      reconciliationStatus: entry.reconciliationStatus ?? "none"
    }));
  return { invitationCode, messages, commands, nextCursor: response.nextCursor ?? null };
}

/** Maps the top-level WhatsApp flow envelope from a status response into a view-model snapshot. */
export function mapAdminWhatsappFlowSnapshot(
  response: WhatsappRsvpStatusResponse
): AdminWhatsappFlowSnapshot {
  return {
    phoneNumber: response.phoneNumber ?? "",
    phoneNumberSource: response.phoneNumberSource ?? "import",
    phoneNumberUpdatedAt: response.phoneNumberUpdatedAt ?? null,
    whatsappFlowStatus: response.status ?? "idle",
    whatsappFlowStage: response.stage ?? "pending",
    whatsappFlowUpdatedAt: response.updatedAt ?? null,
    whatsappFlowCompletedAt: response.completedAt ?? null,
    whatsappFallbackSentAt: response.fallbackSentAt ?? null,
    whatsappLastInboundMessageId: response.lastInboundMessageId ?? null,
    whatsappLastOutboundMessageId: response.lastOutboundMessageId ?? null,
    whatsappFailureReason: response.failureReason ?? null,
    whatsappSendAvailability: response.sendAvailability,
    whatsappFreeTextWindow: response.freeTextWindow,
    reconciliationStatus: deriveReconciliationStatus(response.status)
  };
}

export function mapAdminDashboardResponse(
  response: AdminDashboardResponse
): AdminDashboardSnapshot {
  return {
    invitations: response.invitations.map((invitation) => ({
      invitationCode: invitation.invitationCode,
      householdName: invitation.householdName,
      phoneNumber: invitation.phoneNumber ?? "",
      phoneNumberSource: invitation.phoneNumberSource ?? "import",
      phoneNumberUpdatedAt: invitation.phoneNumberUpdatedAt ?? null,
      whatsappFlowStatus: invitation.whatsappFlowStatus ?? "idle",
      whatsappFlowStage: invitation.whatsappFlowStage ?? "pending",
      whatsappFlowUpdatedAt: invitation.whatsappFlowUpdatedAt ?? null,
      whatsappFlowCompletedAt: invitation.whatsappFlowCompletedAt ?? null,
      whatsappFallbackSentAt: invitation.whatsappFallbackSentAt ?? null,
      whatsappLastInboundMessageId: invitation.whatsappLastInboundMessageId ?? null,
      whatsappLastOutboundMessageId: invitation.whatsappLastOutboundMessageId ?? null,
      whatsappFailureReason: invitation.whatsappFailureReason ?? null,
      whatsappSendAvailability: invitation.whatsappSendAvailability,
      whatsappFreeTextWindow: invitation.whatsappFreeTextWindow,
      reconciliationStatus: deriveReconciliationStatus(invitation.whatsappFlowStatus),
      rsvp: { ...invitation.rsvp },
      // Absent means "this invitation owns no WhatsApp message", which is what removes it from
      // the WhatsApp tab. The API never sends a zero-valued summary, so `null` is unambiguous.
      whatsappConversation: invitation.whatsappConversation
        ? { ...invitation.whatsappConversation }
        : null,
      guests: invitation.guests.map((guest) => ({
        ...guest,
        isChild: guest.isChild ?? false
      })),
      commands: []
    })),
    gifts: response.gifts.map((gift) => ({
      ...gift,
      paused: false,
      photoUrl: null,
      version: 0
    })),
    guestMessages: response.guestMessages.map((message) => ({
      ...message,
      hidden: false
    })),
    threads: {}
  };
}

type LiveSourceOptions = {
  getToken: AdminTokenAccessor;
  onAuthError?: (error: AdminApiError) => void;
  apiUrl?: string;
  fetcher?: typeof fetch;
};

export function createLiveDashboardSource(options: LiveSourceOptions): AdminDashboardSource {
  return {
    demo: false,
    async load(signal) {
      try {
        const response = await getAdminDashboard(options.getToken, {
          apiUrl: options.apiUrl,
          fetcher: options.fetcher,
          signal
        });
        return mapAdminDashboardResponse(response);
      } catch (error) {
        if (
          error instanceof AdminApiError &&
          (error.kind === "unauthorized" || error.kind === "forbidden")
        ) {
          options.onAuthError?.(error);
        }
        throw error;
      }
    },
    async loadWhatsappInvitation(invitationCode, cursor, signal) {
      try {
        const response = await getAdminWhatsappThread(invitationCode, options.getToken, cursor, {
          apiUrl: options.apiUrl,
          fetcher: options.fetcher,
          signal
        });
        return {
          flow: mapAdminWhatsappFlowSnapshot(response),
          page: mapAdminWhatsappThreadPage(invitationCode, response)
        };
      } catch (error) {
        if (error instanceof AdminApiError && (error.kind === "unauthorized" || error.kind === "forbidden")) {
          options.onAuthError?.(error);
        }
        throw error;
      }
    },
    async sendWhatsappText(invitationCode, body, idempotencyKey, signal) {
      try {
        return await sendAdminWhatsappText(invitationCode, body, idempotencyKey, options.getToken, {
          apiUrl: options.apiUrl,
          fetcher: options.fetcher,
          signal
        });
      } catch (error) {
        if (error instanceof AdminApiError && (error.kind === "unauthorized" || error.kind === "forbidden")) {
          options.onAuthError?.(error);
        }
        throw error;
      }
    },
    async sendWhatsappRsvp(invitationCode, mode, idempotencyKey, signal) {
      try {
        return await sendAdminWhatsappRsvp(invitationCode, mode, idempotencyKey, options.getToken, {
          apiUrl: options.apiUrl,
          fetcher: options.fetcher,
          signal
        });
      } catch (error) {
        if (error instanceof AdminApiError && (error.kind === "unauthorized" || error.kind === "forbidden")) {
          options.onAuthError?.(error);
        }
        throw error;
      }
    }
  };
}

export function selectAdminDashboardSource(
  mode: "fixture" | "live",
  liveSource: AdminDashboardSource
) {
  return mode === "fixture" ? fixtureDashboardSource : liveSource;
}
