import { useEffect, useState } from "react";
import type { AdminSessionResponse } from "@brimax/contracts";
import {
  CalendarCheck2,
  LayoutDashboard,
  LogOut,
  MailOpen,
  Menu,
  MessageCircleMore,
  SearchCheck
} from "lucide-react";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

const navigationItems = [
  { id: "visao-geral", label: "Visão geral", icon: LayoutDashboard },
  { id: "confirmacoes", label: "Confirmações", icon: CalendarCheck2 },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircleMore },
  { id: "convites", label: "Convites", icon: SearchCheck },
  { id: "recados", label: "Recados", icon: MailOpen }
] as const;

type DashboardShellProps = {
  session: AdminSessionResponse;
  preview: boolean;
  onSignOut: () => void;
};

export function DashboardShell({ session, preview, onSignOut }: DashboardShellProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [activeSection, setActiveSection] = useState(() =>
    navigationItems.some((item) => `#${item.id}` === window.location.hash)
      ? window.location.hash.slice(1)
      : "visao-geral"
  );
  const displayName = session.admin.name ?? session.admin.email;

  useEffect(() => {
    const syncActiveSection = () => {
      const section = window.location.hash.slice(1);
      if (navigationItems.some((item) => item.id === section)) setActiveSection(section);
    };
    window.addEventListener("hashchange", syncActiveSection);
    return () => window.removeEventListener("hashchange", syncActiveSection);
  }, []);

  const navigation = (
    <nav aria-label="Navegação administrativa">
      <ul className="space-y-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={active ? "location" : undefined}
                onClick={() => {
                  setActiveSection(item.id);
                  setMobileNavigationOpen(false);
                }}
                className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-[#d6ae64]/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <div className="dashboard-canvas min-h-screen bg-background text-foreground">
      <a href="#conteudo-principal" className="sr-only z-[60] rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Pular para o conteúdo</a>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur lg:hidden">
        <div>
          <p className="font-serif text-xl leading-none">Brimax</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-[#9f7a34]">Administração</p>
        </div>
        <Button variant="outline" size="icon" className="size-11" aria-label="Abrir navegação" onClick={() => setMobileNavigationOpen(true)}><Menu /></Button>
      </header>

      <Dialog open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <DialogContent className="left-auto right-0 top-0 h-[100dvh] max-w-[20rem] translate-x-0 translate-y-0 content-start rounded-none border-y-0 border-r-0 p-6 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="font-serif text-2xl">Administração</DialogTitle>
            <DialogDescription>Navegue pelas áreas do painel Brimax.</DialogDescription>
          </DialogHeader>
          <div className="mt-5">{navigation}</div>
        </DialogContent>
      </Dialog>

      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-border/80 bg-card/75 px-5 py-7 lg:flex">
        <a href="#visao-geral" className="px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <p className="font-serif text-3xl leading-none">Brimax</p>
          <p className="mt-2 text-[10px] uppercase tracking-[0.25em] text-[#9f7a34]">Administração</p>
        </a>
        <div className="mt-10 flex-1">{navigation}</div>
        <IdentityBlock displayName={displayName} email={session.admin.email} />
        <Button variant="ghost" className="mt-3 min-h-11 justify-start" onClick={onSignOut}><LogOut /> Sair</Button>
      </aside>

      <div className="lg:pl-64">
        {preview && (
          <div role="status" className="border-b border-[#d6ae64]/35 bg-[#d6ae64]/12 px-4 py-2.5 text-center text-xs font-medium text-[#76551f]">
            Dados de demonstração · autorização do backend não verificada
          </div>
        )}
        <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          <div className="mb-8 flex items-center justify-between gap-4 lg:justify-end">
            <div className="lg:hidden"><IdentityBlock displayName={displayName} email={session.admin.email} compact /></div>
            <Button variant="outline" className="min-h-11 lg:hidden" onClick={onSignOut}><LogOut /> Sair</Button>
          </div>
          <main id="conteudo-principal" tabIndex={-1}>
            <DashboardOverview preview={preview} />
          </main>
        </div>
      </div>
    </div>
  );
}

export function getAdminInitials(displayName: string) {
  const words = displayName.includes("@") ? [displayName.split("@")[0]] : displayName.trim().split(/\s+/);
  return words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("") || "A";
}

function IdentityBlock({ displayName, email, compact = false }: { displayName: string; email: string; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden="true">{getAdminInitials(displayName)}</span>
      <div className={compact ? "hidden min-w-0 sm:block" : "min-w-0"}>
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="truncate text-xs text-muted-foreground">{email}</p>
      </div>
    </div>
  );
}
