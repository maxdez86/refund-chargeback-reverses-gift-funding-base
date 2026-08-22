import { ChevronRight } from "lucide-react";
import { formatLongDate, formatShortDate, pluralize } from "@/lib/admin-dashboard-format";
import { filterMusicSuggestions } from "@/lib/admin-dashboard-model";
import type { AdminMusicSuggestion } from "@/lib/admin-dashboard-types";
import {
  PageHeader,
  SearchField,
  StatCard
} from "@/components/dashboard/AdminPrimitives";

const COLUMNS = "grid-cols-[1.1fr_1.6fr_3fr_1fr_28px]";

export function MusicScreen({
  suggestions,
  invitationCount,
  query,
  onQueryChange,
  onOpenInvitation
}: {
  /** Already newest first; see `toMusicSuggestionRows`. */
  suggestions: AdminMusicSuggestion[];
  invitationCount: number;
  query: string;
  onQueryChange: (next: string) => void;
  onOpenInvitation: (invitationCode: string) => void;
}) {
  const visible = filterMusicSuggestions(suggestions, query);
  const fromAttending = suggestions.filter(
    (suggestion) => suggestion.rsvpStatus === "attending"
  ).length;
  const coverage = invitationCount
    ? Math.round((suggestions.length / invitationCount) * 100)
    : 0;

  return (
    <div>
      <PageHeader
        id="conteudo-titulo"
        eyebrow="SUGESTÕES DOS CONVIDADOS"
        title="Músicas"
        description="Músicas que os convidados sugeriram logo depois de responder ao convite. Uma sugestão por convite, sempre a mais recente."
      />

      <div className="mt-9 grid gap-[18px] sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <StatCard
          label="MÚSICAS SUGERIDAS"
          value={String(suggestions.length)}
          hint="enviadas com o RSVP"
        />
        <StatCard
          label="DE CONFIRMADOS"
          value={String(fromAttending)}
          hint="quem vai à festa"
          valueClassName="text-admin-ok-fg"
        />
        <StatCard
          label="COBERTURA"
          value={`${coverage}%`}
          hint={`de ${pluralize(invitationCount, "convite", "convites")}`}
          valueClassName="text-admin-gold"
        />
        <StatCard
          label="ÚLTIMA SUGESTÃO"
          value={suggestions.length ? formatShortDate(suggestions[0].suggestedAt) : "—"}
          valueClassName="text-admin-gold"
        />
      </div>

      <div className="mt-[34px] overflow-hidden rounded-[14px] border border-admin-line bg-admin-surface">
        <div className="flex flex-wrap items-center gap-3.5 border-b border-admin-line px-[22px] py-4">
          <SearchField
            label="Buscar músicas"
            value={query}
            onChange={onQueryChange}
            placeholder="Buscar por música, convite ou código"
          />
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[880px]">
            {/* Column headings are decorative: each row button carries its own summary label. */}
            <div
              aria-hidden="true"
              className={`grid ${COLUMNS} gap-[18px] border-b border-admin-line bg-admin-subtle px-[22px] py-3 text-[11px] font-medium tracking-[0.13em] text-admin-faint`}
            >
              <div>CÓDIGO</div>
              <div>CONVITE</div>
              <div>MÚSICA</div>
              <div>DATA</div>
              <div />
            </div>

            <ul aria-label="Músicas sugeridas">
              {visible.map((suggestion) => (
                <li key={suggestion.invitationCode}>
                  <button
                    type="button"
                    onClick={() => onOpenInvitation(suggestion.invitationCode)}
                    aria-label={`Abrir convite ${suggestion.invitationCode}, ${suggestion.householdName}. Música sugerida: ${suggestion.music}. Enviada em ${formatLongDate(suggestion.suggestedAt)}.`}
                    className={`grid ${COLUMNS} w-full items-center gap-[18px] border-b border-admin-line-soft px-[22px] py-4 text-left transition-colors hover:bg-admin-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-admin-ink`}
                  >
                    <span className="admin-mono block truncate text-[13px] font-medium tracking-[0.04em] text-admin-gold">
                      {suggestion.invitationCode}
                    </span>

                    <span className="block truncate text-sm text-admin-ink-soft">
                      {suggestion.householdName}
                    </span>

                    <span className="block min-w-0 line-clamp-2 font-admin-serif text-[17px] leading-[1.4] text-admin-ink [text-wrap:pretty]">
                      {suggestion.music}
                    </span>

                    <span className="block text-[12.5px] tabular-nums text-admin-faint">
                      {formatLongDate(suggestion.suggestedAt)}
                    </span>

                    <span className="flex justify-end opacity-35">
                      <ChevronRight className="size-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {visible.length === 0 && (
              <p className="px-[22px] py-10 text-center text-sm text-admin-faint">
                Nenhuma música corresponde a esta busca.
              </p>
            )}
          </div>
        </div>

        <p className="px-[22px] py-4 text-[13px] text-admin-faint">
          Mostrando {visible.length} de {suggestions.length} músicas
        </p>
      </div>
    </div>
  );
}
