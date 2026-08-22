import {
  musicSuggestionFromNote,
  type RsvpStatus,
  type WhatsappCommandStatus,
  type WhatsappFlowStage,
  type WhatsappFlowStatus,
  type WhatsappPhoneSource,
  type WhatsappRsvpTemplatePurpose
} from "@brimax/contracts";
import type {
  AdminGift,
  AdminGuest,
  AdminGuestRow,
  AdminInvitation,
  AdminMusicSuggestion,
  AdminRsvpSummary
} from "@/lib/admin-dashboard-types";

/** Semantic colour families. Every badge in the panel resolves to one of these five. */
export type Tone = "ok" | "warn" | "err" | "info" | "mute";

/** Tailwind class pairs for each tone, backed by the `--color-admin-*` tokens in index.css. */
export const TONE_CLASSES: Record<Tone, string> = {
  ok: "bg-admin-ok-bg text-admin-ok-fg",
  warn: "bg-admin-warn-bg text-admin-warn-fg",
  err: "bg-admin-err-bg text-admin-err-fg",
  info: "bg-admin-info-bg text-admin-info-fg",
  mute: "bg-admin-mute-bg text-admin-mute-fg"
};

/** Foreground only, for marks that paint the tone colour itself (timeline dots, bars). */
export const TONE_FG_CLASSES: Record<Tone, string> = {
  ok: "text-admin-ok-fg",
  warn: "text-admin-warn-fg",
  err: "text-admin-err-fg",
  info: "text-admin-info-fg",
  mute: "text-admin-mute-fg"
};

export const RSVP_LABELS: Record<RsvpStatus, { label: string; tone: Tone }> = {
  attending: { label: "Confirmado", tone: "ok" },
  pending: { label: "Pendente", tone: "warn" },
  declined: { label: "Não vai", tone: "err" }
};

export const FLOW_LABELS: Record<WhatsappFlowStatus, { label: string; tone: Tone }> = {
  idle: { label: "Não iniciado", tone: "mute" },
  send_queued: { label: "Envio na fila", tone: "info" },
  sending: { label: "Enviando", tone: "info" },
  message_sent: { label: "Mensagem enviada", tone: "info" },
  response_received: { label: "Resposta recebida", tone: "info" },
  attendance_confirmed_whatsapp: { label: "Confirmado no WhatsApp", tone: "ok" },
  attendance_declined: { label: "Recusa no WhatsApp", tone: "err" },
  website_followup_pending: { label: "Follow-up do site pendente", tone: "info" },
  website_update_required: { label: "Atualizar no site", tone: "warn" },
  undecided: { label: "Indeciso", tone: "warn" },
  completed: { label: "Fluxo concluído", tone: "ok" },
  failed: { label: "Falha no envio", tone: "err" },
  reconciliation_required: { label: "Reconciliação necessária", tone: "err" }
};

export const STAGE_LABELS: Record<WhatsappFlowStage, string> = {
  reconfirmation: "Reconfirmação",
  pending: "Pendente",
  followup: "Follow-up",
  fallback: "Fallback"
};

export const COMMAND_LABELS: Record<WhatsappCommandStatus, { label: string; tone: Tone }> = {
  queued: { label: "NA FILA", tone: "info" },
  sending: { label: "ENVIANDO", tone: "info" },
  sent: { label: "ENVIADO", tone: "ok" },
  failed: { label: "FALHOU", tone: "err" },
  queue_unavailable: { label: "FILA INDISPONÍVEL", tone: "err" },
  reconciliation_required: { label: "RECONCILIAR", tone: "err" }
};

export const PHONE_SOURCE_LABELS: Record<WhatsappPhoneSource, string> = {
  operator: "Operador",
  import: "Importação",
  guest: "Informado pelo convidado"
};

export const TEMPLATE_LABELS: Record<WhatsappRsvpTemplatePurpose, string> = {
  wedding_invitation: "Convite enviado",
  wedding_rsvp_reconfirmation: "Pedido de reconfirmação",
  wedding_rsvp_reconfirmation_single: "Pedido de reconfirmação (individual)",
  wedding_rsvp_attending_followup: "Follow-up de confirmados",
  wedding_rsvp_attending_followup_single: "Follow-up de confirmados (individual)",
  wedding_rsvp_attending_followup_website: "Follow-up de confirmados pelo site",
  wedding_rsvp_attending_followup_website_single: "Follow-up de confirmados pelo site (individual)",
  wedding_rsvp_pending_reminder_group: "Lembrete de pendentes",
  wedding_rsvp_pending_reminder_single: "Lembrete de pendentes (individual)",
  wedding_rsvp_declined_followup: "Follow-up de recusa",
  wedding_rsvp_declined_followup_single: "Follow-up de recusa (individual)",
  wedding_rsvp_undecided_followup: "Follow-up de indecisos",
  wedding_rsvp_undecided_followup_single: "Follow-up de indecisos (individual)"
};

