import { useEffect, useState } from "react";
import type { AdminSessionResponse } from "@brimax/contracts";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { useAdminDashboard } from "@/hooks/use-admin-dashboard";
import { useDashboardRoute } from "@/hooks/use-dashboard-route";
import type { AdminDashboardSource } from "@/lib/admin-dashboard-source";
import {
  formatDashboardHash,
  routeForSection,
  type DashboardSection
} from "@/lib/admin-dashboard-route";
import { toMusicSuggestionRows } from "@/lib/admin-dashboard-model";
import type { GuestFilter, InviteFilter, MessageFilter, GiftFilter, ChatFilter } from "@/lib/admin-dashboard-model";
import { AdminSidebar } from "@/components/dashboard/AdminSidebar";
import { OverviewScreen } from "@/components/dashboard/screens/OverviewScreen";
import { InvitesScreen } from "@/components/dashboard/screens/InvitesScreen";
import { InviteDetailScreen } from "@/components/dashboard/screens/InviteDetailScreen";
import { GuestsScreen } from "@/components/dashboard/screens/GuestsScreen";
import {
  GuestDetailScreen,
  type GuestActionKind
} from "@/components/dashboard/screens/GuestDetailScreen";
import { MessagesScreen } from "@/components/dashboard/screens/MessagesScreen";
import { MusicScreen } from "@/components/dashboard/screens/MusicScreen";
import { GiftsScreen } from "@/components/dashboard/screens/GiftsScreen";
import { WhatsappScreen } from "@/components/dashboard/screens/WhatsappScreen";
import { GuestActionModal } from "@/components/dashboard/modals/GuestActionModal";
import {
  AddGuestsModal,
  ConfirmAllModal,
  DeleteInvitationModal,
  NewInvitationModal,
  PhoneModal,
  SendWhatsappModal
} from "@/components/dashboard/modals/InvitationModals";
import { GiftEditorModal, NewGiftModal } from "@/components/dashboard/modals/GiftModals";

type ModalState =
  | null
  | { kind: "new-invitation" }
  | { kind: "delete-invitation"; invitationCode: string }
  | { kind: "guest-action"; guestId: string; action: GuestActionKind }
  | { kind: "phone"; invitationCode: string }
  | { kind: "confirm-all"; invitationCode: string }
  | { kind: "add-guests"; invitationCode: string }
  | { kind: "send"; invitationCode: string }
  | { kind: "new-gift" };

export type DashboardShellProps = {
  session: AdminSessionResponse;
  /** True when the session was not verified by the backend; shown as a banner. */
  preview: boolean;
  onSignOut: () => void;
  source?: AdminDashboardSource;
};

