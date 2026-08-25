import { useEffect, useState } from "react";
import {
  ChevronRight,
  CircleCheck,
  Gift,
  LayoutGrid,
  LogOut,
  Mail,
  MessageCircle,
  Music,
  RefreshCw,
  Users,
  type LucideIcon
} from "lucide-react";
import { formatRelativeMinutes } from "@/lib/admin-dashboard-format";
import { sectionHash, type DashboardSection } from "@/lib/admin-dashboard-route";
import { cn } from "@/lib/utils";

export type AdminDashboardRefreshState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

type NavItem = {
  section: DashboardSection;
  label: string;
  icon: LucideIcon;
  count?: number;
};

export type SidebarCounts = {
  invitations: number;
  guests: number;
  gifts: number;
  unreadMessages: number;
  guestMessages: number;
  musicSuggestions: number;
};

export function buildNavItems(counts: SidebarCounts): NavItem[] {
  return [
    { section: "visao-geral", label: "Visão geral", icon: LayoutGrid },
    { section: "convites", label: "Convites", icon: CircleCheck, count: counts.invitations },
    { section: "convidados", label: "Convidados", icon: Users, count: counts.guests },
    { section: "presentes", label: "Presentes", icon: Gift, count: counts.gifts },
    { section: "whatsapp", label: "WhatsApp", icon: MessageCircle, count: counts.unreadMessages },
    { section: "recados", label: "Recados", icon: Mail, count: counts.guestMessages },
    { section: "musicas", label: "Músicas", icon: Music, count: counts.musicSuggestions }
  ];
}

