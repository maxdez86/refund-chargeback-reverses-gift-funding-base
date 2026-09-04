import { Baby, Check, CircleAlert, Trash2, X } from "lucide-react";
import { formatPhone, initials } from "@/lib/admin-dashboard-format";
import { RSVP_LABELS, guestFlags } from "@/lib/admin-dashboard-model";
import type { AdminGuestRow } from "@/lib/admin-dashboard-types";
import {
  ADMIN_BUTTON,
  AdminModal,
  ModalActions,
  StatusPill
} from "@/components/dashboard/AdminPrimitives";
import type { GuestActionKind } from "@/components/dashboard/screens/GuestDetailScreen";
import { cn } from "@/lib/utils";

type Copy = {
  title: string;
  body: string;
  note?: string;
  noteClassName?: string;
  blocked?: string;
  confirmLabel: string;
  confirmClassName: string;
  cancelLabel: string;
  iconClassName: string;
  icon: React.ReactNode;
};

/** The confirmation copy for each guest action, including the blocked primary-guest case. */
export function guestActionCopy(guest: AdminGuestRow, kind: GuestActionKind): Copy {
  const primary = guest.sortOrder === 1;
  const others = guest.invitation.guests.length - 1;

  if (kind === "attending") {
    return {
      title: "Marcar como confirmado?",
      body: `${guest.guestName} passa a constar como confirmado no RSVP do convite ${guest.invitationCode}. O total de confirmados e o valor a pagar são recalculados.`,
      note:
        guest.isChildSixOrYounger === true
          ? "Cortesia: entra no total de confirmados sem gerar cobrança."
          : guest.isChild && guest.isChildSixOrYounger === undefined
            ? "Criança sem faixa etária confirmada: entra como pagante até o convidado responder no RSVP."
            : undefined,
      noteClassName: "text-admin-gold",
      confirmLabel: "Marcar como confirmado",
      confirmClassName: ADMIN_BUTTON.confirm,
      cancelLabel: "Cancelar",
      iconClassName: "bg-admin-ok-bg text-admin-ok-fg",
      icon: <Check className="size-[19px]" strokeWidth={1.7} aria-hidden="true" />
    };
  }

  if (kind === "declined") {
    return {
      title: "Marcar como não vai?",
      body: `${guest.guestName} sai da contagem de confirmados do convite ${guest.invitationCode}. O RSVP continua editável depois.`,
      confirmLabel: "Marcar como não vai",
      confirmClassName: cn(ADMIN_BUTTON.primary, "bg-admin-gold hover:bg-admin-gold-deep"),
      cancelLabel: "Cancelar",
      iconClassName: "bg-admin-gold-tint text-admin-gold",
      icon: <X className="size-[19px]" strokeWidth={1.7} aria-hidden="true" />
    };
  }

  if (kind === "child") {
    return guest.isChild
      ? {
          title: "Desmarcar como criança?",
          body: `${guest.guestName} deixa de ser tratado como criança de 0 a 11 anos, então o RSVP do convite ${guest.invitationCode} para de pedir a faixa etária dessa pessoa.`,
          note:
            guest.isChildSixOrYounger === undefined
              ? undefined
              : "A faixa etária já respondida é descartada. Se houver cortesia, o lugar volta a ser pagante.",
          noteClassName: "text-admin-gold",
          confirmLabel: "Desmarcar como criança",
          confirmClassName: cn(ADMIN_BUTTON.primary, "bg-admin-gold hover:bg-admin-gold-deep"),
          cancelLabel: "Cancelar",
          iconClassName: "bg-admin-warn-bg text-admin-warn-fg",
          icon: <Baby className="size-[19px]" strokeWidth={1.7} aria-hidden="true" />
        }
      : {
          title: "Marcar como criança?",
          body: `${guest.guestName} passa a ser tratado como criança de 0 a 11 anos e o RSVP do convite ${guest.invitationCode} passa a pedir a faixa etária dessa pessoa.`,
          note: "A cortesia de até 6 anos continua sendo definida pelo convidado ao confirmar presença.",
          noteClassName: "text-admin-muted",
          confirmLabel: "Marcar como criança",
          confirmClassName: ADMIN_BUTTON.primary,
          cancelLabel: "Cancelar",
          iconClassName: "bg-admin-warn-bg text-admin-warn-fg",
          icon: <Baby className="size-[19px]" strokeWidth={1.7} aria-hidden="true" />
        };
  }

  if (primary) {
    return {
      title: "Excluir o convite?",
      body: `O convidado principal não pode ser removido. Quer excluir o convite ${guest.invitationCode} inteiro?`,
      blocked:
        "O convidado principal responde pelo RSVP do convite, então não é possível retirá-lo isoladamente.",
      note: "Esta ação não pode ser desfeita.",
      noteClassName: "text-admin-danger",
      confirmLabel: "Excluir convite",
      confirmClassName: ADMIN_BUTTON.destructive,
      cancelLabel: "Manter convite",
      iconClassName: "bg-admin-err-bg text-admin-err-fg",
      icon: <CircleAlert className="size-[19px]" strokeWidth={1.7} aria-hidden="true" />
    };
  }

  return {
    title: "Remover do convite?",
    body: `${guest.guestName} deixa de fazer parte do convite ${guest.invitationCode}, que continua com ${others} ${others === 1 ? "convidado" : "convidados"}. O RSVP é recalculado.`,
    note: "Esta ação não pode ser desfeita.",
    noteClassName: "text-admin-danger",
    confirmLabel: "Remover convidado",
    confirmClassName: ADMIN_BUTTON.destructive,
    cancelLabel: "Cancelar",
    iconClassName: "bg-admin-err-bg text-admin-err-fg",
    icon: <Trash2 className="size-[19px]" strokeWidth={1.7} aria-hidden="true" />
  };
}

