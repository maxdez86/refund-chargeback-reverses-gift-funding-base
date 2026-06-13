import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Minus,
  Plus,
  Check,
  HelpCircle,
  Gift as GiftIcon,
  Users,
  HandCoins,
  Heart,
} from "lucide-react";
import { toast } from "sonner";
import {
  type CreatePaymentRequest,
  type PaymentStatus,
} from "@brimax/contracts";
import { ResponsivePhoto } from "@/components/ResponsivePhoto";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  type GiftView,
  fundedPercent,
  getContributionAmount,
  getFundedAmount,
  getGiftAvailability,
  getRemainingParts,
  sortGifts,
  toGiftView,
} from "@/lib/gift-state";
import { getGifts, giftsQueryKey } from "@/lib/gifts-api";
import {
  buildSharedWidthImageFallbackSrc,
  buildSharedWidthImageSources,
} from "@/lib/media";
import {
  createPayment,
  discardPayment,
  getPayment,
  PaymentApiError
} from "@/lib/payments-api";
import {
  PAYMENT_FLOW_UPDATED_EVENT,
  clearStoredPendingPayment,
  openPaymentConfirmationDialog,
  readCurrentPaymentReturn,
  readStoredPendingPayment,
  type StoredPendingPayment,
  writeStoredPendingPayment,
} from "@/lib/payment-flow";
import { returnToPresentes } from "@/lib/presentes-return";
import { scrollToAnchor } from "@/lib/scroll-to-anchor";

const PRESENTES_CARD_IMAGE_SIZES = "(max-width: 767px) 82vw, (max-width: 1279px) 42vw, 28vw";
const PRESENTES_DIALOG_IMAGE_SIZES = "(max-width: 639px) 90vw, 32rem";

type GiftImagePresentation = {
  containerClassName?: string;
  imageClassName?: string;
};

const GIFT_CARD_IMAGE_PRESENTATION: Record<string, GiftImagePresentation> = {
  "g-batedeira": {
    containerClassName: "bg-[#f7f4ee]",
    imageClassName: "object-contain object-center",
  },
  "g-liquidificador": {
    containerClassName: "bg-[#f7f4ee]",
    imageClassName: "object-contain object-center",
  },
  "g-travesseiros": {
    containerClassName: "bg-[#f7f1e8]",
    imageClassName: "object-contain object-center",
  },
};

const GIFT_DIALOG_IMAGE_PRESENTATION: Record<string, GiftImagePresentation> = {
  "g-batedeira": {
    containerClassName: "bg-[#f7f4ee]",
    imageClassName: "object-contain object-center scale-[1.08]",
  },
  "g-liquidificador": {
    containerClassName: "bg-[#f7f4ee]",
    imageClassName: "object-contain object-center scale-[1.06]",
  },
  "g-travesseiros": {
    containerClassName: "bg-[#f7f1e8]",
    imageClassName: "object-contain object-center scale-[1.08]",
  },
};

const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function isTrustedAsaasCheckoutUrl(value: string) {
  let checkoutUrl: URL;

  try {
    checkoutUrl = new URL(value);
  } catch {
    return false;
  }

  return checkoutUrl.protocol === "https:" && /(^|\.)asaas\.com$/.test(checkoutUrl.hostname);
}