/** Keeps retained or internal template identifiers readable after the active manifest changes. */
export function templateLabel(templateId: string) {
  return TEMPLATE_LABELS[templateId as WhatsappRsvpTemplatePurpose] ?? `Modelo ${templateId}`;
}

/** Each R$ 50,00 quota of a fractional gift. Mirrors the LEGACY_FIXED_50 funding model. */
export const GIFT_PART_CENTS = 5_000;

/**
 * Where a guest stands on the courtesy question. "Criança" is the operator's seed (0–11) and
 * only decides whether the RSVP page asks for the age band; the ≤6 answer that exempts the
 * seat from being charged belongs to the guest, so it stays unknown until they reply.
 */
export type CourtesyState = "courtesy" | "paying" | "awaiting" | "not-applicable";

export function courtesyState(
  guest: Pick<AdminGuest, "isChild" | "isChildSixOrYounger">
): CourtesyState {
  // A confirmed ≤6 always reads as a courtesy, so the label can never disagree with the count.
  if (guest.isChildSixOrYounger === true) return "courtesy";
  // The RSVP only asks the age question about crianças; for everyone else it submits `false`
  // as a default, which is not an answer worth reporting back to the operator.
  if (!guest.isChild) return "not-applicable";
  return guest.isChildSixOrYounger === false ? "paying" : "awaiting";
}

export const COURTESY_LABELS: Record<CourtesyState, string> = {
  courtesy: "Sim · isenta de cobrança",
  paying: "Não · 7 anos ou mais",
  awaiting: "Aguardando confirmação do convidado",
  "not-applicable": "—"
};

/** The lowercase markers appended to a guest's one-line summary, in reading order. */
export function guestFlags(guest: Pick<AdminGuest, "isChild" | "isChildSixOrYounger">) {
  return [
    ...(guest.isChild ? ["criança"] : []),
    ...(guest.isChildSixOrYounger === true ? ["cortesia"] : [])
  ];
}

/** A guest is the primary one when it heads the invitation's ordered guest list. */
export function isPrimaryGuest(invitation: AdminInvitation, guestId: string) {
  return invitation.guests[0]?.guestId === guestId;
}

/** Flattens invitations into one row per person, the shape the Convidados table reads. */
export function toGuestRows(invitations: AdminInvitation[]): AdminGuestRow[] {
  return invitations.flatMap((invitation) =>
    invitation.guests.map((guest, index) => ({
      ...guest,
      invitationCode: invitation.invitationCode,
      householdName: invitation.householdName,
      phoneNumber: invitation.phoneNumber,
      sortOrder: index + 1,
      invitation
    }))
  );
}

/** An invitation needs an operator's attention when the flow cannot advance on its own. */
export function needsAttention(invitation: AdminInvitation) {
  return (
    invitation.whatsappFlowStatus === "failed" ||
    invitation.whatsappFlowStatus === "reconciliation_required" ||
    invitation.reconciliationStatus === "required"
  );
}

/** The banner copy for the invitation detail, or null when nothing is stuck. */
export function attentionMessage(invitation: AdminInvitation) {
  if (invitation.whatsappFlowStatus === "failed") {
    return "O último envio falhou após 3 tentativas e o fallback foi disparado. Confirme o número antes de reenviar.";
  }
  if (invitation.reconciliationStatus === "required") {
    return "A resposta recebida no WhatsApp não corresponde ao RSVP do site. É preciso reconciliar manualmente.";
  }
  if (invitation.whatsappFlowStatus === "website_update_required") {
    return "O convidado respondeu no WhatsApp, mas o RSVP do site ainda não foi atualizado.";
  }
  return null;
}

export const INVITE_FILTERS = [
  "Todos",
  "Confirmados",
  "Pendentes",
  "Não vão",
  "Requer atenção"
] as const;
export type InviteFilter = (typeof INVITE_FILTERS)[number];