/**
 * Confirms one guest action.
 *
 * The RSVP actions persist, so the modal stays open and undismissable while the request is in
 * flight and renders the failure in place — the operator retries against the same guest rather
 * than hunting for a toast that has gone.
 */
export function GuestActionModal({
  guest,
  kind,
  submitting = false,
  error,
  onCancel,
  onConfirm
}: {
  guest: AdminGuestRow;
  kind: GuestActionKind;
  submitting?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = guestActionCopy(guest, kind);
  const status = RSVP_LABELS[guest.rsvpStatus];
  const meta = [
    guest.sortOrder === 1 ? "Principal · responde pelo convite" : "Acompanhante",
    ...guestFlags(guest),
    formatPhone(guest.phoneNumber)
  ].join(" · ");

  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && !submitting && onCancel()}
      widthClassName="max-w-[490px]"
      eyebrow={`CONVITE ${guest.invitationCode}`}
      title={copy.title}
      description={copy.body}
      icon={
        <span
          aria-hidden="true"
          className={cn(
            "flex size-[38px] shrink-0 items-center justify-center rounded-full",
            copy.iconClassName
          )}
        >
          {copy.icon}
        </span>
      }
      footer={
        <ModalActions>
          <button
            type="button"
            className={ADMIN_BUTTON.neutral}
            onClick={onCancel}
            disabled={submitting}
          >
            {copy.cancelLabel}
          </button>
          <button
            type="button"
            className={copy.confirmClassName}
            onClick={onConfirm}
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? "Salvando…" : copy.confirmLabel}
          </button>
        </ModalActions>
      }
    >
      <div className="mt-[18px] flex items-center gap-3.5 rounded-[11px] border border-admin-line bg-admin-surface px-4 py-3.5">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-admin-mute-bg text-[12.5px] font-semibold text-admin-ink-soft"
        >
          {initials(guest.guestName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{guest.guestName}</p>
          <p className="mt-1 text-[13px] text-admin-faint">{meta}</p>
        </div>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </div>

      {copy.blocked && (
        <div className="mt-4 rounded-[11px] border border-admin-danger-edge bg-admin-danger-tint px-4 py-[15px]">
          <p className="text-[11.5px] font-semibold tracking-[0.14em] text-admin-danger">
            NÃO É POSSÍVEL REMOVER
          </p>
          <p className="mt-2 text-[13.5px] leading-[1.55] text-admin-danger-ink [text-wrap:pretty]">
            {copy.blocked}
          </p>
        </div>
      )}

      {copy.note && (
        <p className={cn("mt-4 text-[13px] leading-[1.5] [text-wrap:pretty]", copy.noteClassName)}>
          {copy.note}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm leading-relaxed text-admin-danger">
          {error}
        </p>
      )}
    </AdminModal>
  );
}
