import { useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import type { PaymentStatus, PaymentSummary } from "@brimax/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LAST_PAYMENT_ID_MAX_AGE_MS, LAST_PAYMENT_ID_STORAGE_KEY } from "@/lib/payment-flow";
import { getPayment, PaymentApiError } from "@/lib/payments-api";

type UrlVariant = "success" | "cancel" | "expired" | "unknown";
type DialogVariant = "success" | "pending" | "cancel" | "expired" | "error" | "unknown";

type DialogState = {
  paymentId: string | null;
  urlVariant: UrlVariant | null;
  open: boolean;
};

type DialogCopy = {
  title: string;
  body: string;
  icon: "check" | "x" | "spinner";
};

const COPY: Record<DialogVariant, DialogCopy> = {
  success: {
    title: "Presente recebido!",
    body: "Sua contribuição foi confirmada. Muito obrigado pelo seu carinho e por fazer parte do nosso dia. — Brida & Max",
    icon: "check",
  },
  pending: {
    title: "Confirmando seu pagamento…",
    body: "Estamos aguardando a confirmação da Asaas. Você receberá um e-mail assim que estiver tudo certo. Pode fechar esta janela tranquilo.",
    icon: "spinner",
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
  error: {
    title: "Algo deu errado",
    body: "O pagamento não foi confirmado. Tente novamente ou fale com a gente.",
    icon: "x",
  },
  unknown: {
    title: "Status indisponível",
    body: "Não conseguimos confirmar o status do pagamento. Em caso de dúvida, fale com a gente.",
    icon: "x",
  },
};

function resolveUrlVariant(status: string | null): UrlVariant | null {
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (normalized === "success") return "success";
  if (normalized === "cancel") return "cancel";
  if (normalized === "expired") return "expired";
  return "unknown";
}

function readStoredPaymentId() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(LAST_PAYMENT_ID_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as { paymentId?: string; createdAt?: number };

    if (
      !parsed.paymentId ||
      typeof parsed.createdAt !== "number" ||
      Date.now() - parsed.createdAt > LAST_PAYMENT_ID_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(LAST_PAYMENT_ID_STORAGE_KEY);
      return null;
    }

    return parsed.paymentId;
  } catch {
    window.localStorage.removeItem(LAST_PAYMENT_ID_STORAGE_KEY);
    return null;
  }
}

function readInitialState(): DialogState {
  if (typeof window === "undefined") {
    return { paymentId: null, urlVariant: null, open: false };
  }

  const params = new URLSearchParams(window.location.search);
  const paymentIdFromUrl = params.get("paymentId");
  const urlVariant = resolveUrlVariant(params.get("paymentStatus"));

  if (paymentIdFromUrl && urlVariant) {
    return {
      paymentId: paymentIdFromUrl,
      urlVariant,
      open: true,
    };
  }

  const storedPaymentId = readStoredPaymentId();
  if (!storedPaymentId) {
    return { paymentId: null, urlVariant: null, open: false };
  }

  return {
    paymentId: storedPaymentId,
    urlVariant: null,
    open: true,
  };
}

function getVariantFromBackendStatus(status: PaymentStatus | undefined): DialogVariant | null {
  if (!status) return null;

  if (status === "CONFIRMED" || status === "RECEIVED") {
    return "success";
  }

  if (status === "CREATED" || status === "AWAITING_PAYMENT" || status === "PROCESSING") {
    return "pending";
  }

  if (status === "EXPIRED") {
    return "expired";
  }

  if (status === "CANCELED") {
    return "cancel";
  }

  if (status === "FAILED" || status === "REFUNDED" || status === "CHARGEBACK") {
    return "error";
  }

  return "unknown";
}

function shouldPoll(urlVariant: UrlVariant | null, open: boolean, payment?: PaymentSummary | null) {
  if (!open || !payment) {
    return false;
  }

  if (urlVariant === "cancel" || urlVariant === "expired") {
    return false;
  }

  return getVariantFromBackendStatus(payment.status) === "pending";
}

export function PaymentConfirmationDialog() {
  const [state, setState] = useState<DialogState>(() => readInitialState());
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      setState(readInitialState());
    };

    window.addEventListener("popstate", refresh);
    return () => window.removeEventListener("popstate", refresh);
  }, []);

  useEffect(() => {
    if (!state.open || !state.paymentId) {
      return;
    }

    const paymentId = state.paymentId;
    let cancelled = false;
    let timeoutId: number | undefined;
    const startedAt = Date.now();

    const fetchLatest = async () => {
      setLoading(true);

      try {
        const nextPayment = await getPayment(paymentId);
        if (cancelled) {
          return;
        }

        setPayment(nextPayment);
        setFetchError(null);

        if (
          shouldPoll(state.urlVariant, state.open, nextPayment) &&
          Date.now() - startedAt < 30_000
        ) {
          timeoutId = window.setTimeout(fetchLatest, 2_000);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof PaymentApiError
            ? error.message
            : "Não foi possível consultar o pagamento.";
        setFetchError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    if (state.urlVariant === "success" || state.urlVariant === null) {
      void fetchLatest();
    } else {
      setPayment(null);
      setFetchError(null);
      setLoading(false);
    }

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [state.open, state.paymentId, state.urlVariant]);

  const visibleVariant = useMemo<DialogVariant | null>(() => {
    if (!state.paymentId) {
      return null;
    }

    if (state.urlVariant === "cancel") {
      return "cancel";
    }

    if (state.urlVariant === "expired") {
      return "expired";
    }

    const backendVariant = getVariantFromBackendStatus(payment?.status);
    if (backendVariant) {
      return backendVariant;
    }

    if (state.urlVariant === "success" || state.urlVariant === null) {
      if (loading) {
        return "pending";
      }

      if (fetchError) {
        return state.urlVariant === "success" ? "pending" : "unknown";
      }
    }

    return state.urlVariant ?? "unknown";
  }, [fetchError, loading, payment?.status, state.paymentId, state.urlVariant]);

  useEffect(() => {
    if (!visibleVariant) {
      return;
    }

    if (visibleVariant !== "pending") {
      window.localStorage.removeItem(LAST_PAYMENT_ID_STORAGE_KEY);
    }
  }, [visibleVariant]);

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    window.history.replaceState({}, "", window.location.pathname);
    setState({ paymentId: null, urlVariant: null, open: false });
    setPayment(null);
    setFetchError(null);
  };

  if (!state.paymentId || !visibleVariant) return null;

  const copy = COPY[visibleVariant];
  const Icon = copy.icon === "check" ? Check : copy.icon === "spinner" ? LoaderCircle : X;
  const iconWrapperClass =
    visibleVariant === "success"
      ? "bg-secondary/60 text-foreground"
      : visibleVariant === "pending"
        ? "bg-muted text-muted-foreground"
        : "bg-muted text-muted-foreground";

  return (
    <Dialog open={state.open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-background rounded-2xl">
        <DialogHeader>
          <div
            className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center ${iconWrapperClass}`}
          >
            <Icon
              className={`h-6 w-6${copy.icon === "spinner" ? " animate-spin" : ""}`}
              aria-hidden="true"
            />
          </div>
          <DialogTitle className="font-serif text-2xl text-foreground text-center mt-2">
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-center leading-relaxed">
            {copy.body}
          </DialogDescription>
        </DialogHeader>

        {fetchError && visibleVariant === "unknown" && (
          <p className="text-sm text-center text-muted-foreground">{fetchError}</p>
        )}

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