export function DashboardShell({ session, preview, onSignOut, source }: DashboardShellProps) {
  const { route, navigate } = useDashboardRoute();
  const {
    state, status, dispatch, guestRows, unreadByCode,
    refresh, refreshState, lastSuccessfulLoadAt,
    loadWhatsappThread, retryWhatsappThread, loadMoreWhatsappThread, demo
  } = useAdminDashboard({ source });

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [inviteFilter, setInviteFilter] = useState<InviteFilter>("Todos");
  const [inviteQuery, setInviteQuery] = useState("");
  const [guestFilter, setGuestFilter] = useState<GuestFilter>("Todos");
  const [guestQuery, setGuestQuery] = useState("");
  const [messageFilter, setMessageFilter] = useState<MessageFilter>("Todos");
  const [messageQuery, setMessageQuery] = useState("");
  // Músicas is search-only: its rows are all suggestions, so there is nothing to filter by.
  const [musicQuery, setMusicQuery] = useState("");
  const [giftFilter, setGiftFilter] = useState<GiftFilter>("Todos");
  const [giftQuery, setGiftQuery] = useState("");
  const [chatFilter, setChatFilter] = useState<ChatFilter>("Todas");
  const [chatQuery, setChatQuery] = useState("");

  const displayName = session.admin.name ?? session.admin.email;
  const musicSuggestions = toMusicSuggestionRows(state.invitations);
  const invitationBy = (code: string) =>
    state.invitations.find((invitation) => invitation.invitationCode === code);
  const guestBy = (guestId: string) => guestRows.find((guest) => guest.guestId === guestId);

  const goToSection = (section: DashboardSection) => {
    navigate(routeForSection(section));
    setDrawerOpen(false);
  };
  const openInvitation = (invitationCode: string) =>
    navigate({ section: "convites", invitationCode });
  const openGuest = (guestId: string) => navigate({ section: "convidados", guestId });
  const openChat = (invitationCode: string) => {
    navigate({ section: "whatsapp", invitationCode });
    void loadWhatsappThread(invitationCode).catch(() => undefined);
    dispatch({ type: "open-chat", invitationCode });
  };
  const selectedChatCode = route.section === "whatsapp" ? route.invitationCode : undefined;
  const refreshDashboard = () => {
    void refresh()
      .then(() => {
        if (selectedChatCode) navigate(routeForSection("whatsapp"));
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (status !== "ready" || !selectedChatCode) return;
    const invitationCode = selectedChatCode;
    dispatch({ type: "open-chat", invitationCode });
    void loadWhatsappThread(invitationCode).catch(() => undefined);
  }, [dispatch, loadWhatsappThread, selectedChatCode, status]);

  const closeModal = () => setModal(null);

  const confirmGuestAction = () => {
    if (modal?.kind !== "guest-action") return;
    const guest = guestBy(modal.guestId);
    if (!guest) return closeModal();

    if (modal.action === "remove") {
      // The primary guest cannot leave on their own — the flow becomes "delete the invitation".
      if (guest.sortOrder === 1) {
        setModal({ kind: "delete-invitation", invitationCode: guest.invitationCode });
        return;
      }
      dispatch({ type: "remove-guest", guestId: guest.guestId });
      closeModal();
      navigate(routeForSection("convidados"));
      return;
    }

    if (modal.action === "child") {
      dispatch({ type: "set-guest-child", guestId: guest.guestId, isChild: !guest.isChild });
      closeModal();
      return;
    }

    dispatch({ type: "set-guest-status", guestId: guest.guestId, status: modal.action });
    closeModal();
  };

  const renderScreen = () => {
    if (status === "loading") {
      return (
        <p role="status" className="py-20 text-center text-sm text-admin-faint">
          Carregando o painel…
        </p>
      );
    }
    if (status === "error") {
      return (
        <p role="alert" className="py-20 text-center text-sm text-admin-danger">
          Não foi possível carregar os dados do painel.
        </p>
      );
    }

    switch (route.section) {
      case "convites": {
        const invitation = route.invitationCode ? invitationBy(route.invitationCode) : undefined;
        if (invitation) {
          return (
            <InviteDetailScreen
              invitation={invitation}
              backHref={formatDashboardHash(routeForSection("convites"))}
              onBack={(event) => {
                event.preventDefault();
                navigate(routeForSection("convites"));
              }}
              onOpenGuest={openGuest}
              onAskDelete={() =>
                setModal({ kind: "delete-invitation", invitationCode: invitation.invitationCode })
              }
              onAskSend={() => setModal({ kind: "send", invitationCode: invitation.invitationCode })}
              onChangePhone={() =>
                setModal({ kind: "phone", invitationCode: invitation.invitationCode })
              }
              onConfirmAll={() =>
                setModal({ kind: "confirm-all", invitationCode: invitation.invitationCode })
              }
              onAddGuests={() =>
                setModal({ kind: "add-guests", invitationCode: invitation.invitationCode })
              }
            />
          );
        }
        return (
          <InvitesScreen
            invitations={state.invitations}
            filter={inviteFilter}
            query={inviteQuery}
            onFilterChange={setInviteFilter}
            onQueryChange={setInviteQuery}
            onOpenInvitation={openInvitation}
            onNewInvitation={() => setModal({ kind: "new-invitation" })}
          />
        );
      }

      case "convidados": {
        const guest = route.guestId ? guestBy(route.guestId) : undefined;
        if (guest) {
          return (
            <GuestDetailScreen
              guest={guest}
              backHref={formatDashboardHash(routeForSection("convidados"))}
              onBack={(event) => {
                event.preventDefault();
                navigate(routeForSection("convidados"));
              }}
              onOpenGuest={openGuest}
              onOpenInvitation={openInvitation}
              onGuestAction={(action) =>
                setModal({ kind: "guest-action", guestId: guest.guestId, action })
              }
            />
          );
        }
        return (
          <GuestsScreen
            guests={guestRows}
            invitationCount={state.invitations.length}
            filter={guestFilter}
            query={guestQuery}
            onFilterChange={setGuestFilter}
            onQueryChange={setGuestQuery}
            onOpenGuest={openGuest}
          />
        );
      }

      case "recados":
        return (
          <MessagesScreen
            messages={state.guestMessages}
            filter={messageFilter}
            query={messageQuery}
            onFilterChange={setMessageFilter}
            onQueryChange={setMessageQuery}
            onToggleHidden={(messageId) => dispatch({ type: "toggle-message-hidden", messageId })}
          />
        );

      case "musicas":
        return (
          <MusicScreen
            suggestions={musicSuggestions}
            invitationCount={state.invitations.length}
            query={musicQuery}
            onQueryChange={setMusicQuery}
            onOpenInvitation={openInvitation}
          />
        );

      case "presentes":
        return (
          <GiftsScreen
            gifts={state.gifts}
            filter={giftFilter}
            query={giftQuery}
            onFilterChange={setGiftFilter}
            onQueryChange={setGiftQuery}
            onOpenGift={(giftId) => navigate({ section: "presentes", giftId })}
            onNewGift={() => setModal({ kind: "new-gift" })}
          />
        );

      case "whatsapp":
        return (
          <WhatsappScreen
            invitations={state.invitations}
            threads={state.threads}
            unreadByCode={unreadByCode}
            threadLoads={state.threadLoads}
            selectedCode={route.invitationCode}
            filter={chatFilter}
            query={chatQuery}
            onFilterChange={setChatFilter}
            onQueryChange={setChatQuery}
            onSelect={openChat}
            onClearSelection={() => navigate(routeForSection("whatsapp"))}
            onOpenInvitation={openInvitation}
            onRetry={(invitationCode) => void retryWhatsappThread(invitationCode).catch(() => undefined)}
            onLoadMore={(invitationCode) => void loadMoreWhatsappThread(invitationCode).catch(() => undefined)}
            onSend={(invitationCode, text) => dispatch({ type: "send-chat", invitationCode, text })}
          />
        );

      default:
        return (
          <OverviewScreen
            state={state}
            guestRows={guestRows}
            unreadByCode={unreadByCode}
            onNavigate={goToSection}
          />
        );
    }
  };

  const sidebarProps = {
    active: route.section,
    counts: {
      invitations: state.invitations.length,
      guests: guestRows.length,
      gifts: state.gifts.length,
      unreadMessages: Object.values(unreadByCode).reduce<number>((sum, count) => sum + (count ?? 0), 0),
      guestMessages: state.guestMessages.length,
      musicSuggestions: musicSuggestions.length
    },
    onNavigate: goToSection,
    displayName,
    email: session.admin.email,
    onSignOut,
    onRefresh: refreshDashboard,
    refreshState,
    lastSuccessfulLoadAt
  };

  const openGift = route.section === "presentes" && route.giftId
    ? state.gifts.find((gift) => gift.id === route.giftId)
    : undefined;

  return (
    <div className="admin-shell flex min-h-screen bg-admin-canvas text-admin-ink">
      <a
        href="#conteudo-principal"
        className="sr-only z-50 rounded-md bg-admin-surface px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Pular para o conteúdo
      </a>

      <aside className="hidden lg:flex">
        <AdminSidebar
          {...sidebarProps}
          variant="desktop"
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((current) => !current)}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 flex-none items-center justify-between border-b border-admin-line bg-admin-canvas/90 px-4 backdrop-blur lg:hidden">
          <div>
            <p className="font-admin-serif text-xl leading-none">Brimax</p>
            <p className="mt-1 text-[10px] font-medium tracking-[0.2em] text-admin-gold">
              ADMINISTRAÇÃO
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex size-11 items-center justify-center rounded-lg border border-admin-line-strong bg-admin-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
          >
            <Menu className="size-5" strokeWidth={1.7} aria-hidden="true" />
            <span className="sr-only">Abrir navegação</span>
          </button>
        </header>

        <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(20_30_25/0.42)]" />
            <DialogPrimitive.Content className="admin-shell fixed inset-y-0 right-0 z-50 w-[min(20rem,90vw)] overflow-y-auto bg-admin-subtle text-admin-ink shadow-[0_0_60px_rgb(20_30_25/0.3)]">
              <DialogPrimitive.Title className="sr-only">Administração</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                Navegue pelas áreas do painel Brimax.
              </DialogPrimitive.Description>
              <DialogPrimitive.Close className="absolute right-4 top-4 z-10 flex size-11 items-center justify-center rounded-full border border-admin-line-strong bg-admin-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink">
                <X className="size-4" strokeWidth={1.7} aria-hidden="true" />
                <span className="sr-only">Fechar navegação</span>
              </DialogPrimitive.Close>
              <AdminSidebar {...sidebarProps} variant="drawer" collapsed={false} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        {(preview || demo) && (
          <div
            role="status"
            className="flex-none border-b border-admin-line-gold bg-admin-warn-bg px-4 py-2.5 text-center text-xs font-medium text-admin-gold"
          >
            Dados de demonstração · o painel ainda não consulta os endpoints administrativos
          </div>
        )}

        <main
          id="conteudo-principal"
          tabIndex={-1}
          className="relative min-w-0 flex-1 px-5 pb-20 pt-8 sm:px-10 lg:px-[60px] lg:pb-20 lg:pt-[52px]"
        >
          {refreshState.status === "loading" && (
            <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-admin-line">
              <div className="h-full w-1/3 animate-[sweep_1.1s_ease-in-out_infinite] bg-admin-gold" />
            </div>
          )}
          {renderScreen()}
        </main>
      </div>

      {modal?.kind === "new-invitation" && (
        <NewInvitationModal
          onCancel={closeModal}
          onCreate={(draft) => {
            dispatch({ type: "create-invitation", ...draft });
            closeModal();
            setInviteFilter("Todos");
            setInviteQuery("");
            navigate(routeForSection("convites"));
          }}
        />
      )}

      {modal?.kind === "delete-invitation" &&
        (() => {
          const invitation = invitationBy(modal.invitationCode);
          if (!invitation) return null;
          return (
            <DeleteInvitationModal
              invitation={invitation}
              onCancel={closeModal}
              onConfirm={() => {
                dispatch({ type: "delete-invitation", invitationCode: invitation.invitationCode });
                closeModal();
                navigate(routeForSection("convites"));
              }}
            />
          );
        })()}

      {modal?.kind === "guest-action" &&
        (() => {
          const guest = guestBy(modal.guestId);
          if (!guest) return null;
          return (
            <GuestActionModal
              guest={guest}
              kind={modal.action}
              onCancel={closeModal}
              onConfirm={confirmGuestAction}
            />
          );
        })()}

      {modal?.kind === "phone" &&
        (() => {
          const invitation = invitationBy(modal.invitationCode);
          if (!invitation) return null;
          return (
            <PhoneModal
              invitation={invitation}
              onCancel={closeModal}
              onSave={(phoneNumber) => {
                dispatch({
                  type: "update-phone",
                  invitationCode: invitation.invitationCode,
                  phoneNumber
                });
                closeModal();
              }}
            />
          );
        })()}

      {modal?.kind === "confirm-all" &&
        (() => {
          const invitation = invitationBy(modal.invitationCode);
          if (!invitation) return null;
          return (
            <ConfirmAllModal
              invitation={invitation}
              onCancel={closeModal}
              onSave={(guestIds) => {
                dispatch({
                  type: "confirm-guests",
                  invitationCode: invitation.invitationCode,
                  guestIds
                });
                closeModal();
              }}
            />
          );
        })()}

      {modal?.kind === "add-guests" &&
        (() => {
          const invitation = invitationBy(modal.invitationCode);
          if (!invitation) return null;
          return (
            <AddGuestsModal
              invitation={invitation}
              onCancel={closeModal}
              onSave={(rows) => {
                dispatch({ type: "add-guests", invitationCode: invitation.invitationCode, rows });
                closeModal();
              }}
            />
          );
        })()}

      {modal?.kind === "send" &&
        (() => {
          const invitation = invitationBy(modal.invitationCode);
          if (!invitation) return null;
          return (
            <SendWhatsappModal
              invitation={invitation}
              onCancel={closeModal}
              onSend={(mode) => {
                dispatch({ type: "queue-send", invitationCode: invitation.invitationCode, mode });
                closeModal();
              }}
            />
          );
        })()}

      {modal?.kind === "new-gift" && (
        <NewGiftModal
          onCancel={closeModal}
          onCreate={(values) => {
            dispatch({ type: "create-gift", ...values });
            closeModal();
          }}
        />
      )}

      {openGift && (
        <GiftEditorModal
          gift={openGift}
          onCancel={() => navigate(routeForSection("presentes"))}
          onSave={(values) => {
            dispatch({ type: "save-gift", giftId: openGift.id, ...values });
            navigate(routeForSection("presentes"));
          }}
        />
      )}
    </div>
  );
}
