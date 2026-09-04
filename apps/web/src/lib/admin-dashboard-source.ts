import { findNextAvailableInvitationCode, type AdminAddGuestsRequest, type AdminCreateInvitationRequest, type AdminCreateInvitationResponse, type AdminDashboardResponse, type AdminDeleteInvitationResponse, type AdminGuestUpdateRequest, type AdminInvitationRsvpWriteResponse, type DeleteGuestMessageResponse, type WhatsappOperatorTextSendResponse, type WhatsappPhoneUpdateResponse, type WhatsappRsvpSendMode, type WhatsappRsvpSendResponse, type WhatsappRsvpStatusResponse } from "@brimax/contracts";
import {
  AdminApiError,
  addAdminInvitationGuests,
  confirmAdminInvitationGuests,
  createAdminInvitation,
  getNextAdminInvitationCode,
  deleteAdminGuestMessage,
  deleteAdminInvitation,
  getAdminDashboard,
  updateAdminInvitationPhone,
  removeAdminInvitationGuest,
  getAdminWhatsappThread,
  sendAdminWhatsappRsvp,
  sendAdminWhatsappText,
  updateAdminGuest,
  type AdminTokenAccessor
} from "@/lib/admin-api";
import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import { deriveReconciliationStatus, messageFallback, recalculateRsvp } from "@/lib/admin-dashboard-model";
import type {
  AdminDashboardSnapshot,
  AdminInvitation,
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
  /**
   * Hard-deletes one guest message. Required — both sources implement it, so callers need no
   * "not available" branch. New mutation methods follow this shape; the two optional WhatsApp
   * sends above predate the convention.
   */
  deleteGuestMessage(messageId: string, signal?: AbortSignal): Promise<DeleteGuestMessageResponse>;
  /**
   * Corrects one guest's RSVP status, seed child flag, and/or confirmed age band. Both writes
   * below answer with the invitation's full guest list and recomputed aggregate, so the caller
   * reconciles from the response instead of refetching the whole dashboard.
   */
  updateGuest(
    invitationCode: string,
    guestId: string,
    patch: AdminGuestUpdateRequest,
    signal?: AbortSignal
  ): Promise<AdminInvitationRsvpWriteResponse>;
  /** Confirms the selected guests; unselected guests keep the status they already had. */
  confirmGuests(
    invitationCode: string,
    guestIds: string[],
    signal?: AbortSignal
  ): Promise<AdminInvitationRsvpWriteResponse>;
  /**
   * Creates one invitation. Answers with the whole dashboard row rather than the RSVP envelope: a
   * brand-new invitation has no guest list to reconcile against, it *is* the new row.
   */
  createInvitation(
    draft: AdminCreateInvitationRequest,
    signal?: AbortSignal
  ): Promise<AdminCreateInvitationResponse>;
  getNextInvitationCode?(signal?: AbortSignal): Promise<string>;
  /** Hard-deletes one invitation and everything keyed to its code, WhatsApp history included. */
  deleteInvitation(
    invitationCode: string,
    signal?: AbortSignal
  ): Promise<AdminDeleteInvitationResponse>;
  updateInvitationPhone?(
    invitationCode: string,
    phoneNumber: string,
    signal?: AbortSignal
  ): Promise<WhatsappPhoneUpdateResponse>;
  /** Adds guests to an invitation; the server assigns each new slot and guest id. */
  addGuests(
    invitationCode: string,
    guests: AdminAddGuestsRequest["guests"],
    signal?: AbortSignal
  ): Promise<AdminInvitationRsvpWriteResponse>;
  /** Removes one guest and prunes the answer they left. Removing the last guest is refused. */
  removeGuest(
    invitationCode: string,
    guestId: string,
    signal?: AbortSignal
  ): Promise<AdminInvitationRsvpWriteResponse>;
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

/**
 * Locates one invitation in a freshly built fixture snapshot, or throws the same error the live
 * source would. The fixture source stays a stateless singleton: every method rebuilds the snapshot
 * and the reducer applies the result, exactly as it does for a live write.
 */
function fixtureInvitation(invitationCode: string) {
  const invitation = createFixtureDashboardSnapshot().invitations.find(
    (item) => item.invitationCode === invitationCode
  );
  if (!invitation) {
    throw new AdminApiError("Este convite não está mais disponível.", "rejected", 404);
  }
  return invitation;
}

/** Recomputes the aggregate the API would return, through the panel's own derivation. */
function fixtureWriteResponse(
  invitation: AdminInvitation,
  guests: AdminInvitation["guests"]
): AdminInvitationRsvpWriteResponse {
  const updatedAt = new Date().toISOString();
  const rsvp = recalculateRsvp(guests, invitation.rsvp, updatedAt);
  return {
    ok: true,
    invitationCode: invitation.invitationCode,
    guests: guests.map((guest) => ({
      guestId: guest.guestId,
      guestName: guest.guestName,
      allowedPlusOnes: guest.allowedPlusOnes,
      rsvpStatus: guest.rsvpStatus,
      isChild: guest.isChild,
      isChildSixOrYounger: guest.isChildSixOrYounger,
      dietaryNotes: guest.dietaryNotes
    })),
    rsvp: {
      status: rsvp.status,
      updatedAt,
      submittedBy: rsvp.submittedBy ?? guests[0]?.guestId ?? null,
      attending: rsvp.attending,
      paid: rsvp.paid,
      childrenSixOrYounger: rsvp.childrenSixOrYounger,
      ...(rsvp.note === undefined ? {} : { note: rsvp.note })
    },
    updatedAt
  };
}

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
  async deleteGuestMessage(messageId) {
    // The fixture source is a stateless singleton: every method rebuilds the snapshot, and the
    // row leaving the list is the reducer's job, exactly as it is for a live delete. A demo
    // refresh restores it, like every other demonstration mutation here.
    const snapshot = createFixtureDashboardSnapshot();
    const message = snapshot.guestMessages.find((item) => item.messageId === messageId);
    if (!message) throw new AdminApiError("Este recado não existe mais.", "rejected", 404);
    return { ok: true as const, messageId, deletedAt: new Date().toISOString() };
  },
  async updateInvitationPhone(invitationCode, phoneNumber) {
    const invitation = fixtureInvitation(invitationCode);
    const normalized = phoneNumber.replace(/\D/g, "");
    if (normalized.length < 8 || normalized.length > 15) {
      throw new AdminApiError("Informe um número válido com DDI e DDD.", "rejected", 400);
    }
    return {
      invitationCode: invitation.invitationCode,
      phoneNumber: normalized,
      updatedAt: new Date().toISOString()
    };
  },
  async updateGuest(invitationCode, guestId, patch) {
    const invitation = fixtureInvitation(invitationCode);
    const guest = invitation.guests.find((item) => item.guestId === guestId);
    if (!guest) throw new AdminApiError("Este convidado não está mais disponível. Atualize os dados do painel.", "rejected", 404);
    return fixtureWriteResponse(
      invitation,
      invitation.guests.map((item) =>
        item.guestId === guestId
          ? {
              ...item,
              rsvpStatus: patch.rsvpStatus ?? item.rsvpStatus,
              isChild: patch.isChild ?? item.isChild,
              isChildSixOrYounger:
                patch.isChildSixOrYounger === undefined
                  ? item.isChildSixOrYounger
                  : patch.isChildSixOrYounger
            }
          : item
      )
    );
  },
  async confirmGuests(invitationCode, guestIds) {
    const invitation = fixtureInvitation(invitationCode);
    const known = new Set(invitation.guests.map((guest) => guest.guestId));
    if (guestIds.length === 0 || guestIds.some((guestId) => !known.has(guestId))) {
      throw new AdminApiError("Este convidado não está mais disponível. Atualize os dados do painel.", "rejected", 404);
    }
    return fixtureWriteResponse(
      invitation,
      invitation.guests.map((guest) =>
        guestIds.includes(guest.guestId) ? { ...guest, rsvpStatus: "attending" as const } : guest
      )
    );
  },
  async createInvitation(draft) {
    const snapshot = createFixtureDashboardSnapshot();
    if (snapshot.invitations.some((item) => item.invitationCode === draft.invitationCode)) {
      throw new AdminApiError(
        "Já existe um convite com este código. Escolha outro código.",
        "rejected",
        409
      );
    }
    const createdAt = new Date().toISOString();
    return {
      ok: true as const,
      invitation: {
        invitationCode: draft.invitationCode,
        householdName: draft.householdName,
        ...(draft.phoneNumber
          ? {
              phoneNumber: draft.phoneNumber,
              phoneNumberSource: "operator" as const,
              phoneNumberUpdatedAt: createdAt
            }
          : {}),
        whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
        whatsappFreeTextWindow: { open: false },
        guests: draft.guests.map((guest, index) => ({
          guestId: `${draft.invitationCode}--guest-${String(index + 1).padStart(2, "0")}`,
          guestName: guest.guestName,
          allowedPlusOnes: 0,
          rsvpStatus: "pending" as const,
          isChild: guest.isChild ?? false
        })),
        rsvp: {
          status: "pending" as const,
          updatedAt: null,
          submittedBy: null,
          attending: 0,
          paid: 0,
          childrenSixOrYounger: 0
        }
      },
      createdAt
    };
  },
  async getNextInvitationCode() {
    const code = findNextAvailableInvitationCode(
      createFixtureDashboardSnapshot().invitations.map((invitation) => invitation.invitationCode)
    );
    if (!code) throw new AdminApiError("Não há códigos de convite disponíveis.", "unavailable", 503);
    return code;
  },
  async deleteInvitation(invitationCode) {
    const invitation = fixtureInvitation(invitationCode);
    return {
      ok: true as const,
      invitationCode,
      deletedAt: new Date().toISOString(),
      deleted: {
        guests: invitation.guests.length,
        rsvp: 1 as const,
        whatsappItems: invitation.whatsappConversation?.messageCount ?? 0,
        phoneLookups: invitation.phoneNumber ? (1 as const) : (0 as const)
      }
    };
  },
  async addGuests(invitationCode, guests) {
    const invitation = fixtureInvitation(invitationCode);
    // Mirrors the server rule: slots come from the highest one in use, never from a gap.
    const nextSlot =
      invitation.guests.reduce((max, guest) => {
        const slot = Number(guest.guestId.slice(guest.guestId.lastIndexOf("-") + 1));
        return Number.isInteger(slot) && slot > max ? slot : max;
      }, 0) + 1;
    return fixtureWriteResponse(invitation, [
      ...invitation.guests,
      ...guests.map((guest, index) => ({
        guestId: `${invitationCode}--guest-${String(nextSlot + index).padStart(2, "0")}`,
        guestName: guest.guestName,
        allowedPlusOnes: 0,
        rsvpStatus: "pending" as const,
        isChild: guest.isChild ?? false
      }))
    ]);
  },
  async removeGuest(invitationCode, guestId) {
    const invitation = fixtureInvitation(invitationCode);
    if (!invitation.guests.some((guest) => guest.guestId === guestId)) {
      throw new AdminApiError(
        "Este convidado não está mais disponível. Atualize os dados do painel.",
        "rejected",
        404
      );
    }
    if (invitation.guests.length <= 1) {
      throw new AdminApiError(
        "Este é o último convidado do convite. Exclua o convite em vez de remover o convidado.",
        "rejected",
        409
      );
    }
    return fixtureWriteResponse(
      invitation,
      invitation.guests.filter((guest) => guest.guestId !== guestId)
    );
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

/**
 * One API invitation as the panel's reducer holds it.
 *
 * Shared by the dashboard load and the create write, so a freshly created invitation is shaped by
 * exactly the same rules as one that arrived in a snapshot — no second, drifting mapping.
 */
export function mapAdminDashboardInvitation(
  invitation: AdminDashboardResponse["invitations"][number]
): AdminInvitation {
  return {
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
  };
}

export function mapAdminDashboardResponse(
  response: AdminDashboardResponse
): AdminDashboardSnapshot {
  return {
    invitations: response.invitations.map(mapAdminDashboardInvitation),
    gifts: response.gifts.map((gift) => ({
      ...gift,
      payerNames: [...gift.payerNames],
      paused: false,
      photoUrl: null,
      version: 0
    })),
    guestMessages: response.guestMessages.map((message) => ({ ...message })),
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
    async deleteGuestMessage(messageId, signal) {
      try {
        return await deleteAdminGuestMessage(messageId, options.getToken, {
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
    async updateInvitationPhone(invitationCode, phoneNumber, signal) {
      try {
        return await updateAdminInvitationPhone(invitationCode, phoneNumber, options.getToken, {
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
    async updateGuest(invitationCode, guestId, patch, signal) {
      try {
        return await updateAdminGuest(invitationCode, guestId, patch, options.getToken, {
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
    async confirmGuests(invitationCode, guestIds, signal) {
      try {
        return await confirmAdminInvitationGuests(invitationCode, guestIds, options.getToken, {
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
    async createInvitation(draft, signal) {
      try {
        return await createAdminInvitation(draft, options.getToken, {
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
    async getNextInvitationCode(signal) {
      try {
        const response = await getNextAdminInvitationCode(options.getToken, {
          apiUrl: options.apiUrl,
          fetcher: options.fetcher,
          signal
        });
        return response.invitationCode;
      } catch (error) {
        if (error instanceof AdminApiError && (error.kind === "unauthorized" || error.kind === "forbidden")) {
          options.onAuthError?.(error);
        }
        throw error;
      }
    },
    async deleteInvitation(invitationCode, signal) {
      try {
        return await deleteAdminInvitation(invitationCode, options.getToken, {
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
    async addGuests(invitationCode, guests, signal) {
      try {
        return await addAdminInvitationGuests(invitationCode, guests, options.getToken, {
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
    async removeGuest(invitationCode, guestId, signal) {
      try {
        return await removeAdminInvitationGuest(invitationCode, guestId, options.getToken, {
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
