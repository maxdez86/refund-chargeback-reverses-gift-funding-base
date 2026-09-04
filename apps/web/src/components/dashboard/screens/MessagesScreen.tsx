import { Trash2 } from "lucide-react";
import { formatLongDate, formatShortDate, initials } from "@/lib/admin-dashboard-format";
import type { AdminGuestMessage } from "@/lib/admin-dashboard-types";
import {
  PageHeader,
  SearchField,
  StatCard
} from "@/components/dashboard/AdminPrimitives";

export function MessagesScreen({
  messages,
  query,
  onQueryChange,
  onDelete
}: {
  messages: AdminGuestMessage[];
  query: string;
  onQueryChange: (next: string) => void;
  onDelete: (messageId: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const sorted = [...messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visible = sorted.filter(
    (message) =>
      !needle || `${message.authorName} ${message.message}`.toLowerCase().includes(needle)
  );

  return (
    <div>
      <PageHeader
        id="conteudo-titulo"
        eyebrow="MURAL DO SITE"
        title="Recados"
        description="Mensagens deixadas pelos convidados no site. Excluir um recado o remove do mural definitivamente."
      />

      <div className="mt-9 grid gap-[18px] sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <StatCard label="RECADOS RECEBIDOS" value={String(messages.length)} hint="no mural do site" />
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
      </div>

      <ul className="mt-5 flex flex-col gap-3.5">
        {visible.map((message) => (
          <li key={message.messageId}>
            <article className="flex flex-wrap items-start gap-6 rounded-[14px] border border-admin-line bg-admin-surface px-7 py-[26px]">
              <div className="min-w-0 flex-[1_1_300px]">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-admin-mute-bg text-[12.5px] font-semibold text-admin-ink-soft"
                  >
                    {initials(message.authorName)}
                  </span>
                  <div className="min-w-0">
                    <span className="text-[15.5px] font-medium">{message.authorName}</span>
                    <p className="mt-1 text-[12.5px] text-admin-faint">
                      {formatLongDate(message.createdAt)}
                    </p>
                  </div>
                </div>
                <p className="mt-[18px] whitespace-pre-line font-admin-serif text-[19px] leading-[1.55] text-admin-ink [text-wrap:pretty]">
                  {message.message}
                </p>
              </div>

              <div className="flex flex-[0_1_190px] flex-col items-stretch gap-2.5">
                <button
                  type="button"
                  onClick={() => onDelete(message.messageId)}
                  className="flex min-h-11 items-center justify-center gap-2.5 rounded-[9px] border border-admin-danger-edge bg-admin-surface px-3.5 text-[13.5px] font-medium text-admin-danger hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
                >
                  <Trash2 className="size-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                  Excluir recado
                </button>
                <p className="text-center text-xs leading-[1.5] text-admin-fainter">
                  Remove o recado do mural do site
                </p>
              </div>
            </article>
          </li>
        ))}
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
