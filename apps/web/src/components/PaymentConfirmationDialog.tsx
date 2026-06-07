import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import {
  PAYMENT_CONFIRMATION_OPEN_EVENT,
  type PaymentConfirmationOpenDetail,
  clearStoredPendingPayment,
  readPaymentReturnFromHash,
} from "@/lib/payment-flow";
import { createPaymentMessage, getPayment, PaymentApiError } from "@/lib/payments-api";
import { giftsQueryKey } from "@/lib/gifts-api";
import { returnToPresentes } from "@/lib/presentes-return";

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

type ReadDialogStateSource = "initial" | "runtime";

const COPY: Record<DialogVariant, DialogCopy> = {
  success: {
    title: "Presente recebido!",
    body: "Recebemos o seu presente e ficamos muito felizes por ter você fazendo parte desse momento tão especial da nossa história. Obrigado pelo carinho! - Brida e Max",
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

function toDisplayNameCase(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  return value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1))
    .join(" ");
}

function resolveUrlVariant(status: string | null): UrlVariant | null {
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (normalized === "success") return "success";
  if (normalized === "cancel") return "cancel";
  if (normalized === "expired") return "expired";
  return "unknown";
}

function clearCapturedInitialHash() {
  const w = window as Window & { __brimaxInitialHash?: string };
  if (w.__brimaxInitialHash) {
    delete w.__brimaxInitialHash;
  }
}

function readDialogState(source: ReadDialogStateSource): DialogState {
  if (typeof window === "undefined") {
    return { paymentId: null, urlVariant: null, open: false };
  }

  const w = window as Window & { __brimaxInitialHash?: string };
  const rawHash =
    source === "initial"
      ? (w.__brimaxInitialHash ?? window.location.hash ?? "")
      : (window.location.hash ?? "");
  const paymentReturn = readPaymentReturnFromHash(rawHash);

  if (paymentReturn) {
    clearCapturedInitialHash();
    return {
      paymentId: paymentReturn.paymentId,
      urlVariant: resolveUrlVariant(paymentReturn.paymentStatus),
      open: true,
    };
  }

  if (source === "runtime") {
    clearCapturedInitialHash();
  }

  return { paymentId: null, urlVariant: null, open: false };
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

  return (
    getVariantFromBackendStatus(payment.status) === "pending" ||
    (
      getVariantFromBackendStatus(payment.status) === "success" &&
      payment.customerProfileStatus !== "READY"
    )
  );
}

export function PaymentConfirmationDialog() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<DialogState>(() => readDialogState("initial"));
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [messageSubmitting, setMessageSubmitting] = useState(false);
  const [messageSent, setMessageSent] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const nextState = readDialogState("runtime");
      setState(nextState);

      if (!nextState.open) {
        setPayment(null);
        setLoading(false);
        setFetchError(null);
        setMessageBody("");
        setMessageSubmitting(false);
        setMessageSent(false);
      }
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        return;
      }

      refresh();
    };

    window.addEventListener("popstate", refresh);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("popstate", refresh);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  useEffect(() => {
    const openFromEvent = (event: Event) => {
      const detail = (event as CustomEvent<PaymentConfirmationOpenDetail>).detail;

      if (!detail?.paymentId) {
        return;
      }

      setState({
        paymentId: detail.paymentId,
        urlVariant: resolveUrlVariant(detail.paymentStatus),
        open: true,
      });
    };

    window.addEventListener(PAYMENT_CONFIRMATION_OPEN_EVENT, openFromEvent);
    return () => window.removeEventListener(PAYMENT_CONFIRMATION_OPEN_EVENT, openFromEvent);
  }, []);

  useEffect(() => {
    if (!state.open) {
      setMessageBody("");
      setMessageSubmitting(false);
      setMessageSent(false);
      setFetchError(null);
    }
  }, [state.open]);

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
        return state.urlVariant === "success" ? "unknown" : "unknown";
      }
    }

    return state.urlVariant ?? "unknown";
  }, [fetchError, loading, payment?.status, state.paymentId, state.urlVariant]);

  const successBody = useMemo(() => {
    const firstName = toDisplayNameCase(payment?.payerFirstName);

    if (firstName) {
      return `${firstName}, recebemos o seu presente e ficamos muito felizes por ter você fazendo parte desse momento tão especial da nossa história. Obrigado pelo carinho! - Brida e Max`;
    }

    return COPY.success.body;
  }, [payment?.payerFirstName]);

  useEffect(() => {
    if (!visibleVariant) {
      return;
    }

    if (visibleVariant !== "pending") {
      clearStoredPendingPayment();
    }
  }, [visibleVariant]);

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    setState({ paymentId: null, urlVariant: null, open: false });
    setPayment(null);
    setFetchError(null);
    void queryClient.invalidateQueries({ queryKey: giftsQueryKey });
    returnToPresentes({ clearPaymentParams: true });
  };

  const handleMessageSubmit = async () => {
    if (!state.paymentId || !messageBody.trim() || messageSubmitting || messageSent) {
      return;
    }

    setMessageSubmitting(true);

    try {
      await createPaymentMessage(state.paymentId, {
        body: messageBody.trim()
      });
      setMessageSent(true);
    } catch (error) {
      const message =
        error instanceof PaymentApiError
          ? error.message
          : "Não foi possível enviar sua mensagem.";
      setFetchError(message);
    } finally {
      setMessageSubmitting(false);
    }
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
            {visibleVariant === "success" ? successBody : copy.body}
          </DialogDescription>
        </DialogHeader>

        {fetchError && visibleVariant === "unknown" && (
          <p className="text-sm text-center text-muted-foreground">{fetchError}</p>
        )}

        {fetchError && visibleVariant === "success" && (
          <p className="text-sm text-center text-muted-foreground">{fetchError}</p>
        )}

        {visibleVariant === "success" && (
          <div className="space-y-3">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground text-center">
                Escreva aqui um recadinho para os noivos 
              </p>
              <Textarea
                value={messageBody}
                onChange={(event) => setMessageBody(event.target.value)}
                placeholder="Escreva uma mensagem carinhosa..."
                disabled={messageSubmitting || messageSent}
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">
                {messageBody.length}/500
              </p>
            </div>

            {messageSent ? (
              <p className="text-sm text-center text-muted-foreground">
                Mensagem enviada com sucesso.
              </p>
            ) : (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full px-6"
                  disabled={messageSubmitting || !messageBody.trim()}
                  onClick={() => void handleMessageSubmit()}
                >
                  {messageSubmitting ? "Enviando..." : "Enviar mensagem"}
                </Button>
              </div>
            )}
          </div>
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