function isPendingPaymentStatus(status: PaymentStatus) {
  return status === "CREATED" || status === "AWAITING_PAYMENT" || status === "PROCESSING";
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full" aria-hidden="true">
      <div className="h-1.5 w-full rounded-full bg-foreground/10 overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function GiftCard({ gift, onOpen }: { gift: GiftView; onOpen: (g: GiftView) => void }) {
  const availability = getGiftAvailability(gift);
  const confirmedFunded = availability === "CONFIRMED_FUNDED";
  const reservedPending = availability === "RESERVED_PENDING";
  const percent = gift.fractional ? fundedPercent(gift) : confirmedFunded ? 100 : 0;
  const imagePresentation = GIFT_CARD_IMAGE_PRESENTATION[gift.id];
  const remainingParts = getRemainingParts(gift);
  const fundedAmount = getFundedAmount(gift);

  return (
    <article
      className={`flex w-full flex-col h-full bg-card border border-border/50 rounded-2xl overflow-hidden shadow-sm transition-all ${
        confirmedFunded ? "opacity-70" : availability === "AVAILABLE" ? "hover:shadow-md" : ""
      }`}
      aria-label={`${gift.name} — ${formatBRL(gift.totalValue)}${
        confirmedFunded
          ? " — presente já garantido"
          : reservedPending
            ? " — reservado no momento"
            : ""
      }`}
    >
      <div
        className={`relative flex h-[12.5rem] items-center justify-center overflow-hidden md:h-[14rem] lg:h-[15rem] xl:h-[16.5rem] ${
          imagePresentation?.containerClassName ?? "bg-muted"
        }`}
      >
        <ResponsivePhoto
          section="presentes"
          sources={buildSharedWidthImageSources("presentes", gift.imageSlug, PRESENTES_CARD_IMAGE_SIZES)}
          fallbackSrc={buildSharedWidthImageFallbackSrc("presentes", gift.imageSlug)}
          alt={gift.name}
          loading="lazy"
          pictureClassName="block w-full h-full"
          className={`h-full w-full p-2 ${
            imagePresentation?.imageClassName ?? "object-contain object-center"
          } ${confirmedFunded ? "grayscale" : ""}`}
        />
        {confirmedFunded && (
          <div className="absolute inset-0 bg-background/40 flex items-center justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-background/90 px-4 py-2 text-xs font-medium tracking-widest uppercase text-foreground/80 shadow-sm">
              <Check className="h-3 w-3" aria-hidden="true" />
              Presente já garantido
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3 md:gap-2.5 md:p-4 lg:gap-2 lg:p-3.5 xl:p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif text-xl leading-snug text-foreground md:text-[1.1rem] lg:text-[1.05rem] xl:text-xl">
            {gift.name}
          </h3>
          {gift.fractional && (
            <span className="shrink-0 text-[10px] font-medium tracking-widest uppercase text-foreground/55 mt-1">
              Cotas
            </span>
          )}
        </div>

        <div className="mt-1 md:mt-1.5 lg:mt-1">
          <div className="text-lg font-medium text-foreground">
            {formatBRL(gift.totalValue)}
          </div>
          {gift.fractional && gift.partValue != null && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Cotas de {formatBRL(gift.partValue)}
            </div>
          )}
        </div>

        {gift.fractional && (
          <div className="mt-1 space-y-1.5 md:mt-1.5 md:space-y-1.5 lg:mt-1 lg:space-y-1.5">
            <ProgressBar percent={percent} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {formatBRL(fundedAmount)} de {formatBRL(gift.totalValue)}
              </span>
              <span>{percent}%</span>
            </div>
            {availability === "AVAILABLE" && (
              <div className="text-xs text-muted-foreground">
                {remainingParts}{" "}
                {remainingParts === 1 ? "cota restante" : "cotas restantes"}
              </div>
            )}
          </div>
        )}

        <div className="mt-auto pt-1.5 md:pt-2.5 lg:pt-2">
          {confirmedFunded ? (
            <Button
              variant="outline"
              className="h-10 w-full cursor-not-allowed rounded-full"
              disabled
              aria-disabled="true"
            >
              Presente já garantido
            </Button>
          ) : reservedPending ? (
            <>
              <Button
                variant="outline"
                className="h-10 w-full cursor-not-allowed rounded-full"
                disabled
                aria-disabled="true"
              >
                Reservado no momento
              </Button>
              <p className="mt-1.5 text-center text-xs text-muted-foreground">
                Aguardando confirmação de pagamento
              </p>
            </>
          ) : (
            <Button
              className="h-10 w-full rounded-full"
              onClick={() => onOpen(gift)}
            >
              {gift.fractional ? "Contribuir" : "Escolher presente"}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

const COTA_STEPS = [
  {
    icon: GiftIcon,
    title: "Escolha um presente",
    body: "Os presentes maiores estão divididos em cotas iguais, para que vários convidados possam contribuir juntos.",
  },
  {
    icon: Users,
    title: "Veja quantas cotas faltam",
    body: "A barra de progresso mostra quanto já foi presenteado e quantas cotas ainda estão disponíveis.",
  },
  {
    icon: HandCoins,
    title: "Contribua com o que puder",
    body: "Escolha quantas cotas você quer presentear e te levamos para o pagamento seguro pela Asaas.",
  },
  {
    icon: Heart,
    title: "Juntos completamos o presente",
    body: "Quando todas as cotas forem preenchidas, o presente está garantido. Toda contribuição conta!",
  },
] as const;

function HowCotasWorkDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-background rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-foreground">
            Como funcionam as cotas?
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Cada presente pode ser dividido em partes. Veja como participar:
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-4">
          {COTA_STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="flex items-start gap-3">
              <div className="relative shrink-0">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <span className="absolute -top-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                  {i + 1}
                </span>
              </div>
              <div className="flex-1 pt-0.5">
                <h4 className="font-medium text-foreground">{title}</h4>
                <p className="text-sm text-muted-foreground mt-0.5">{body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="pt-2">
          <Button
            type="button"
            className="rounded-full w-full"
            onClick={() => onOpenChange(false)}
          >
            Entendi
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GiftDialog({
  gift,
  open,
  onOpenChange,
  onReturnFromCheckout,
}: {
  gift: GiftView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturnFromCheckout: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const imagePresentation = GIFT_DIALOG_IMAGE_PRESENTATION[gift?.id ?? ""];

  useEffect(() => {
    setQuantity(1);
    setSubmitting(false);
  }, [gift?.id, open]);

  useEffect(() => {
    const handleRuntimeReturn = () => {
      if (!open) {
        return;
      }

      setSubmitting(false);
      setHowOpen(false);
      onReturnFromCheckout();
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        return;
      }

      handleRuntimeReturn();
    };

    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("popstate", handleRuntimeReturn);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("popstate", handleRuntimeReturn);
    };
  }, [onReturnFromCheckout, open]);

  if (!gift) return null;

  const remainingParts = getRemainingParts(gift);
  const partValue = gift.partValue ?? 0;
  const contribution = getContributionAmount(gift, quantity);

  const dec = () => setQuantity((q) => Math.max(1, q - 1));
  const inc = () =>
    setQuantity((q) => Math.min(remainingParts || 1, q + 1));

  const handleOpenChange = (next: boolean) => {
    if (submitting && !next) return;
    onOpenChange(next);
    if (!next) {
      returnToPresentes();
    }
  };

  const onSubmit = async () => {
    setSubmitting(true);
    const submitStartedAt = performance.now();
    const clickStartedAt = Date.now();
    try {
      const payload: CreatePaymentRequest = {
        giftId: gift.id,
        paymentMethod: "HOSTED",
        ...(gift.fractional ? { quantity } : {}),
      };
      const payment = await createPayment(payload);
      if (!payment.checkout?.url) {
        throw new PaymentApiError("Checkout indisponível. Tente novamente.");
      }
      if (!isTrustedAsaasCheckoutUrl(payment.checkout.url)) {
        throw new PaymentApiError("Checkout URL não confiável.");
      }
      const requestResolvedAt = performance.now();
      const redirectStartedAt = performance.now();
      console.info(
        JSON.stringify({
          metric: "PAYMENT_REDIRECT_TIMING",
          paymentId: payment.paymentId,
          giftId: gift.id,
          paymentMethod: payload.paymentMethod,
          clickStartedAt,
          requestDurationMs: Math.round(requestResolvedAt - submitStartedAt),
          redirectStartDelayMs: Math.round(redirectStartedAt - submitStartedAt)
        })
      );
      writeStoredPendingPayment({
        paymentId: payment.paymentId,
        createdAt: Date.now(),
        checkoutUrl: payment.checkout.url,
        giftName: gift.name,
        amountCents: Math.round(contribution * 100),
      });
      window.location.href = payment.checkout.url;
    } catch (err) {
      console.info(
        JSON.stringify({
          metric: "PAYMENT_REDIRECT_TIMING",
          paymentId: null,
          giftId: gift.id,
          paymentMethod: "HOSTED",
          clickStartedAt,
          requestDurationMs: Math.round(performance.now() - submitStartedAt),
          redirectStartDelayMs: null,
          outcome: "failure",
          errorMessage: err instanceof Error ? err.message : "unknown"
        })
      );
      const message =
        err instanceof PaymentApiError
          ? err.message
          : "Não conseguimos iniciar o pagamento. Tente novamente em alguns segundos.";
      toast.error(message);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="gift-dialog-content"
        className="max-h-[92vh] overflow-y-auto sm:max-h-[min(90vh,48rem)] sm:max-w-lg bg-background rounded-2xl"
      >
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-foreground">
            {gift.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {gift.fractional
              ? "Escolha quantas cotas você gostaria de presentear e siga para o pagamento."
              : "Confira o valor e siga para o pagamento."}
          </DialogDescription>
          {gift.fractional && (
            <button
              type="button"
              onClick={() => setHowOpen(true)}
              className="mt-1 inline-flex items-center gap-1.5 self-start text-sm text-primary underline-offset-4 hover:underline focus:outline-none focus-visible:underline"
            >
              <HelpCircle className="h-4 w-4" aria-hidden="true" />
              Como funcionam as cotas?
            </button>
          )}
        </DialogHeader>

        <div className="space-y-3 sm:space-y-4">
          <div
            data-testid="gift-dialog-image-frame"
            className={`flex min-h-[15rem] items-center justify-center rounded-xl overflow-hidden px-3 py-2 sm:min-h-[18rem] sm:px-4 sm:py-3 ${
              imagePresentation?.containerClassName ?? "bg-muted"
            }`}
          >
            <ResponsivePhoto
              section="presentes"
              sources={buildSharedWidthImageSources("presentes", gift.imageSlug, PRESENTES_DIALOG_IMAGE_SIZES)}
              fallbackSrc={buildSharedWidthImageFallbackSrc("presentes", gift.imageSlug)}
              alt={gift.name}
              pictureClassName="flex h-full w-full items-center justify-center"
              className={`h-full max-h-[14rem] w-full sm:max-h-[17rem] ${
                imagePresentation?.imageClassName ?? "object-contain object-center"
              }`}
            />
          </div>

          {gift.fractional && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {formatBRL(partValue)} por cota
                </span>
                <span className="font-medium text-foreground">
                  {remainingParts}{" "}
                  {remainingParts === 1 ? "disponível" : "disponíveis"}
                </span>
              </div>

              <div className="space-y-3">
                <label
                  htmlFor="qty"
                  className="text-sm font-medium text-foreground block"
                >
                  Quantidade de cotas
                </label>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="rounded-full h-10 w-10"
                    onClick={dec}
                    disabled={quantity <= 1}
                    aria-label="Diminuir cotas"
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span
                    id="qty"
                    role="status"
                    aria-live="polite"
                    className="inline-flex h-10 w-16 items-center justify-center rounded-xl border border-border bg-background text-center font-medium text-foreground"
                  >
                    {quantity}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="rounded-full h-10 w-10"
                    onClick={inc}
                    disabled={quantity >= remainingParts}
                    aria-label="Aumentar cotas"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/60">
                <span className="text-sm text-muted-foreground">
                  Sua contribuição
                </span>
                <span className="font-serif text-2xl text-foreground">
                  {formatBRL(contribution)}
                </span>
              </div>
            </>
          )}

          {!gift.fractional && (
            <div className="flex items-center justify-between pt-2 border-t border-border/60">
              <span className="text-sm text-muted-foreground">Valor</span>
              <span className="font-serif text-2xl text-foreground">
                {formatBRL(gift.totalValue)}
              </span>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-full flex-1"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="rounded-full flex-1"
              disabled={submitting}
              onClick={() => void onSubmit()}
            >
              {submitting ? (
                <>
                  <Spinner className="mr-2" />
                  Redirecionando para a Asaas…
                </>
              ) : (
                "Ir para o pagamento"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
      <HowCotasWorkDialog open={howOpen} onOpenChange={setHowOpen} />
    </Dialog>
  );
}

export function Presentes() {
  const {
    data: gifts = [],
    error,
    isLoading
  } = useQuery({
    queryKey: giftsQueryKey,
    queryFn: getGifts
  });
  const sorted = useMemo(() => sortGifts(gifts.map(toGiftView)), [gifts]);
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    skipSnaps: false,
  });
  const [prevEnabled, setPrevEnabled] = useState(false);
  const [nextEnabled, setNextEnabled] = useState(true);
  const [activeGift, setActiveGift] = useState<GiftView | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<StoredPendingPayment | null>(() =>
    readStoredPendingPayment()
  );
  const [resumingPayment, setResumingPayment] = useState(false);
  const [discardingPayment, setDiscardingPayment] = useState(false);
  const queryClient = useQueryClient();
  const discardInFlightRef = useRef(false);
  const reconcileInFlightRef = useRef(false);
  const lastReconcileRef = useRef<{ paymentId: string; at: number } | null>(null);

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);

  const scrollToPrev = useCallback(() => {
    scrollToAnchor("#fornecedores");
  }, []);

  const scrollToNext = useCallback(() => {
    scrollToAnchor("#confirmar-presenca");
  }, []);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setPrevEnabled(emblaApi.canScrollPrev());
    setNextEnabled(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
  }, [emblaApi, onSelect]);

  useEffect(() => {
    if (!emblaApi) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") emblaApi.scrollPrev();
      if (e.key === "ArrowRight") emblaApi.scrollNext();
    };
    const node = emblaApi.rootNode();
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const root = emblaApi.rootNode();
    let lastFire = 0;
    const onWheel = (e: WheelEvent) => {
      const cardEl = root.querySelector<HTMLElement>("[data-presentes-card]");
      if (!cardEl) return;
      const band = cardEl.getBoundingClientRect();
      if (e.clientY < band.top || e.clientY > band.bottom) return;

      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 4) return;

      e.preventDefault();

      const goingNext = delta > 0;
      if (goingNext && !emblaApi.canScrollNext()) return;
      if (!goingNext && !emblaApi.canScrollPrev()) return;

      const now = Date.now();
      if (now - lastFire < 220) return;
      lastFire = now;
      if (goingNext) emblaApi.scrollNext();
      else emblaApi.scrollPrev();
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [emblaApi]);

  const reconcilePendingPayment = useCallback(async () => {
    // The hash callback path (Asaas redirect) owns its own flow.
    if (readCurrentPaymentReturn()) {
      return;
    }

    const stored = readStoredPendingPayment();
    if (!stored) {
      return;
    }

    // popstate + pageshow commonly both fire on a single Back navigation.
    if (reconcileInFlightRef.current) {
      return;
    }
    const last = lastReconcileRef.current;
    if (last && last.paymentId === stored.paymentId && Date.now() - last.at < 5000) {
      return;
    }

    reconcileInFlightRef.current = true;
    lastReconcileRef.current = { paymentId: stored.paymentId, at: Date.now() };

    try {
      const payment = await getPayment(stored.paymentId);

      if (isPendingPaymentStatus(payment.status)) {
        return;
      }

      clearStoredPendingPayment();
      setPendingPayment(null);

      if (payment.status === "CONFIRMED" || payment.status === "RECEIVED") {
        openPaymentConfirmationDialog({
          paymentId: payment.paymentId,
          paymentStatus: "success",
        });
      } else if (payment.status === "CANCELED") {
        toast.message("Este pagamento foi cancelado.");
      } else if (payment.status === "EXPIRED") {
        toast.message("Esta sessão de pagamento expirou.");
      } else {
        toast.message("Este pagamento não está mais disponível para retomada.");
      }

      void queryClient.invalidateQueries({ queryKey: giftsQueryKey });
    } catch (error) {
      if (error instanceof PaymentApiError && error.status === 404) {
        clearStoredPendingPayment();
        setPendingPayment(null);
        toast.message("Este pagamento não está mais disponível para retomada.");
        void queryClient.invalidateQueries({ queryKey: giftsQueryKey });
      }
      // Other errors: keep the banner — the payment may still be live.
    } finally {
      reconcileInFlightRef.current = false;
    }
  }, [queryClient]);

  useEffect(() => {
    const refreshPendingPayment = () => {
      setPendingPayment(readStoredPendingPayment());
    };

    const handleReturnNavigation = () => {
      refreshPendingPayment();
      void reconcilePendingPayment();
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        return;
      }

      handleReturnNavigation();
    };

    window.addEventListener(PAYMENT_FLOW_UPDATED_EVENT, refreshPendingPayment);
    window.addEventListener("popstate", handleReturnNavigation);
    window.addEventListener("pageshow", onPageShow);

    // Cross-origin Back from Asaas often lands as a full reload (pageshow
    // persisted=false, no popstate), so reconcile on mount as well.
    void reconcilePendingPayment();

    return () => {
      window.removeEventListener(PAYMENT_FLOW_UPDATED_EVENT, refreshPendingPayment);
      window.removeEventListener("popstate", handleReturnNavigation);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [reconcilePendingPayment]);

  const handleOpen = (g: GiftView) => {
    setActiveGift(g);
    setDialogOpen(true);
  };

  const handleCloseGiftDialog = useCallback(() => {
    setDialogOpen(false);
    setActiveGift(null);
  }, []);

  const handleDismissPendingPayment = async () => {
    if (!pendingPayment || resumingPayment || discardInFlightRef.current) {
      return;
    }

    discardInFlightRef.current = true;
    setDiscardingPayment(true);

    try {
      await discardPayment(pendingPayment.paymentId);
      clearStoredPendingPayment();
      setPendingPayment(null);
      await queryClient.invalidateQueries({ queryKey: giftsQueryKey });
    } catch (error) {
      const message =
        error instanceof PaymentApiError
          ? error.message
          : "Não foi possível descartar o pagamento agora. Tente novamente.";
      toast.error(message);
    } finally {
      discardInFlightRef.current = false;
      setDiscardingPayment(false);
    }
  };

  const handleResumePendingPayment = async () => {
    if (!pendingPayment || resumingPayment || discardingPayment) {
      return;
    }

    setResumingPayment(true);

    try {
      const payment = await getPayment(pendingPayment.paymentId);

      if (isPendingPaymentStatus(payment.status)) {
        const checkoutUrl = payment.checkout?.url ?? pendingPayment.checkoutUrl;

        if (!checkoutUrl || !isTrustedAsaasCheckoutUrl(checkoutUrl)) {
          throw new PaymentApiError("Não foi possível retomar este pagamento agora.");
        }

        writeStoredPendingPayment({
          paymentId: payment.paymentId,
          createdAt: pendingPayment.createdAt,
          checkoutUrl,
          giftName: payment.gift.name,
          amountCents: payment.amountCents,
        });
        window.location.href = checkoutUrl;
        return;
      }

      clearStoredPendingPayment();
      setPendingPayment(null);
      void queryClient.invalidateQueries({ queryKey: giftsQueryKey });

      if (payment.status === "CONFIRMED" || payment.status === "RECEIVED") {
        openPaymentConfirmationDialog({
          paymentId: payment.paymentId,
          paymentStatus: "success",
        });
        return;
      }

      if (payment.status === "CANCELED") {
        toast.message("Este pagamento foi cancelado.");
        return;
      }

      if (payment.status === "EXPIRED") {
        toast.message("Esta sessão de pagamento expirou.");
        return;
      }

      toast.message("Este pagamento não está mais disponível para retomada.");
    } catch (error) {
      if (error instanceof PaymentApiError && error.status === 404) {
        clearStoredPendingPayment();
        setPendingPayment(null);
        void queryClient.invalidateQueries({ queryKey: giftsQueryKey });
        toast.message("Este pagamento não está mais disponível para retomada.");
        return;
      }

      const message =
        error instanceof PaymentApiError
          ? error.message
          : "Não foi possível retomar o pagamento agora.";
      toast.error(message);
    } finally {
      setResumingPayment(false);
    }
  };

  useEffect(() => {
    const handleRuntimeReturn = () => {
      const paymentReturn = readCurrentPaymentReturn();

      if (!paymentReturn) {
        handleCloseGiftDialog();
        return;
      }

      if (
        paymentReturn.paymentStatus === "success" ||
        paymentReturn.paymentStatus === "cancel" ||
        paymentReturn.paymentStatus === "expired"
      ) {
        handleCloseGiftDialog();
      }
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        return;
      }

      handleRuntimeReturn();
    };

    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("popstate", handleRuntimeReturn);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("popstate", handleRuntimeReturn);
    };
  }, [handleCloseGiftDialog]);

  return (
    <section
      id="presentes"
      className="overflow-hidden border-t border-border/30 bg-[#fbf7f0] py-3 md:py-4 lg:py-3"
    >
      <div className="container relative mx-auto mb-1 flex flex-col justify-between gap-2 px-6 md:mb-2 md:flex-row md:items-end md:gap-6 lg:gap-4">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-xl flex flex-col gap-2 md:block"
        >
          <h2 className="font-serif text-3xl md:text-5xl lg:text-5xl xl:text-6xl text-foreground">
            Se quiser nos presentear
          </h2>

          {pendingPayment && (
            <div className="mt-4 max-w-lg rounded-2xl border border-border/50 bg-card/90 p-4 shadow-sm">
              <p className="text-sm font-medium text-foreground">
                Pagamento em andamento
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Você iniciou um pagamento e pode retomá-lo quando quiser.
                {pendingPayment.giftName ? ` Presente: ${pendingPayment.giftName}.` : ""}
                {typeof pendingPayment.amountCents === "number"
                  ? ` Valor: ${formatBRL(pendingPayment.amountCents / 100)}.`
                  : ""}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  className="rounded-full"
                  onClick={() => void handleResumePendingPayment()}
                  disabled={resumingPayment || discardingPayment}
                >
                  {resumingPayment ? "Verificando pagamento..." : "Continuar pagamento"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => void handleDismissPendingPayment()}
                  disabled={resumingPayment || discardingPayment}
                >
                  {discardingPayment ? "Descartando…" : "Descartar"}
                </Button>
              </div>
            </div>
          )}

          <div className="flex justify-end md:hidden">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 animate-bounce rounded-full border-border/50 text-foreground"
              onClick={scrollToPrev}
              aria-label="Rolar para a seção anterior"
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </motion.div>

        <div className="hidden md:flex absolute inset-x-0 bottom-0 justify-center pointer-events-none">
          <Button
            variant="outline"
            size="icon"
            className="pointer-events-auto h-10 w-10 animate-bounce rounded-full border-border/50 text-foreground"
            onClick={scrollToPrev}
            aria-label="Rolar para a seção anterior"
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full border-border/50 text-foreground"
            onClick={scrollPrev}
            disabled={!prevEnabled}
            aria-label="Presente anterior"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full border-border/50 text-foreground"
            onClick={scrollNext}
            disabled={!nextEnabled}
            aria-label="Próximo presente"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="pl-6 md:pl-12 lg:pl-[max(1.5rem,calc((100vw-1280px)/2))]">
        {isLoading ? (
          <div className="flex min-h-[260px] items-center justify-center pr-6 md:pr-12 lg:pr-[max(1.5rem,calc((100vw-1280px)/2))]">
            <Spinner className="h-8 w-8" />
          </div>
        ) : error ? (
          <div className="pr-6 md:pr-12 lg:pr-[max(1.5rem,calc((100vw-1280px)/2))]">
            <div className="rounded-2xl border border-border/40 bg-card px-6 py-8 text-center text-muted-foreground">
              Não conseguimos carregar a lista de presentes agora. Tente novamente em alguns instantes.
            </div>
          </div>
        ) : (
        <div
          className="overflow-hidden cursor-grab active:cursor-grabbing focus:outline-none"
          ref={emblaRef}
          tabIndex={0}
          role="region"
          aria-roledescription="carrossel"
          aria-label="Carrossel de presentes"
        >
          <div className="flex items-stretch gap-4 pb-3 md:gap-5 md:pb-7 lg:gap-4 lg:pb-4">
            {sorted.map((gift, index) => (
              <motion.div
                key={gift.id}
                data-presentes-card
                className="flex-[0_0_82%] md:flex-[0_0_42%] lg:flex-[0_0_24%] min-w-0 flex"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: Math.min(index, 4) * 0.06 }}
              >
                <GiftCard gift={gift} onOpen={handleOpen} />
              </motion.div>
            ))}
          </div>
        </div>
        )}
      </div>

      <div className="container mx-auto px-6 mt-0 flex justify-center">
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 animate-bounce rounded-full border-border/50 text-foreground"
          onClick={scrollToNext}
          aria-label="Rolar para a próxima seção"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <GiftDialog
        gift={activeGift}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onReturnFromCheckout={handleCloseGiftDialog}
      />
    </section>
  );
}
