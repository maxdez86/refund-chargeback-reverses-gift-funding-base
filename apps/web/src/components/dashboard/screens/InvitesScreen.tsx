import { ChevronRight, Flag, Users } from "lucide-react";
import { formatPhone, formatShortDate, initials, pluralize } from "@/lib/admin-dashboard-format";
import {
  FLOW_LABELS,
  INVITE_FILTERS,
  RSVP_LABELS,
  STAGE_LABELS,
  filterInvitations,
  needsAttention,
  type InviteFilter
} from "@/lib/admin-dashboard-model";
import type { AdminInvitation } from "@/lib/admin-dashboard-types";
import {
  ADMIN_BUTTON,
  FilterTabs,
  PageHeader,
  SearchField,
  StatCard,
  StatusPill
} from "@/components/dashboard/AdminPrimitives";
import { WEDDING_DATE_LABEL } from "@/components/dashboard/constants";

const COLUMNS = "grid-cols-[2.4fr_1.1fr_1.5fr_1.2fr_1fr_28px]";

export function InvitesScreen({
  invitations,
  filter,
  query,
  onFilterChange,
  onQueryChange,
  onOpenInvitation,
  onNewInvitation
}: {
  invitations: AdminInvitation[];
  filter: InviteFilter;
  query: string;
  onFilterChange: (next: InviteFilter) => void;
  onQueryChange: (next: string) => void;
  onOpenInvitation: (invitationCode: string) => void;
  onNewInvitation: () => void;
}) {
  const visible = filterInvitations(invitations, filter, query);
  const guestTotal = invitations.reduce((sum, invitation) => sum + invitation.guests.length, 0);
  const attending = invitations.filter((i) => i.rsvp.status === "attending").length;
  const pending = invitations.filter((i) => i.rsvp.status === "pending").length;
  const stuck = invitations.filter(needsAttention).length;
  const attendingPercent = invitations.length
    ? Math.round((attending / invitations.length) * 100)
    : 0;

  return (
    <div>
      <PageHeader
        id="conteudo-titulo"
        eyebrow={WEDDING_DATE_LABEL}
        title="Convites"
        description="Cada convite reúne um ou mais convidados sob um telefone e um código. O fluxo de WhatsApp e o RSVP acontecem neste nível."
        actions={
          <button type="button" className={ADMIN_BUTTON.primary} onClick={onNewInvitation}>
            Novo convite
          </button>
        }
      />

      <div className="mt-9 grid gap-[18px] sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <StatCard label="CONVITES" value={String(invitations.length)} hint={pluralize(guestTotal, "pessoa", "pessoas")} />
        <StatCard
          label="RSVP CONFIRMADO"
          value={String(attending)}
          hint={`${attendingPercent}%`}
          valueClassName="text-admin-ok-fg"
        />
        <StatCard
          label="AGUARDANDO RESPOSTA"
          value={String(pending)}
          hint="fluxo em andamento"
          valueClassName="text-admin-gold"
        />
        <StatCard
          label="REQUER ATENÇÃO"
          value={String(stuck)}
          hint="falha ou reconciliação"
          valueClassName="text-admin-err-fg"
        />
      </div>

      <div className="mt-[34px] overflow-hidden rounded-[14px] border border-admin-line bg-admin-surface">
        <div className="flex flex-wrap items-center gap-3.5 border-b border-admin-line px-[22px] py-4">
          <SearchField
            label="Buscar convites"
            value={query}
            onChange={onQueryChange}
            placeholder="Buscar por código, família ou telefone"
          />
          <FilterTabs
            className="sm:ml-auto"
            label="Filtrar convites"
            options={INVITE_FILTERS}
            value={filter}
            onChange={onFilterChange}
          />
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[1040px]">
            {/* Column headings are decorative: each row button carries its own summary label. */}
            <div
              aria-hidden="true"
              className={`grid ${COLUMNS} gap-[18px] border-b border-admin-line bg-admin-subtle px-[22px] py-3 text-[11px] font-medium tracking-[0.13em] text-admin-faint`}
            >
              <div>CONVITE</div>
              <div>CONVIDADOS</div>
              <div>FLUXO WHATSAPP</div>
              <div>RSVP</div>
              <div>ATUALIZADO</div>
              <div />
            </div>

            <ul aria-label="Convites">
            {visible.map((invitation) => {
              const flow = FLOW_LABELS[invitation.whatsappFlowStatus];
              const rsvp = RSVP_LABELS[invitation.rsvp.status];
              const courtesies = invitation.guests.filter(
                (guest) => guest.isChildSixOrYounger === true
              ).length;
              return (
                <li key={invitation.invitationCode}>
                <button
                  type="button"
                  onClick={() => onOpenInvitation(invitation.invitationCode)}
                  aria-label={`Abrir convite ${invitation.invitationCode}, ${invitation.householdName}. ${pluralize(invitation.guests.length, "pessoa", "pessoas")}. Fluxo: ${flow.label}. RSVP: ${rsvp.label}.`}
                  className={`grid ${COLUMNS} w-full items-center gap-[18px] border-b border-admin-line-soft px-[22px] py-4 text-left transition-colors hover:bg-admin-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-admin-ink`}
                >
                  <span className="flex min-w-0 items-center gap-3.5">
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-admin-mute-bg text-xs font-semibold text-admin-ink-soft"
                    >
                      {initials(invitation.householdName)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] font-medium">
                        {invitation.householdName}
                      </span>
                      <span className="flex items-center gap-2 text-[12.5px] text-admin-faint">
                        <span className="admin-mono tracking-[0.04em] text-admin-gold">
                          {invitation.invitationCode}
                        </span>
                        <span className="opacity-50">·</span>
                        <span>{formatPhone(invitation.phoneNumber)}</span>
                      </span>
                    </span>
                  </span>

                  <span className="flex items-center gap-2">
                    <Users className="size-[15px] shrink-0 opacity-45" strokeWidth={1.7} aria-hidden="true" />
                    <span className="text-sm tabular-nums text-admin-ink-soft">
                      {pluralize(invitation.guests.length, "pessoa", "pessoas")}
                    </span>
                    {courtesies > 0 && (
                      <Flag
                        className="size-3.5 shrink-0 text-admin-gold"
                        strokeWidth={1.7}
                        aria-label="Inclui cortesia"
                      />
                    )}
                  </span>

                  <span className="block">
                    <StatusPill tone={flow.tone} withDot>
                      {flow.label}
                    </StatusPill>
                    <span className="mt-1.5 block text-[11.5px] tracking-[0.06em] text-admin-fainter">
                      Etapa · {STAGE_LABELS[invitation.whatsappFlowStage]}
                    </span>
                  </span>

                  <span className="block">
                    <StatusPill tone={rsvp.tone}>{rsvp.label}</StatusPill>
                    <span className="mt-1.5 block text-[11.5px] text-admin-fainter">
                      {invitation.rsvp.status === "attending"
                        ? `${invitation.rsvp.attending} de ${invitation.guests.length} · ${invitation.rsvp.paid} pagantes`
                        : "Sem lugares confirmados"}
                    </span>
                  </span>

                  <span className="text-[13px] tabular-nums text-admin-faint">
                    {formatShortDate(invitation.whatsappFlowUpdatedAt)}
                  </span>

                  <span className="flex justify-end opacity-35">
                    <ChevronRight className="size-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                  </span>
                </button>
                </li>
              );
            })}
            </ul>

            {visible.length === 0 && (
              <p className="px-[22px] py-10 text-center text-sm text-admin-faint">
                Nenhum convite corresponde a esta busca.
              </p>
            )}
          </div>
        </div>

        <p className="px-[22px] py-4 text-[13px] text-admin-faint">
          Mostrando {visible.length} de {invitations.length} convites
        </p>
      </div>
    </div>
  );
}
