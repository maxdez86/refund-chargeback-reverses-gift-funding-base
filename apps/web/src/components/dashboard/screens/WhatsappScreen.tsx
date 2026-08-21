import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ChevronRight, MessageCircle } from "lucide-react";
import {
  dayKey,
  formatClockTime,
  formatDayLabel,
  formatPhone,
  initials,
  pluralize
} from "@/lib/admin-dashboard-format";
import {
  CHAT_FILTERS,
  RSVP_LABELS,
  TEMPLATE_LABELS,
  TONE_CLASSES,
  type ChatFilter
} from "@/lib/admin-dashboard-model";
import type { AdminInvitation, AdminWhatsappMessage } from "@/lib/admin-dashboard-types";
import { Eyebrow, FilterTabs, SearchField, StatusPill } from "@/components/dashboard/AdminPrimitives";
import { cn } from "@/lib/utils";

type Conversation = {
  invitation: AdminInvitation;
  thread: AdminWhatsappMessage[];
  last: AdminWhatsappMessage | null;
  unread: number;
};

/** Splits a thread into consecutive same-day runs, the way a chat client does. */
export function groupByDay(thread: AdminWhatsappMessage[]) {
  const groups: { key: string; label: string; items: AdminWhatsappMessage[] }[] = [];
  for (const message of thread) {
    const key = dayKey(message.sentAt);
    const current = groups.at(-1);
    if (current?.key === key) {
      current.items.push(message);
    } else {
      groups.push({ key, label: formatDayLabel(message.sentAt), items: [message] });
    }
  }
  return groups;
}

