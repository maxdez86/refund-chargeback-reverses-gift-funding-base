import type { MouseEvent } from "react";
import { Baby, ChevronRight, Flag } from "lucide-react";
import { formatLongDate, formatPhone, initials, pluralize } from "@/lib/admin-dashboard-format";
import {
  COURTESY_LABELS,
  FLOW_LABELS,
  RSVP_LABELS,
  STAGE_LABELS,
  courtesyState,
  guestFlags
} from "@/lib/admin-dashboard-model";
import type { AdminGuestRow } from "@/lib/admin-dashboard-types";
import {
  ADMIN_BUTTON,
  BackLink,
  Field,
  Panel,
  PanelHeading,
  StatusPill
} from "@/components/dashboard/AdminPrimitives";
import { cn } from "@/lib/utils";

export type GuestActionKind = "attending" | "declined" | "child" | "remove";

export function GuestDetailScreen({
  guest,
  backHref,
  onBack,
  onOpenGuest,
  onOpenInvitation,
  onGuestAction
}: {
  guest: AdminGuestRow;
  backHref: string;
  onBack: (event: MouseEvent) => void;
  onOpenGuest: (guestId: string) => void;
  onOpenInvitation: (invitationCode: string) => void;
  onGuestAction: (kind: GuestActionKind) => void;
}) {
  const invitation = guest.invitation;
  const status = RSVP_LABELS[guest.rsvpStatus];
  const primary = guest.sortOrder === 1;
  const role = primary ? "Principal" : "Acompanhante";
  const siblings = invitation.guests.filter((other) => other.guestId !== guest.guestId);

  const actions: { kind: GuestActionKind; label: string; danger: boolean; disabled: boolean }[] = [
    {
      kind: "attending",
      label: "Marcar como confirmado",
      danger: false,
      disabled: guest.rsvpStatus === "attending"
    },
    {
      kind: "declined",
      label: "Marcar como não vai",
      danger: false,
      disabled: guest.rsvpStatus === "declined"
    },
    {
      kind: "child",
      label: guest.isChild ? "Desmarcar como criança" : "Marcar como criança",
      danger: false,
      disabled: false
    },
    { kind: "remove", label: "Remover do convite", danger: true, disabled: false }
  ];

  return (
    <div>
      <BackLink href={backHref} onClick={onBack}>
        <ChevronRight className="size-4 shrink-0 rotate-180" strokeWidth={1.7} aria-hidden="true" />
        VOLTAR PARA CONVIDADOS
      </BackLink>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
        <div className="flex items-center gap-[22px]">
          <span
            aria-hidden="true"
            className="flex size-[74px] shrink-0 items-center justify-center rounded-full bg-admin-mute-bg font-admin-serif text-[26px] text-admin-ink-soft"
          >
            {initials(guest.guestName)}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={cn(
                  "rounded-full px-2.5 py-[3px] text-[11.5px] font-medium tracking-[0.06em]",
                  primary
                    ? "bg-admin-role-bg text-admin-role-fg"
                    : "bg-admin-mute-bg text-admin-mute-fg"
                )}
              >
                {role.toUpperCase()}
              </span>
              {guest.isChild && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-warn-bg px-2.5 py-[3px] text-[11.5px] font-medium tracking-[0.06em] text-admin-warn-fg">
                  <Baby className="size-3 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                  CRIANÇA
                </span>
              )}
              {guest.isChildSixOrYounger === true && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-gold-tint px-2.5 py-[3px] text-[11.5px] font-medium tracking-[0.06em] text-admin-gold">
                  <Flag className="size-3 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                  CORTESIA
                </span>
              )}
            </div>
            <h1 id="conteudo-titulo" className="mt-2.5 text-[clamp(2rem,4.5vw,2.875rem)] leading-[1.05]">
              {guest.guestName}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <StatusPill tone={status.tone} withDot className="text-[13px]">
                {status.label}
              </StatusPill>
              <span className="text-[13px] text-admin-faint">
                RSVP atualizado em {formatLongDate(invitation.rsvp.updatedAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2.5">
          <button
            type="button"
            className={ADMIN_BUTTON.primary}
            onClick={() => onOpenInvitation(invitation.invitationCode)}
          >
            Abrir convite {invitation.invitationCode}
          </button>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_430px] flex-col gap-6">
          <Panel className="px-7 py-[26px]">
            <h2 className="text-[25px]">Dados do convidado</h2>
            <dl className="mt-[22px] grid gap-[22px] sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] sm:gap-x-8">
              <Field
                label="ID DO CONVIDADO"
                value={<span className="admin-mono break-all text-[13px]">{guest.guestId}</span>}
              />
              <Field label="ORDEM NO CONVITE" value={String(guest.sortOrder)} />
              <Field
                label="PAPEL"
                value={primary ? "Principal · responde pelo convite" : "Acompanhante"}
              />
              <Field
                label="CRIANÇA (0–11 ANOS)"
                value={
                  guest.isChild ? "Sim · o RSVP pede a faixa etária" : "Não"
                }
              />
              <Field
                label="CORTESIA (≤6 ANOS)"
                value={
                  <>
                    {COURTESY_LABELS[courtesyState(guest)]}
                    <span className="mt-1 block text-[12.5px] leading-[1.45] text-admin-fainter">
                      Respondida pelo convidado no RSVP.
                    </span>
                  </>
                }
              />
              <Field
                label="ACOMPANHANTES PERMITIDOS"
                value={guest.allowedPlusOnes ? String(guest.allowedPlusOnes) : "—"}
              />
            </dl>
          </Panel>

          <Panel className="px-7 py-[26px]">
            <PanelHeading
              aside={
                siblings.length ? pluralize(siblings.length, "pessoa", "pessoas") : "Convite individual"
              }
            >
              Outros convidados do convite
            </PanelHeading>
            {siblings.length === 0 ? (
              <p className="mt-5 rounded-[11px] border border-dashed border-admin-line-strong px-4 py-5 text-[13.5px] leading-[1.5] text-admin-muted">
                Este convite tem apenas uma pessoa.
              </p>
            ) : (
              <ul className="mt-5 flex flex-col gap-2.5">
                {siblings.map((sibling) => {
                  const siblingStatus = RSVP_LABELS[sibling.rsvpStatus];
                  const siblingPrimary = invitation.guests[0]?.guestId === sibling.guestId;
                  const note = [
                    siblingPrimary ? "Principal" : "Acompanhante",
                    ...guestFlags(sibling),
                    sibling.guestId
                  ].join(" · ");
                  return (
                    <li key={sibling.guestId}>
                      <button
                        type="button"
                        onClick={() => onOpenGuest(sibling.guestId)}
                        aria-label={`Abrir ${sibling.guestName}. Situação: ${siblingStatus.label}.`}
                        className="flex w-full items-center gap-3.5 rounded-[11px] border border-admin-line-soft bg-admin-subtle px-4 py-3.5 text-left hover:bg-admin-inset-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
                      >
                        <span
                          aria-hidden="true"
                          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-admin-mute-bg text-[11.5px] font-semibold text-admin-ink-soft"
                        >
                          {initials(sibling.guestName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2.5">
                            <span className="text-[14.5px] font-medium">{sibling.guestName}</span>
                            {siblingPrimary && (
                              <span className="rounded-full bg-admin-role-bg px-2 py-0.5 text-[11px] font-medium tracking-[0.04em] text-admin-role-fg">
                                PRINCIPAL
                              </span>
                            )}
                          </span>
                          <span className="admin-mono mt-1 block break-all text-[12.5px] text-admin-fainter">
                            {note}
                          </span>
                        </span>
                        <StatusPill tone={siblingStatus.tone}>{siblingStatus.label}</StatusPill>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-6">
          <Panel className="px-[26px] py-6">
            <h2 className="text-[22px]">Convite</h2>
            <button
              type="button"
              onClick={() => onOpenInvitation(invitation.invitationCode)}
              className="mt-4 w-full rounded-[11px] border border-admin-line-gold bg-admin-gold-pale p-4 text-left hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
            >
              <span className="admin-mono block text-[12.5px] tracking-[0.1em] text-admin-gold">
                {invitation.invitationCode}
              </span>
              <span className="mt-1.5 block text-[15px] font-medium text-admin-gold-ink">
                {invitation.householdName}
              </span>
              <span className="mt-1 block text-[13px] text-admin-gold">
                {formatPhone(invitation.phoneNumber)}
              </span>
            </button>
            <dl className="mt-[18px] flex flex-col gap-3.5">
              <Field
                label="FLUXO DE WHATSAPP"
                value={FLOW_LABELS[invitation.whatsappFlowStatus].label}
              />
              <Field label="ETAPA DO FLUXO" value={STAGE_LABELS[invitation.whatsappFlowStage]} />
              <Field
                label="RSVP DO CONVITE"
                value={`${RSVP_LABELS[invitation.rsvp.status].label} · ${invitation.rsvp.attending} de ${invitation.guests.length}`}
              />
            </dl>
          </Panel>

          <Panel className="px-[26px] py-6">
            <h2 className="text-[22px]">Ações</h2>
            <div className="mt-4 flex flex-col gap-2">
              {actions.map((action) => (
                <button
                  key={action.kind}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => onGuestAction(action.kind)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-3 rounded-[10px] border px-3.5 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink",
                    action.disabled
                      ? "cursor-default border-admin-line-soft bg-admin-shade text-admin-ink opacity-45"
                      : action.danger
                        ? "border-admin-danger-edge bg-admin-danger-face text-admin-danger hover:brightness-[0.98]"
                        : "border-admin-line bg-admin-subtle text-admin-ink hover:bg-admin-sunken"
                  )}
                >
                  {action.label}
                  <ChevronRight className="size-4 shrink-0 opacity-30" strokeWidth={1.7} aria-hidden="true" />
                </button>
              ))}
              <p className="mt-1 text-[12.5px] leading-[1.5] text-admin-fainter [text-wrap:pretty]">
                {primary
                  ? "Convidado principal: não pode ser removido do convite. Para retirá-lo, é preciso excluir o convite inteiro."
                  : `Mudanças de status recalculam o RSVP do convite ${invitation.invitationCode}.`}
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
