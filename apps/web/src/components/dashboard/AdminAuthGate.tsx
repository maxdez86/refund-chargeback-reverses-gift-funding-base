import type { ReactNode } from "react";
import { AlertCircle, LockKeyhole, RefreshCw, ShieldX } from "lucide-react";
import { GoogleSignInButton } from "@/components/dashboard/GoogleSignInButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { AdminRuntimeConfig } from "@/lib/admin-auth";
import type { AdminSessionState } from "@/hooks/use-admin-session";

type AdminAuthGateProps = {
  state: AdminSessionState;
  config: AdminRuntimeConfig | null;
  onCredential: (credential: string) => void;
  onRetry: () => void;
  onSignOut: () => void;
  children: ReactNode;
};

export function AdminAuthGate({
  state,
  config,
  onCredential,
  onRetry,
  onSignOut,
  children
}: AdminAuthGateProps) {
  if (state.status === "authenticated") return children;

  if (state.status === "checking") {
    return <StateCard icon={<Spinner className="size-7" aria-label="Verificando sessão" />} title="Verificando seu acesso" description="Aguarde enquanto confirmamos sua sessão administrativa." />;
  }

  if (state.status === "access-denied") {
    return (
      <StateCard icon={<ShieldX className="size-7" />} title="Acesso não autorizado" description={state.message}>
        <Button onClick={onSignOut}>Usar outra conta</Button>
      </StateCard>
    );
  }

  if (state.status === "unavailable") {
    return (
      <StateCard icon={<AlertCircle className="size-7" />} title="Painel temporariamente indisponível" description={state.message}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onRetry}><RefreshCw /> Tentar novamente</Button>
          <Button variant="outline" onClick={onSignOut}>Sair</Button>
        </div>
      </StateCard>
    );
  }

  if (state.status === "configuration-error" || !config) {
    return <StateCard icon={<AlertCircle className="size-7" />} title="Configuração pendente" description={state.status === "configuration-error" ? state.message : "O acesso administrativo ainda não foi configurado."} />;
  }

  return (
    <StateCard
      icon={<LockKeyhole className="size-7" />}
      title="Administração Brimax"
      description={`Entre com uma conta verificada do Google Workspace ${config.hostedDomain}.`}
    >
      {state.message && <p role="alert" className="mb-4 text-sm text-destructive">{state.message}</p>}
      <GoogleSignInButton clientId={config.googleClientId} hostedDomain={config.hostedDomain} onCredential={onCredential} />
      <p className="mt-5 max-w-sm text-xs leading-relaxed text-muted-foreground">
        O serviço administrativo valida esta credencial e confirma o acesso antes de carregar o painel.
      </p>
    </StateCard>
  );
}

function StateCard({
  icon,
  title,
  description,
  children
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <main id="conteudo-principal" aria-live="polite" className="flex min-h-screen items-center justify-center px-5 py-16">
      <Card className="w-full max-w-lg border-[#d6ae64]/35 bg-card/95 shadow-[0_18px_55px_rgb(34_28_22_/_0.09)]">
        <CardContent className="flex flex-col items-center px-6 py-10 text-center sm:px-10">
          <span className="mb-5 flex size-14 items-center justify-center rounded-full bg-[#d6ae64]/15 text-[#8a672d]" aria-hidden="true">{icon}</span>
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-[#9f7a34]">Brida &amp; Max</p>
          <h1 className="mt-3 font-serif text-4xl text-foreground">{title}</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
          <div className="mt-7">{children}</div>
        </CardContent>
      </Card>
    </main>
  );
}
