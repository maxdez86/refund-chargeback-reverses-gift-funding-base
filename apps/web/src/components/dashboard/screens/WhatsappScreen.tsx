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
  TONE_CLASSES,
  messageFallback,
  templateLabel,
  type ChatFilter
} from "@/lib/admin-dashboard-model";
import type {
  AdminInvitation,
  AdminWhatsappConversationSummary,
  AdminWhatsappMessage,
  AdminWhatsappThreadLoadState
} from "@/lib/admin-dashboard-types";
import type { AdminWhatsappSendState } from "@/hooks/use-admin-dashboard";
import { Eyebrow, FilterTabs, SearchField, StatusPill } from "@/components/dashboard/AdminPrimitives";
import { cn } from "@/lib/utils";

export type Conversation = {
  invitation: AdminInvitation;
  /** Never `null`: the tab lists exactly the invitations that own at least one message. */
  summary: AdminWhatsappConversationSummary;
  thread: AdminWhatsappMessage[];
  last: AdminWhatsappMessage | null;
  unread: number | null;
  load: AdminWhatsappThreadLoadState;
  /** Whether the newest page is in `thread`; the summary is the truth until it is. */
  loaded: boolean;
  /** Newest known timestamp — from the loaded thread once loaded, else from the summary. */
  lastAt: string;
};

/** Whether the newest page is in the local thread; mirrors the store's own load check. */
function hasNewestPage(load: AdminWhatsappThreadLoadState) {
  if (load.status === "loaded") return true;
  return (load.status === "loading" || load.status === "error") && load.hasLoaded;
}

/**
 * The list row's preview line. The loaded thread wins the moment its newest page arrives and the
 * summary is the only source before that, so the two can never be rendered against each other.
 */
export function conversationPreview(conversation: Conversation) {
  const { summary, last, load, loaded } = conversation;
  if (loaded) {
    if (!last) return "Sem mensagens";
    return `${last.direction === "outbound" ? "Você: " : ""}${last.text}`;
  }
  if (load.status === "loading") return "Carregando…";
  const text =
    summary.lastMessagePreview ??
    messageFallback({
      templateId: summary.lastMessageTemplateId,
      messageType: summary.lastMessageType
    });
  return `${summary.lastMessageDirection === "outbound" ? "Você: " : ""}${text}`;
}

/**
 * Whether the load-older control has anything left to fetch.
 *
 * A cursor alone does not prove it: the API hands back a `LastEvaluatedKey` whenever the page
 * limit was consumed, so a conversation that is already fully loaded can still carry one, and
 * offering the control there costs a request to learn nothing. The dashboard summary supplies the
 * second half of the proof — but it was taken at snapshot time, so anything newer than
 * `lastMessageAt` (a guest reply that arrived since, a message the operator just typed) was never
 * counted by it and must not be counted against it either.
 *
 * That is the whole reconciliation rule when the two disagree: the loaded thread always wins for
 * display, and the control stays available until the part of the conversation the summary knew
 * about is loaded. A stale summary can therefore never hide a message or strand the control.
 */
export function canLoadOlder(conversation: Conversation) {
  const { load, summary, thread } = conversation;
  if (load.status !== "loaded" || !load.nextCursor) return false;
  const accountedFor = thread.filter((message) => message.sentAt <= summary.lastMessageAt).length;
  return accountedFor < summary.messageCount;
}

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

const COMPOSER_NOTE_ID = "whatsapp-composer-note";

