import { Eye, EyeOff } from "lucide-react";
import { formatLongDate, formatShortDate, initials } from "@/lib/admin-dashboard-format";
import { MESSAGE_FILTERS, type MessageFilter } from "@/lib/admin-dashboard-model";
import type { AdminGuestMessage } from "@/lib/admin-dashboard-types";
import {
  FilterTabs,
  PageHeader,
  SearchField,
  StatCard
} from "@/components/dashboard/AdminPrimitives";
import { cn } from "@/lib/utils";

export function MessagesScreen({
  messages,
  filter,
  query,
  onFilterChange,
  onQueryChange,
  onToggleHidden
}: {
  messages: AdminGuestMessage[];
  filter: MessageFilter;
  query: string;
  onFilterChange: (next: MessageFilter) => void;
  onQueryChange: (next: string) => void;
  onToggleHidden: (messageId: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const sorted = [...messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visible = sorted.filter((message) => {
    const passesFilter =
      filter === "Todos" ||
      (filter === "No site" && !message.hidden) ||
      (filter === "Escondidos" && message.hidden);
    return (
      passesFilter &&
      (!needle || `${message.authorName} ${message.message}`.toLowerCase().includes(needle))
    );
  });
  const hiddenCount = messages.filter((message) => message.hidden).length;
  const publishedCount = messages.length - hiddenCount;

  return (
    <div>
      <PageHeader
        id="conteudo-titulo"
        eyebrow="MURAL DO SITE"
        title="Recados"
        description="Mensagens deixadas pelos convidados no site. Recados escondidos deixam de aparecer no mural, mas continuam guardados aqui."
      />

      <div className="mt-9 grid gap-[18px] sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <StatCard label="RECADOS RECEBIDOS" value={String(messages.length)} hint="no mural do site" />
        <StatCard
          label="PUBLICADOS"
          value={String(publishedCount)}
          hint="visíveis aos convidados"
          valueClassName="text-admin-ok-fg"
        />
        <StatCard
          label="ESCONDIDOS"
          value={String(hiddenCount)}
          hint="ocultos, mas salvos"
          valueClassName="text-admin-err-fg"
        />
        <StatCard
          label="ÚLTIMO RECEBIDO"
          value={sorted.length ? formatShortDate(sorted[0].createdAt) : "—"}
          valueClassName="text-admin-gold"
        />
      </div>

      <div className="mt-[34px] flex flex-wrap items-center gap-3.5">
        <SearchField
          className="bg-admin-surface"
          label="Buscar recados"
          value={query}
          onChange={onQueryChange}
          placeholder="Buscar por autor ou texto do recado"
        />
        <FilterTabs
          className="sm:ml-auto"
          label="Filtrar recados"
          options={MESSAGE_FILTERS}
          value={filter}
          onChange={onFilterChange}
        />
      </div>

      <ul className="mt-5 flex flex-col gap-3.5">
        {visible.map((message) => {
          const ToggleIcon = message.hidden ? Eye : EyeOff;
          return (
            <li key={message.messageId}>
              <article
                className={cn(
                  "flex flex-wrap items-start gap-6 rounded-[14px] border px-7 py-[26px]",
                  message.hidden
                    ? "border-admin-line-strong bg-admin-shade-soft"
                    : "border-admin-line bg-admin-surface"
                )}
              >
                <div className="min-w-0 flex-[1_1_300px]">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-admin-mute-bg text-[12.5px] font-semibold text-admin-ink-soft"
                    >
                      {initials(message.authorName)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-[15.5px] font-medium">{message.authorName}</span>
                        {message.hidden && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-mute-bg px-2.5 py-[3px] text-[11px] font-medium tracking-[0.05em] text-admin-mute-fg">
                            <EyeOff className="size-3 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                            ESCONDIDO DO SITE
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[12.5px] text-admin-faint">
                        {formatLongDate(message.createdAt)}
                      </p>
                    </div>
                  </div>
                  <p
                    className={cn(
                      "mt-[18px] whitespace-pre-line font-admin-serif text-[19px] leading-[1.55] [text-wrap:pretty]",
                      message.hidden ? "text-admin-faint" : "text-admin-ink"
                    )}
                  >
                    {message.message}
                  </p>
                </div>

                <div className="flex flex-[0_1_190px] flex-col items-stretch gap-2.5">
                  <button
                    type="button"
                    onClick={() => onToggleHidden(message.messageId)}
                    className={cn(
                      "flex min-h-11 items-center justify-center gap-2.5 rounded-[9px] border px-3.5 text-[13.5px] font-medium hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink",
                      message.hidden
                        ? "border-admin-ink bg-admin-ink text-white"
                        : "border-admin-danger-edge bg-admin-surface text-admin-danger"
                    )}
                  >
                    <ToggleIcon className="size-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                    {message.hidden ? "Mostrar no site" : "Esconder do site"}
                  </button>
                  <p className="text-center text-xs leading-[1.5] text-admin-fainter">
                    {message.hidden
                      ? "Não aparece no mural do site"
                      : "Some do mural, mas continua salvo aqui"}
                  </p>
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      {visible.length === 0 && (
        <p className="mt-5 rounded-[14px] border border-dashed border-admin-line-strong px-6 py-10 text-center text-sm text-admin-faint">
          Nenhum recado corresponde a esta busca.
        </p>
      )}

      <p className="mt-[22px] text-[13px] text-admin-faint">
        Mostrando {visible.length} de {messages.length} recados
      </p>
    </div>
  );
}
