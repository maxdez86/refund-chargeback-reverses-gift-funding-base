import { ChevronRight, Flag } from "lucide-react";
import { initials, pluralize } from "@/lib/admin-dashboard-format";
import {
  GUEST_FILTERS,
  RSVP_LABELS,
  filterGuests,
  type GuestFilter
} from "@/lib/admin-dashboard-model";
import type { AdminGuestRow } from "@/lib/admin-dashboard-types";
import {
  FilterTabs,
  PageHeader,
  SearchField,
  StatCard,
  StatusPill
} from "@/components/dashboard/AdminPrimitives";
import { WEDDING_DATE_LABEL } from "@/components/dashboard/constants";

const COLUMNS = "grid-cols-[2.4fr_1.7fr_1.1fr_1.1fr_1fr_28px]";

export function GuestsScreen({
  guests,
  invitationCount,
  filter,
  query,
  onFilterChange,
  onQueryChange,
  onOpenGuest
}: {
  guests: AdminGuestRow[];
  invitationCount: number;
  filter: GuestFilter;
  query: string;
  onFilterChange: (next: GuestFilter) => void;
  onQueryChange: (next: string) => void;
  onOpenGuest: (guestId: string) => void;
}) {
  const visible = filterGuests(guests, filter, query);
  const attending = guests.filter((guest) => guest.rsvpStatus === "attending").length;
  const pending = guests.filter((guest) => guest.rsvpStatus === "pending").length;
  const courtesies = guests.filter((guest) => guest.isChildSixOrYounger === true).length;
  const attendingPercent = guests.length ? Math.round((attending / guests.length) * 100) : 0;

  return (
    <div>
      <PageHeader
        id="conteudo-titulo"
        eyebrow={WEDDING_DATE_LABEL}
        title="Convidados"
        description="Uma linha por pessoa. Vários convidados podem pertencer ao mesmo convite."
      />

      <div className="mt-9 grid gap-[18px] sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <StatCard
          label="CONVIDADOS"
          value={String(guests.length)}
          hint={pluralize(invitationCount, "convite", "convites")}
        />
        <StatCard
          label="CONFIRMADOS"
          value={String(attending)}
          hint={`${attendingPercent}%`}
          valueClassName="text-admin-ok-fg"
        />
        <StatCard
          label="PENDENTES"
          value={String(pending)}
          hint="sem resposta"
          valueClassName="text-admin-gold"
        />
        <StatCard
          label="CORTESIAS"
          value={String(courtesies)}
          hint="crianças até 6 anos"
          valueClassName="text-admin-gold"
        />
      </div>

      <div className="mt-[34px] overflow-hidden rounded-[14px] border border-admin-line bg-admin-surface">
        <div className="flex flex-wrap items-center gap-3.5 border-b border-admin-line px-[22px] py-4">
          <SearchField
            label="Buscar convidados"
            value={query}
            onChange={onQueryChange}
            placeholder="Buscar por nome ou código do convite"
          />
          <FilterTabs
            className="sm:ml-auto"
            label="Filtrar convidados"
            options={GUEST_FILTERS}
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
              <div>CONVIDADO</div>
              <div>CONVITE</div>
              <div>PAPEL</div>
              <div>CORTESIA</div>
              <div>SITUAÇÃO</div>
              <div />
            </div>

            <ul aria-label="Convidados">
              {visible.map((guest) => {
                const status = RSVP_LABELS[guest.rsvpStatus];
                const primary = guest.sortOrder === 1;
                const role = primary ? "Principal" : "Acompanhante";
                return (
                  <li key={guest.guestId}>
                    <button
                      type="button"
                      onClick={() => onOpenGuest(guest.guestId)}
                      aria-label={`Abrir ${guest.guestName}. Convite ${guest.invitationCode}, ${guest.householdName}. ${role}${guest.isChildSixOrYounger === true ? ", cortesia" : ""}. Situação: ${status.label}.`}
                      className={`grid ${COLUMNS} w-full items-center gap-[18px] border-b border-admin-line-soft px-[22px] py-4 text-left transition-colors hover:bg-admin-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-admin-ink`}
                    >
                      <span className="flex min-w-0 items-center gap-3.5">
                        <span
                          aria-hidden="true"
                          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-admin-mute-bg text-xs font-semibold text-admin-ink-soft"
                        >
                          {initials(guest.guestName)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[14.5px] font-medium">
                            {guest.guestName}
                          </span>
                          <span className="admin-mono block truncate text-[11.5px] text-admin-fainter">
                            {guest.guestId}
                          </span>
                        </span>
                      </span>

                      <span className="block min-w-0">
                        <span className="block truncate text-sm text-admin-ink-soft">
                          {guest.householdName}
                        </span>
                        <span className="admin-mono block text-[11.5px] tracking-[0.04em] text-admin-gold">
                          {guest.invitationCode}
                        </span>
                      </span>

                      <span className="block">
                        <span
                          className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium tracking-[0.03em] ${
                            primary
                              ? "bg-admin-role-bg text-admin-role-fg"
                              : "bg-admin-mute-bg text-admin-mute-fg"
                          }`}
                        >
                          {role}
                        </span>
                      </span>

                      <span className="block">
                        {guest.isChildSixOrYounger === true && (
                          <span className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-full bg-admin-gold-tint px-[11px] py-[5px] text-[12.5px] font-medium text-admin-gold">
                            <Flag className="size-3.5 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                            Cortesia
                          </span>
                        )}
                      </span>

                      <span className="block">
                        <StatusPill tone={status.tone} withDot>
                          {status.label}
                        </StatusPill>
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
                Nenhum convidado corresponde a esta busca.
              </p>
            )}
          </div>
        </div>

        <p className="px-[22px] py-4 text-[13px] text-admin-faint">
          Mostrando {visible.length} de {guests.length} convidados
        </p>
      </div>
    </div>
  );
}