export function AdminSidebar({
  active,
  counts,
  collapsed,
  onToggleCollapsed,
  onNavigate,
  displayName,
  email,
  onSignOut,
  onRefresh,
  refreshState,
  lastSuccessfulLoadAt,
  variant
}: {
  active: DashboardSection;
  counts: SidebarCounts;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onNavigate: (section: DashboardSection) => void;
  displayName: string;
  email: string;
  onSignOut: () => void;
  onRefresh: () => void;
  refreshState: AdminDashboardRefreshState;
  lastSuccessfulLoadAt: string | null;
  variant: "desktop" | "drawer";
}) {
  const items = buildNavItems(counts);
  // The drawer is always fully expanded; only the desktop rail collapses.
  const open = variant === "drawer" || !collapsed;
  const refreshing = refreshState.status === "loading";

  // Keeps the relative "Atualizado há X min" caption fresh without new props ticking in.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((tick) => tick + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const refreshLabel = refreshing ? "Atualizando…" : "Atualizar dados";
  const refreshCaption =
    refreshState.status === "loading"
      ? "Buscando métricas de todas as seções"
      : refreshState.status === "error"
        ? refreshState.message
        : formatRelativeMinutes(lastSuccessfulLoadAt);

  return (
    <div
      className={cn(
        "relative flex flex-col bg-admin-subtle px-[22px] pb-[22px] pt-[34px]",
        variant === "desktop" &&
          "sticky top-0 h-screen flex-none overflow-y-auto border-r border-admin-line transition-[width] duration-200",
        variant === "desktop" && (open ? "w-[320px]" : "w-[92px]"),
        variant === "drawer" && "h-full w-full"
      )}
    >
      {variant === "desktop" && onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={open ? "Recolher menu" : "Expandir menu"}
          aria-expanded={open}
          className="absolute -right-[15px] top-[38px] z-10 flex size-[30px] items-center justify-center rounded-full border border-admin-line-strong bg-admin-surface text-admin-ink-soft shadow-[0_1px_3px_rgb(29_42_36/0.09)] hover:bg-admin-gold-tint hover:text-admin-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
        >
          <ChevronRight
            className={cn("size-[15px] transition-transform duration-200", open && "rotate-180")}
            strokeWidth={1.7}
            aria-hidden="true"
          />
          <span className="sr-only">{open ? "Recolher menu" : "Expandir menu"}</span>
        </button>
      )}

      <div className="overflow-hidden px-2">
        {open ? (
          <div>
            <div className="whitespace-nowrap font-admin-serif text-[31px] leading-[1.1] tracking-[0.01em]">
              Brimax
            </div>
            <div className="mt-2 whitespace-nowrap text-[11px] font-medium tracking-[0.18em] text-admin-gold">
              ADMINISTRAÇÃO
            </div>
          </div>
        ) : (
          <div className="text-center font-admin-serif text-[28px] leading-[1.1]">B</div>
        )}
      </div>

      <nav aria-label="Navegação administrativa" className="mt-11 flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const current = item.section === active;
          return (
            <a
              key={item.section}
              href={sectionHash(item.section)}
              title={item.label}
              aria-current={current ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(item.section);
              }}
              className={cn(
                "flex min-h-11 w-full items-center gap-3.5 overflow-hidden rounded-[10px] px-3.5 py-3 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink",
                open ? "justify-start" : "justify-center",
                current
                  ? "bg-admin-gold-tint font-semibold text-admin-ink"
                  : "text-admin-nav hover:bg-admin-sunken"
              )}
            >
              <Icon className="size-[18px] shrink-0 opacity-75" strokeWidth={1.7} aria-hidden="true" />
              {open && <span className="whitespace-nowrap">{item.label}</span>}
              {open && item.count !== undefined && (
                <span className="ml-auto text-xs tabular-nums text-admin-muted">{item.count}</span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="mt-auto overflow-hidden pt-5">
        <button
          type="button"
          onClick={onRefresh}
          title={refreshLabel}
          aria-label={refreshLabel}
          disabled={refreshing}
          aria-busy={refreshing}
          className={cn(
            "flex w-full items-center gap-3 overflow-hidden rounded-[10px] border border-admin-line bg-admin-surface px-3 py-[11px] text-left transition-colors hover:bg-admin-gold-tint hover:border-admin-line-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink disabled:cursor-not-allowed",
            open ? "justify-start" : "justify-center"
          )}
        >
          <RefreshCw
            className={cn("size-4 shrink-0", refreshing ? "animate-spin text-admin-gold" : "text-admin-ink")}
            strokeWidth={1.7}
            aria-hidden="true"
          />
          {open && (
            <span className="min-w-0">
              <span className="block whitespace-nowrap text-[13.5px] font-medium text-admin-ink">
                {refreshLabel}
              </span>
              <span
                role={refreshState.status === "error" ? "alert" : undefined}
                className={cn(
                  "mt-0.5 block truncate text-[11.5px]",
                  refreshState.status === "error" ? "text-admin-danger" : "text-admin-faint"
                )}
              >
                {refreshCaption}
              </span>
            </span>
          )}
        </button>
        {refreshing && (
          <p role="status" className="sr-only">
            Atualizando dados…
          </p>
        )}
      </div>

      <div className="mt-[18px] overflow-hidden border-t border-admin-line px-2 pt-5">
        <div className={cn("flex items-center gap-3.5", open ? "justify-start" : "justify-center")}>
          <span
            title={displayName}
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-admin-ink text-[13px] font-semibold tracking-[0.04em] text-white"
          >
            {getAdminInitials(displayName)}
          </span>
          {open && (
            <div className="min-w-0">
              <div className="whitespace-nowrap text-sm font-semibold">{displayName}</div>
              <div className="truncate text-[12.5px] text-admin-muted">{email}</div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          title="Sair"
          className={cn(
            "mt-4 flex min-h-11 w-full items-center gap-3 rounded-lg px-1.5 text-[15px] text-admin-ink hover:bg-admin-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink",
            open ? "justify-start" : "justify-center"
          )}
        >
          <LogOut className="size-[18px] shrink-0 opacity-70" strokeWidth={1.7} aria-hidden="true" />
          {open && <span className="whitespace-nowrap">Sair</span>}
        </button>
      </div>
    </div>
  );
}

/** Two-letter monogram for the signed-in admin; avoids loading a profile image. */
export function getAdminInitials(displayName: string) {
  const words = displayName.includes("@")
    ? [displayName.split("@")[0]]
    : displayName.trim().split(/\s+/);
  return (
    words
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join("") || "A"
  );
}