export const GUEST_FILTERS = ["Todos", "Confirmados", "Pendentes", "Não vão", "Cortesias"] as const;
export type GuestFilter = (typeof GUEST_FILTERS)[number];

export const MESSAGE_FILTERS = ["Todos", "No site", "Escondidos"] as const;
export type MessageFilter = (typeof MESSAGE_FILTERS)[number];

export const GIFT_FILTERS = ["Todos", "Em andamento", "Completos", "Pausados"] as const;
export type GiftFilter = (typeof GIFT_FILTERS)[number];

export const CHAT_FILTERS = ["Todas", "Não lidas", "Pendentes"] as const;
export type ChatFilter = (typeof CHAT_FILTERS)[number];

const matches = (query: string, ...fields: string[]) =>
  !query || fields.join(" ").toLowerCase().includes(query);

export function filterInvitations(
  invitations: AdminInvitation[],
  filter: InviteFilter,
  query: string
) {
  const needle = query.trim().toLowerCase();
  return invitations.filter((invitation) => {
    const status = invitation.rsvp.status;
    const passesFilter =
      filter === "Todos" ||
      (filter === "Confirmados" && status === "attending") ||
      (filter === "Pendentes" && status === "pending") ||
      (filter === "Não vão" && status === "declined") ||
      (filter === "Requer atenção" && needsAttention(invitation));
    return (
      passesFilter &&
      matches(needle, invitation.invitationCode, invitation.householdName, invitation.phoneNumber)
    );
  });
}

export function filterGuests(guests: AdminGuestRow[], filter: GuestFilter, query: string) {
  const needle = query.trim().toLowerCase();
  return guests.filter((guest) => {
    const passesFilter =
      filter === "Todos" ||
      (filter === "Confirmados" && guest.rsvpStatus === "attending") ||
      (filter === "Pendentes" && guest.rsvpStatus === "pending") ||
      (filter === "Não vão" && guest.rsvpStatus === "declined") ||
      (filter === "Cortesias" && guest.isChildSixOrYounger === true);
    return (
      passesFilter &&
      matches(needle, guest.guestName, guest.invitationCode, guest.householdName, guest.guestId)
    );
  });
}

/**
 * Flattens invitations into one row per music suggestion, newest first.
 *
 * The song lives on the invitation's RSVP note, so an invitation contributes at most one
 * row and only when the guest actually wrote something.
 */
export function toMusicSuggestionRows(invitations: AdminInvitation[]): AdminMusicSuggestion[] {
  return invitations
    .flatMap((invitation) => {
      const music = musicSuggestionFromNote(invitation.rsvp.note)?.trim();
      if (!music || !invitation.rsvp.updatedAt) return [];
      return [
        {
          invitationCode: invitation.invitationCode,
          householdName: invitation.householdName,
          music,
          suggestedAt: invitation.rsvp.updatedAt,
          rsvpStatus: invitation.rsvp.status
        }
      ];
    })
    .sort((a, b) => b.suggestedAt.localeCompare(a.suggestedAt));
}

export function filterMusicSuggestions(rows: AdminMusicSuggestion[], query: string) {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) =>
    matches(needle, row.invitationCode, row.householdName, row.music)
  );
}

/** Recomputes the invitation RSVP roll-up from its guests, the way the API does on write. */
export function recalculateRsvp(
  guests: AdminInvitation["guests"],
  previous: AdminRsvpSummary,
  now: string
): AdminRsvpSummary {
  const attending = guests.filter((guest) => guest.rsvpStatus === "attending");
  const anyPending = guests.some((guest) => guest.rsvpStatus === "pending");
  const status: RsvpStatus = attending.length ? "attending" : anyPending ? "pending" : "declined";
  return {
    ...previous,
    status,
    updatedAt: now,
    attending: attending.length,
    // Mirrors `deriveRsvpCounts`: only a confirmed "6 anos ou menos" is free. A criança whose
    // guardian has not answered the age question yet is still a paying seat.
    paid: attending.filter((guest) => guest.isChildSixOrYounger !== true).length,
    childrenSixOrYounger: attending.filter((guest) => guest.isChildSixOrYounger === true).length
  };
}

