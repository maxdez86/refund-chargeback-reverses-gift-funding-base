import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmationVariant = "success" | "cancel" | "expired" | "unknown";

type ConfirmationCopy = {
  title: string;
  body: string;
  icon: "check" | "x";
};

const COPY: Record<ConfirmationVariant, ConfirmationCopy> = {
  success: {
    title: "Presente recebido!",
    body: "Sua contribuição foi confirmada. Muito obrigado pelo seu carinho e por fazer parte do nosso dia. — Brida & Max",
    icon: "check",
  },
  cancel: {
    title: "Pagamento cancelado",
    body: "O pagamento não foi concluído. Você pode tentar novamente quando quiser.",
    icon: "x",
  },
  expired: {
    title: "Sessão expirada",
    body: "Esta sessão de pagamento expirou. Tente novamente a partir da lista de presentes.",
    icon: "x",
  },
  unknown: {
    title: "Status indisponível",
    body: "Não conseguimos confirmar o status do pagamento. Em caso de dúvida, fale com a gente.",
    icon: "x",
  },
};

function resolveVariant(status: string | null): ConfirmationVariant | null {
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (normalized === "success") return "success";
  if (normalized === "cancel") return "cancel";
  if (normalized === "expired") return "expired";
  return "unknown";
}

function readParams(): { paymentId: string | null; variant: ConfirmationVariant | null } {
  if (typeof window === "undefined") {
    return { paymentId: null, variant: null };
  }
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get("paymentId");
  const variant = resolveVariant(params.get("paymentStatus"));
  if (!paymentId || !variant) {
    return { paymentId: null, variant: null };
  }
  return { paymentId, variant };
}

export function PaymentConfirmationDialog() {
  const [state, setState] = useState<{
    paymentId: string | null;
    variant: ConfirmationVariant | null;
    open: boolean;
  }>(() => {
    const initial = readParams();
    return {
      paymentId: initial.paymentId,
      variant: initial.variant,
      open: Boolean(initial.paymentId && initial.variant),
    };
  });

  useEffect(() => {
    const refresh = () => {
      const next = readParams();
      setState({
        paymentId: next.paymentId,
        variant: next.variant,
        open: Boolean(next.paymentId && next.variant),
      });
    };
    window.addEventListener("popstate", refresh);
    return () => window.removeEventListener("popstate", refresh);
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    window.history.replaceState({}, "", window.location.pathname);
    setState((prev) => ({ ...prev, open: false }));
  };

  if (!state.variant || !state.paymentId) return null;

  const copy = COPY[state.variant];
  const Icon = copy.icon === "check" ? Check : X;
  const iconWrapperClass =
    state.variant === "success"
      ? "bg-secondary/60 text-foreground"
      : "bg-muted text-muted-foreground";

  return (
    <Dialog open={state.open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-background rounded-2xl">
        <DialogHeader>
          <div
            className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center ${iconWrapperClass}`}
          >
            <Icon className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle className="font-serif text-2xl text-foreground text-center mt-2">
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-center leading-relaxed">
            {copy.body}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center pt-2">
          <Button
            type="button"
            className="rounded-full px-6"
            onClick={() => handleOpenChange(false)}
          >
            Voltar ao site
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground text-center break-all pt-2">
          ID do pagamento: {state.paymentId}
        </p>
      </DialogContent>
    </Dialog>
  );
}