export function WhatsappScreen({
  invitations,
  threads,
  unreadByCode,
  selectedCode,
  filter,
  query,
  onFilterChange,
  onQueryChange,
  onSelect,
  onClearSelection,
  onOpenInvitation,
  onSend
}: {
  invitations: AdminInvitation[];
  threads: Record<string, AdminWhatsappMessage[]>;
  unreadByCode: Record<string, number>;
  selectedCode?: string;
  filter: ChatFilter;
  query: string;
  onFilterChange: (next: ChatFilter) => void;
  onQueryChange: (next: string) => void;
  onSelect: (invitationCode: string) => void;
  onClearSelection: () => void;
  onOpenInvitation: (invitationCode: string) => void;
  onSend: (invitationCode: string, text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversations: Conversation[] = invitations
    .map((invitation) => {
      const thread = threads[invitation.invitationCode] ?? [];
      return {
        invitation,
        thread,
        last: thread.at(-1) ?? null,
        unread: unreadByCode[invitation.invitationCode] ?? 0
      };
    })
    .sort((a, b) => (b.last?.sentAt ?? "").localeCompare(a.last?.sentAt ?? ""));

  const needle = query.trim().toLowerCase();
  const visible = conversations.filter((conversation) => {
    if (filter === "Não lidas" && !conversation.unread) return false;
    if (filter === "Pendentes" && conversation.invitation.rsvp.status !== "pending") return false;
    if (!needle) return true;
    const { invitationCode, householdName, phoneNumber } = conversation.invitation;
    return `${householdName} ${invitationCode} ${phoneNumber}`.toLowerCase().includes(needle);
  });

  const selected = conversations.find(
    (conversation) => conversation.invitation.invitationCode === selectedCode
  );
  const unreadTotal = conversations.reduce((sum, conversation) => sum + conversation.unread, 0);

  useEffect(() => setDraft(""), [selectedCode]);

  // Chats open at the newest message, and stay pinned there as new ones arrive.
  const threadLength = selected?.thread.length ?? 0;
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [selectedCode, threadLength]);

  const send = () => {
    if (!selectedCode || !draft.trim()) return;
    onSend(selectedCode, draft);
    setDraft("");
  };

  return (
    <div className="flex min-h-[620px] flex-col lg:h-[calc(100dvh-9rem)]">
      <div className="flex flex-none flex-wrap items-end justify-between gap-6">
        <div>
          <Eyebrow>CONVERSAS</Eyebrow>
          <h1 id="conteudo-titulo" className="mt-2 text-[clamp(2rem,4.5vw,2.75rem)] leading-[1.05]">
            WhatsApp
          </h1>
        </div>
        <p className="pb-1.5 text-[13.5px] text-admin-ink-soft">
          {unreadTotal} sem resposta · {pluralize(visible.length, "conversa", "conversas")}
        </p>
      </div>

      <div className="mt-[26px] flex min-h-0 flex-1 overflow-hidden rounded-[14px] border border-admin-line bg-admin-surface">
        <div
          className={cn(
            "flex min-h-0 w-full flex-col border-admin-line bg-admin-subtle md:w-[34%] md:min-w-[250px] md:max-w-[336px] md:flex-none md:border-r",
            selected && "hidden md:flex"
          )}
        >
          <div className="flex flex-none flex-col gap-3 px-[18px] pb-3.5 pt-[18px]">
            <SearchField
              className="max-w-none bg-admin-surface"
              label="Buscar conversa"
              value={query}
              onChange={onQueryChange}
              placeholder="Buscar conversa"
            />
            <FilterTabs
              label="Filtrar conversas"
              options={CHAT_FILTERS}
              value={filter}
              onChange={onFilterChange}
            />
          </div>

          <ul aria-label="Conversas" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {visible.map((conversation) => {
              const { invitation, last, unread } = conversation;
              const status = RSVP_LABELS[invitation.rsvp.status];
              const active = invitation.invitationCode === selectedCode;
              const dayLabel = last ? formatDayLabel(last.sentAt) : "";
              const time = !last
                ? "—"
                : dayLabel === "Hoje"
                  ? formatClockTime(last.sentAt)
                  : dayLabel.replace(` de ${new Date(last.sentAt).getFullYear()}`, "");
              return (
                <li key={invitation.invitationCode}>
                  <button
                    type="button"
                    onClick={() => onSelect(invitation.invitationCode)}
                    aria-current={active ? "true" : undefined}
                    aria-label={`Conversa com ${invitation.householdName}${unread ? `, ${pluralize(unread, "mensagem não lida", "mensagens não lidas")}` : ""}`}
                    className={cn(
                      "flex w-full gap-3 rounded-[11px] px-3 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink",
                      active ? "bg-admin-gold-tint" : "hover:bg-admin-sunken"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-admin-mute-bg text-[12.5px] font-semibold tracking-[0.03em] text-admin-ink-soft"
                    >
                      {initials(invitation.householdName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2.5">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-[14.5px]",
                            unread > 0 ? "font-semibold" : "font-medium"
                          )}
                        >
                          {invitation.householdName}
                        </span>
                        <span className="flex-none text-[11.5px] tabular-nums text-admin-faint">
                          {time}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-admin-slate">
                          {last
                            ? `${last.direction === "outbound" ? "Você: " : ""}${last.text}`
                            : "Sem mensagens"}
                        </span>
                        {unread > 0 && (
                          <span className="flex h-[19px] min-w-[19px] flex-none items-center justify-center rounded-full bg-admin-ok-fg px-1.5 text-[11.5px] font-semibold text-white">
                            {unread}
                          </span>
                        )}
                      </span>
                      <span className="mt-1.5 block">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium tracking-[0.04em] ${TONE_CLASSES[status.tone]}`}
                        >
                          {status.label}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="px-3 py-8 text-center text-[13px] text-admin-faint">
                Nenhuma conversa corresponde a este filtro.
              </li>
            )}
          </ul>
        </div>

        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !selected && "hidden md:flex")}>
          {selected ? (
            <>
              <div className="flex flex-none flex-wrap items-center gap-3.5 border-b border-admin-line bg-admin-subtle px-6 py-4">
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="-ml-2 flex size-11 items-center justify-center rounded-lg text-admin-ink-soft hover:bg-admin-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink md:hidden"
                >
                  <ChevronRight className="size-5 rotate-180" strokeWidth={1.7} aria-hidden="true" />
                  <span className="sr-only">Voltar para as conversas</span>
                </button>
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-admin-mute-bg text-[12.5px] font-semibold text-admin-ink-soft"
                >
                  {initials(selected.invitation.householdName)}
                </span>
                <div className="min-w-[150px] flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="truncate font-admin-sans text-base font-semibold">
                      {selected.invitation.householdName}
                    </h2>
                    <StatusPill
                      tone={RSVP_LABELS[selected.invitation.rsvp.status].tone}
                      className="px-2.5 py-0.5 text-[11.5px] tracking-[0.05em]"
                    >
                      {RSVP_LABELS[selected.invitation.rsvp.status].label}
                    </StatusPill>
                  </div>
                  <p className="mt-1 text-[13px] tabular-nums text-admin-slate">
                    {formatPhone(selected.invitation.phoneNumber)} ·{" "}
                    {selected.invitation.invitationCode} ·{" "}
                    {pluralize(selected.invitation.guests.length, "convidado", "convidados")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenInvitation(selected.invitation.invitationCode)}
                  className="ml-auto flex min-h-11 flex-none items-center gap-2 rounded-[9px] border border-admin-line-strong bg-admin-surface px-4 text-[13.5px] font-medium text-admin-ink hover:bg-admin-gold-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
                >
                  Abrir convite
                  <ChevronRight className="size-[15px] shrink-0 opacity-35" strokeWidth={1.7} aria-hidden="true" />
                </button>
              </div>

              <div
                ref={scrollRef}
                className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto bg-admin-canvas px-5 py-[26px] sm:px-[30px]"
              >
                {groupByDay(selected.thread).map((group) => (
                  <div key={group.key} className="flex flex-col gap-2.5">
                    <span className="self-center rounded-full bg-admin-mute-bg px-3 py-1 text-[11.5px] font-medium tracking-[0.08em] text-admin-slate">
                      {group.label}
                    </span>
                    {group.items.map((message, index) => {
                      const mine = message.direction === "outbound";
                      return (
                        <div
                          key={`${group.key}-${index}`}
                          className={cn("flex", mine ? "justify-end" : "justify-start")}
                        >
                          <div
                            className={cn(
                              "max-w-[min(560px,78%)] border px-[15px] py-3",
                              mine
                                ? "rounded-[14px_14px_4px_14px] border-admin-line-gold bg-admin-bubble-out"
                                : "rounded-[14px_14px_14px_4px] border-admin-line bg-admin-surface"
                            )}
                          >
                            {message.templateId && (
                              <p className="mb-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-admin-gold">
                                {TEMPLATE_LABELS[message.templateId]}
                              </p>
                            )}
                            <p className="whitespace-pre-wrap text-[14.5px] leading-[1.5] text-admin-ink [text-wrap:pretty]">
                              {message.text}
                            </p>
                            <p
                              className={cn(
                                "mt-1.5 text-right text-[11px] tabular-nums",
                                message.failed ? "text-admin-danger" : "text-admin-faint"
                              )}
                            >
                              {mine
                                ? message.failed
                                  ? "Falha no envio"
                                  : `Enviado ${formatClockTime(message.sentAt)}`
                                : formatClockTime(message.sentAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="flex flex-none items-end gap-3 border-t border-admin-line bg-admin-surface px-[22px] py-4">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Resposta para o convidado</span>
                  <textarea
                    rows={1}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        send();
                      }
                    }}
                    placeholder="Escreva uma resposta para o convidado"
                    className="max-h-[120px] w-full resize-none rounded-[11px] border border-admin-line-strong bg-admin-subtle px-[15px] py-3 text-[14.5px] leading-[1.5] text-admin-ink outline-none focus:border-admin-ink"
                  />
                </label>
                <button
                  type="button"
                  onClick={send}
                  disabled={!draft.trim()}
                  className={cn(
                    "flex min-h-11 flex-none items-center gap-2.5 rounded-[11px] px-5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink",
                    draft.trim()
                      ? "bg-admin-ink text-white hover:bg-admin-ink-hover"
                      : "cursor-not-allowed bg-admin-send-off text-admin-fainter"
                  )}
                >
                  Enviar
                  <ArrowRight className="size-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-admin-canvas p-10">
              <MessageCircle className="size-7 opacity-30" strokeWidth={1.7} aria-hidden="true" />
              <p className="font-admin-serif text-[26px]">Nenhuma conversa aberta</p>
              <p className="max-w-[300px] text-center text-sm leading-[1.55] text-admin-slate">
                Escolha um convite na lista para ler o histórico e responder.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