export function WhatsappScreen({
  invitations,
  threads,
  unreadByCode,
  threadLoads,
  selectedCode,
  filter,
  query,
  onFilterChange,
  onQueryChange,
  onSelect,
  onClearSelection,
  onOpenInvitation,
  onRetry,
  onLoadMore,
  onSend,
  sendStates
}: {
  invitations: AdminInvitation[];
  threads: Record<string, AdminWhatsappMessage[]>;
  unreadByCode: Record<string, number | null>;
  threadLoads: Record<string, AdminWhatsappThreadLoadState>;
  selectedCode?: string;
  filter: ChatFilter;
  query: string;
  onFilterChange: (next: ChatFilter) => void;
  onQueryChange: (next: string) => void;
  onSelect: (invitationCode: string) => void;
  onClearSelection: () => void;
  onOpenInvitation: (invitationCode: string) => void;
  onRetry: (invitationCode: string) => void;
  onLoadMore: (invitationCode: string) => void;
  onSend: (invitationCode: string, text: string) => void;
  /** Per-invitation state of the composer's own send request. */
  sendStates: Record<string, AdminWhatsappSendState>;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreButtonRef = useRef<HTMLButtonElement>(null);
  const preserveScrollRef = useRef<{ code: string; height: number; top: number } | null>(null);
  const restorePaginationFocusRef = useRef(false);
  const previousLoadRef = useRef<AdminWhatsappThreadLoadState["status"] | null>(null);

  // The exclusion rule: an invitation without a conversation summary owns no WhatsApp message,
  // so it never becomes a row, never reaches a filter, and never counts in the header.
  const conversations: Conversation[] = invitations
    .flatMap((invitation) => {
      const summary = invitation.whatsappConversation;
      if (!summary) return [];
      const thread = threads[invitation.invitationCode] ?? [];
      const load = threadLoads[invitation.invitationCode] ?? { status: "unloaded" as const };
      const loaded = hasNewestPage(load);
      const last = thread.at(-1) ?? null;
      return [{
        invitation,
        summary,
        thread,
        last,
        unread: unreadByCode[invitation.invitationCode] ?? null,
        load,
        loaded,
        lastAt: loaded ? last?.sentAt ?? "" : summary.lastMessageAt
      }];
    })
    .sort(
      (a, b) =>
        b.lastAt.localeCompare(a.lastAt) ||
        a.invitation.invitationCode.localeCompare(b.invitation.invitationCode)
    );

  const needle = query.trim().toLowerCase();
  const visible = conversations.filter((conversation) => {
    if (filter === "Não lidas" && !(conversation.unread && conversation.unread > 0)) return false;
    if (filter === "Pendentes" && conversation.invitation.rsvp.status !== "pending") return false;
    if (!needle) return true;
    const { invitationCode, householdName, phoneNumber } = conversation.invitation;
    return `${householdName} ${invitationCode} ${phoneNumber}`.toLowerCase().includes(needle);
  });

  const selected = conversations.find(
    (conversation) => conversation.invitation.invitationCode === selectedCode
  );
  const unreadTotal = conversations.reduce((sum, conversation) => sum + (conversation.unread ?? 0), 0);

  useEffect(() => setDraft(""), [selectedCode]);

  // First pages open at the newest message; older prepended pages retain the viewport.
  const threadLength = selected?.thread.length ?? 0;
  const loading = selected?.load.status === "loading";
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // A pagination snapshot belongs to the conversation it was taken in; switching away drops it
    // rather than applying one thread's offset to another.
    if (preserveScrollRef.current && preserveScrollRef.current.code !== selectedCode) {
      preserveScrollRef.current = null;
      restorePaginationFocusRef.current = false;
    }
    const preserved = preserveScrollRef.current;
    // Only once the request settles: the render in between adds no messages, so consuming the
    // snapshot there would restore nothing and leave the prepended page to jump to the newest end.
    if (preserved && !loading) {
      element.scrollTop = preserved.top + element.scrollHeight - preserved.height;
      preserveScrollRef.current = null;
    } else if (
      !preserved &&
      selected?.load.status === "loaded" &&
      (previousLoadRef.current === null || previousLoadRef.current === "loading")
    ) {
      element.scrollTop = element.scrollHeight;
    }
    if (restorePaginationFocusRef.current && !loading) {
      (loadMoreButtonRef.current ?? element).focus();
      restorePaginationFocusRef.current = false;
    }
    previousLoadRef.current = selected?.load.status ?? null;
  }, [loading, selectedCode, selected?.load.status, threadLength]);

  const loadOlder = () => {
    if (!selectedCode) return;
    const element = scrollRef.current;
    if (element) {
      preserveScrollRef.current = {
        code: selectedCode,
        height: element.scrollHeight,
        top: element.scrollTop
      };
    }
    restorePaginationFocusRef.current = true;
    onLoadMore(selectedCode);
  };

  const sendState: AdminWhatsappSendState =
    (selectedCode ? sendStates[selectedCode] : undefined) ?? { status: "idle" };
  const sending = sendState.status === "loading";
  // Meta only accepts free-form text for 24 h after the guest's last message. The window is
  // server-derived, so the composer can say why it is closed instead of failing after the fact.
  const freeTextWindow = selected?.invitation.whatsappFreeTextWindow;
  const windowClosed = freeTextWindow !== undefined && !freeTextWindow.open;
  const canSend = Boolean(draft.trim()) && !sending && !windowClosed;
  // A closed window explains itself first: it is the reason the composer is inert, and a stale
  // error from an earlier attempt would only compete with it.
  const composerNote = windowClosed
    ? "A janela de 24 h do WhatsApp expirou. Envie um modelo aprovado."
    : sendState.status === "error" ? sendState.message : null;

  const send = () => {
    if (!selectedCode || !canSend) return;
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
          {pluralize(unreadTotal, "mensagem sem resposta", "mensagens sem resposta")} ·{" "}
          {pluralize(visible.length, "conversa", "conversas")}
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
              const { invitation, unread, lastAt } = conversation;
              const status = RSVP_LABELS[invitation.rsvp.status];
              const active = invitation.invitationCode === selectedCode;
              const dayLabel = lastAt ? formatDayLabel(lastAt) : "";
              const time = !lastAt
                ? "—"
                : dayLabel === "Hoje"
                  ? formatClockTime(lastAt)
                  : dayLabel.replace(` de ${new Date(lastAt).getFullYear()}`, "");
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
                            unread !== null && unread > 0 ? "font-semibold" : "font-medium"
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
                          {conversationPreview(conversation)}
                        </span>
                        {unread !== null && unread > 0 && (
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
                {conversations.length === 0
                  ? "Nenhum convite trocou mensagens no WhatsApp ainda."
                  : "Nenhuma conversa corresponde a este filtro."}
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
                tabIndex={-1}
                aria-label="Histórico da conversa"
                className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto bg-admin-canvas px-5 py-[26px] sm:px-[30px]"
              >
                {selected.load.status === "loading" && !selected.load.hasLoaded && (
                  <p role="status" className="m-auto text-sm text-admin-faint">Carregando conversa…</p>
                )}
                {selected.load.status === "error" && (
                  <div role="alert" className="mx-auto flex max-w-sm flex-col items-center gap-3 text-center text-sm text-admin-danger">
                    <p>Não foi possível carregar a conversa.</p>
                    <button
                      type="button"
                      onClick={() => onRetry(selected.invitation.invitationCode)}
                      className="min-h-11 rounded-lg border border-admin-line-strong bg-admin-surface px-4 text-admin-ink"
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}
                {canLoadOlder(selected) && (
                  <button
                    ref={loadMoreButtonRef}
                    type="button"
                    onClick={loadOlder}
                    className="mx-auto min-h-11 rounded-lg border border-admin-line-strong bg-admin-surface px-4 text-sm font-medium text-admin-ink"
                  >
                    Carregar mensagens anteriores
                  </button>
                )}
                {selected.load.status === "loading" && selected.load.hasLoaded && (
                  <button type="button" disabled aria-busy="true" className="mx-auto min-h-11 rounded-lg border border-admin-line px-4 text-sm text-admin-faint">
                    Carregando mensagens anteriores…
                  </button>
                )}
                {selected.load.status === "loaded" && selected.thread.length === 0 && (
                  <p className="m-auto text-sm text-admin-faint">Sem mensagens</p>
                )}
                {groupByDay(selected.thread).map((group) => (
                  <div key={group.key} className="flex flex-col gap-2.5">
                    <span className="self-center rounded-full bg-admin-mute-bg px-3 py-1 text-[11.5px] font-medium tracking-[0.08em] text-admin-slate">
                      {group.label}
                    </span>
                    {group.items.map((message) => {
                      const mine = message.direction === "outbound";
                      return (
                        <div
                          key={message.messageId}
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
                            {message.templateId && !message.templateId.startsWith("__") && (
                              <p className="mb-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-admin-gold">
                                {templateLabel(message.templateId)}
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
                                ? message.pending
                                  ? "Enviando…"
                                  : message.failed
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

              <div className="flex-none border-t border-admin-line bg-admin-surface px-[22px] py-4">
                {composerNote && (
                  <p
                    id={COMPOSER_NOTE_ID}
                    className="mb-2.5 text-[12.5px] leading-[1.45] text-admin-danger"
                  >
                    {composerNote}
                  </p>
                )}
                <div className="flex items-end gap-3">
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
                    placeholder={windowClosed
                      ? "Janela de 24 h expirada — envie um modelo aprovado"
                      : "Escreva uma resposta para o convidado"}
                    disabled={windowClosed}
                    aria-describedby={composerNote ? COMPOSER_NOTE_ID : undefined}
                    className="max-h-[120px] w-full resize-none rounded-[11px] border border-admin-line-strong bg-admin-subtle px-[15px] py-3 text-[14.5px] leading-[1.5] text-admin-ink outline-none focus:border-admin-ink disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  aria-busy={sending}
                  aria-describedby={composerNote ? COMPOSER_NOTE_ID : undefined}
                  className={cn(
                    "flex min-h-11 flex-none items-center gap-2.5 rounded-[11px] px-5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink",
                    canSend
                      ? "bg-admin-ink text-white hover:bg-admin-ink-hover"
                      : "cursor-not-allowed bg-admin-send-off text-admin-fainter"
                  )}
                >
                  {sending ? "Enviando…" : "Enviar"}
                  <ArrowRight className="size-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                </button>
                </div>
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
