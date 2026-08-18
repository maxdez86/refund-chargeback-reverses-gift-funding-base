import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { loadGoogleIdentityServices } from "@/lib/google-identity";

type GoogleSignInButtonProps = {
  clientId: string;
  hostedDomain: string;
  onCredential: (credential: string) => void;
};

export function GoogleSignInButton({
  clientId,
  hostedDomain,
  onCredential
}: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"error" | "loading" | "ready">("loading");
  const handleCredential = useCallback(
    (response: GoogleCredentialResponse) => onCredential(response.credential),
    [onCredential]
  );

  useEffect(() => {
    let active = true;
    setStatus("loading");
    void loadGoogleIdentityServices()
      .then((googleId) => {
        if (!active || !containerRef.current) return;
        googleId.initialize({
          client_id: clientId,
          callback: handleCredential,
          hd: hostedDomain,
          auto_select: false,
          cancel_on_tap_outside: true
        });
        containerRef.current.replaceChildren();
        googleId.renderButton(containerRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: 280,
          locale: "pt-BR"
        });
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [attempt, clientId, handleCredential, hostedDomain]);

  return (
    <div className="flex min-h-12 flex-col items-center justify-center gap-3" aria-live="polite">
      <div ref={containerRef} className={status === "ready" ? "block" : "hidden"} />
      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner aria-label="Carregando acesso pelo Google" />
          Preparando acesso seguro…
        </div>
      )}
      {status === "error" && (
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Não foi possível carregar o acesso pelo Google.</p>
          <Button type="button" variant="outline" className="mt-3" onClick={() => setAttempt((value) => value + 1)}>
            Tentar novamente
          </Button>
        </div>
      )}
    </div>
  );
}
