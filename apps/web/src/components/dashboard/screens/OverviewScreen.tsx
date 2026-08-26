import { CircleCheck, Gift, Mail, MessageCircle, Music, Users } from "lucide-react";
import { formatBrlShort, pluralize } from "@/lib/admin-dashboard-format";
import { toMusicSuggestionRows } from "@/lib/admin-dashboard-model";
import type { DashboardSection } from "@/lib/admin-dashboard-route";
import type { AdminDashboardState } from "@/lib/admin-dashboard-store";
import type { AdminGuestRow } from "@/lib/admin-dashboard-types";
import { Eyebrow } from "@/components/dashboard/AdminPrimitives";
import { WEDDING_DATE_LABEL } from "@/components/dashboard/constants";

export function OverviewScreen({
  state,
  guestRows,
  unreadByCode,
  onNavigate
}: {
  state: AdminDashboardState;
  guestRows: AdminGuestRow[];
  unreadByCode: Record<string, number | null>;
  onNavigate: (section: DashboardSection) => void;
}) {
  const totalPaidCents = state.gifts.reduce((sum, gift) => sum + gift.confirmedAmountCents, 0);
  const attendingGuests = guestRows.filter((guest) => guest.rsvpStatus === "attending").length;
  const attendingInvitations = state.invitations.filter(
    (invitation) => invitation.rsvp.status === "attending"
  ).length;
  const publishedMessages = state.guestMessages.filter((message) => !message.hidden).length;
  const musicSuggestions = toMusicSuggestionRows(state.invitations);
  const suggestionPercent = state.invitations.length
    ? Math.round((musicSuggestions.length / state.invitations.length) * 100)
    : 0;
  // Only invitations that own a conversation can be unread, and each of those always resolves to
  // a number — the dashboard summary before the thread loads, the loaded thread afterwards. So
  // this is the real total from the first render, not a count of what happens to be open.
  const conversationUnread = state.invitations
    .filter((invitation) => invitation.whatsappConversation)
    .map((invitation) => unreadByCode[invitation.invitationCode] ?? 0);
  const unreadTotal = conversationUnread.reduce((sum, count) => sum + count, 0);
  const unreadChats = conversationUnread.filter((count) => count > 0).length;

  const cards = [
    {
      section: "presentes" as const,
      label: "PRESENTES",
      icon: Gift,
      value: String(state.gifts.length),
      hint: `${formatBrlShort(totalPaidCents)} arrecadados`
    },
    {
      section: "convidados" as const,
      label: "CONVIDADOS",
      icon: Users,
      value: String(guestRows.length),
      hint: `${attendingGuests} confirmados`
    },
    {
      section: "convites" as const,
      label: "CONVITES",
      icon: CircleCheck,
      value: String(state.invitations.length),
      hint: `${attendingInvitations} com RSVP confirmado`
    },
    {
      section: "recados" as const,
      label: "RECADOS",
      icon: Mail,
      value: String(state.guestMessages.length),
      hint: `${publishedMessages} publicados no site`
    },
    {
      section: "musicas" as const,
      label: "MÚSICAS",
      icon: Music,
      value: String(musicSuggestions.length),
      hint: `${suggestionPercent}% dos convites`
    },
    {
      section: "whatsapp" as const,
      label: "WHATSAPP",
      icon: MessageCircle,
      value: String(unreadTotal),
      hint: `${pluralize(unreadChats, "conversa sem resposta", "conversas sem resposta")} de ${pluralize(conversationUnread.length, "conversa", "conversas")}`
    }
  ];

  return (
    <div>
      <Eyebrow>{WEDDING_DATE_LABEL}</Eyebrow>
      <h1 id="conteudo-titulo" className="mt-3.5 text-[clamp(2.25rem,5vw,3.25rem)] leading-[1.05]">
        Visão geral
      </h1>
      <p className="mt-3.5 max-w-[560px] text-base leading-[1.55] text-admin-ink-soft sm:text-[16.5px]">
        Os números do casamento em um lugar.
      </p>

      <div className="mt-9 grid gap-5 sm:grid-cols-[repeat(auto-fit,minmax(230px,1fr))]">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.section}
              type="button"
              onClick={() => onNavigate(card.section)}
              className="flex flex-col gap-3.5 rounded-2xl border border-admin-line bg-admin-surface px-[30px] py-7 text-left transition-colors hover:bg-admin-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
            >
              <span className="flex items-center gap-2.5">
                <Icon className="size-4 shrink-0 opacity-55" strokeWidth={1.7} aria-hidden="true" />
                <span className="text-[11.5px] font-medium tracking-[0.16em] text-admin-muted">
                  {card.label}
                </span>
              </span>
              <span className="font-admin-serif text-[62px] leading-[0.9] tracking-[-0.015em] text-admin-ink">
                {card.value}
              </span>
              <span className="text-[13px] text-admin-fainter">{card.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