/** Recomputes every derived money/quota field of a gift from its editable ones. */
export function deriveGift(
  gift: Omit<
    AdminGift,
    | "partValueCents"
    | "totalParts"
    | "confirmedAmountCents"
    | "reservedAmountCents"
    | "availableAmountCents"
    | "availableParts"
    | "fullyFunded"
    | "finalPartValueCents"
    | "fundingModelVersion"
  >
): AdminGift {
  const totalParts = gift.fractional
    ? Math.max(1, Math.round(gift.totalValueCents / GIFT_PART_CENTS))
    : null;
  const unitCents = gift.fractional ? GIFT_PART_CENTS : gift.totalValueCents;
  const confirmedAmountCents = gift.partsFunded * unitCents;
  const reservedAmountCents = gift.partsReserved * unitCents;
  return {
    ...gift,
    partValueCents: gift.fractional ? GIFT_PART_CENTS : null,
    totalParts,
    finalPartValueCents: null,
    fundingModelVersion: "LEGACY_FIXED_50",
    confirmedAmountCents,
    reservedAmountCents,
    availableAmountCents: Math.max(
      0,
      gift.totalValueCents - confirmedAmountCents - reservedAmountCents
    ),
    availableParts: Math.max(0, (totalParts ?? 1) - gift.partsFunded - gift.partsReserved),
    fullyFunded: gift.fractional ? gift.partsFunded >= (totalParts ?? 1) : gift.partsFunded >= 1
  };
}

const GIFT_TILE_CLASSES = [
  "bg-admin-tile-1-bg text-admin-tile-1-fg",
  "bg-admin-tile-2-bg text-admin-tile-2-fg",
  "bg-admin-tile-3-bg text-admin-tile-3-fg",
  "bg-admin-tile-4-bg text-admin-tile-4-fg",
  "bg-admin-tile-5-bg text-admin-tile-5-fg",
  "bg-admin-tile-6-bg text-admin-tile-6-fg"
];

/** Stable placeholder colours for a gift without a photo, hashed from its id. */
export function giftTileClasses(giftId: string) {
  const hash = [...giftId].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return GIFT_TILE_CLASSES[Math.abs(hash) % GIFT_TILE_CLASSES.length];
}

/** A gift's total is valid when it is positive, and a multiple of the quota when fractional. */
export function isValidGiftTotal(totalCents: number, fractional: boolean) {
  return totalCents > 0 && (!fractional || totalCents % GIFT_PART_CENTS === 0);
}

export function giftBadge(gift: AdminGift): { label: string; tone: Tone } {
  if (gift.paused) return { label: "PAUSADO", tone: "mute" };
  if (gift.fullyFunded) return { label: "COMPLETO", tone: "ok" };
  if (gift.partsFunded > 0) return { label: "EM ANDAMENTO", tone: "info" };
  return { label: "DISPONÍVEL", tone: "warn" };
}

export function filterGifts(gifts: AdminGift[], filter: GiftFilter, query: string) {
  const needle = query.trim().toLowerCase();
  return gifts.filter((gift) => {
    const passesFilter =
      filter === "Todos" ||
      (filter === "Em andamento" && !gift.paused && !gift.fullyFunded) ||
      (filter === "Completos" && gift.fullyFunded) ||
      (filter === "Pausados" && gift.paused);
    return passesFilter && matches(needle, gift.id, gift.name);
  });
}

/**
 * Which send the backend will accept. A first send only opens a flow that has never
 * been contacted; a resend is only allowed out of a failed, reconciling, or undecided
 * flow — mirroring the transitions the WhatsApp RSVP service enforces.
 */
export function sendAvailability(invitation: AdminInvitation) {
  const sentCount = invitation.commands.length;
  const failed =
    invitation.whatsappFlowStatus === "failed" || invitation.reconciliationStatus === "required";
  const undecided = invitation.whatsappFlowStatus === "undecided";
  return {
    sentCount,
    failed,
    undecided,
    firstAllowed: sentCount === 0,
    resendAllowed: sentCount > 0 && (failed || undecided)
  };
}

/** The template a given send mode will use, matching `sendAvailability`. */
export function templateForSend(
  invitation: AdminInvitation,
  mode: "first" | "resend"
): WhatsappRsvpTemplatePurpose {
  if (mode === "first" || invitation.whatsappFlowStatus === "failed") return "wedding_invitation";
  return invitation.guests.length > 1
    ? "wedding_rsvp_pending_reminder_group"
    : "wedding_rsvp_pending_reminder_single";
}
