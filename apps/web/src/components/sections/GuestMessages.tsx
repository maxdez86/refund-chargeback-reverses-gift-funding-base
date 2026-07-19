import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Quote,
} from "lucide-react";
import { toast } from "sonner";
import type { CreateGuestMessageRequest, GuestMessage } from "@brimax/contracts";
import {
  createGuestMessage,
  guestMessagesQueryKey,
  GuestMessagesApiError,
  type GuestMessagesPage,
  listGuestMessages,
} from "@/lib/guest-messages-api";
import { scrollToAnchor } from "@/lib/scroll-to-anchor";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "";
const MESSAGE_MAX_LENGTH = 1000;
const CARD_HEIGHT_CLASS = "h-[28rem] md:h-[29rem]";

type FormState = {
  authorName: string;
  message: string;
};

const initialFormState: FormState = {
  authorName: "",
  message: "",
};

function formatDateTime(value: string) {
  const date = new Date(value);
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);

  return { dateLabel, timeLabel };
}

function cardWidthClassName() {
  return "min-w-0 flex-[0_0_85%] md:flex-[0_0_48%] lg:flex-[0_0_38%] xl:flex-[0_0_32%]";
}

function ComposeCard({
  form,
  isSubmitting,
  isVerifying,
  nameInputRef,
  onChange,
  onSubmit,
  turnstileRef,
}: {
  form: FormState;
  isSubmitting: boolean;
  isVerifying: boolean;
  nameInputRef: RefObject<HTMLInputElement | null>;
  onChange: (field: keyof FormState, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  turnstileRef: RefObject<TurnstileHandle | null>;
}) {
  return (
    <motion.article
      className={cardWidthClassName()}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.55 }}
      data-recado-card
    >
      <div className={`relative flex ${CARD_HEIGHT_CLASS} flex-col overflow-hidden rounded-[1.75rem] border border-white/60 bg-[#fffaf3]/88 p-4 shadow-[0_24px_80px_-48px_rgba(115,73,27,0.45)] backdrop-blur-[2px] md:p-5`}>
        <div className="mb-2 border-b border-[#eadbca] pb-2">
          <p className="font-serif text-[1.45rem] text-foreground">Deixe seu recado</p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-2">
          <div className="space-y-2">
            <label htmlFor="guest-message-author" className="text-sm font-medium text-foreground">
              Seu nome
            </label>
            <Input
              id="guest-message-author"
              ref={nameInputRef}
              value={form.authorName}
              onChange={(e) => onChange("authorName", e.target.value)}
              maxLength={60}
              autoComplete="name"
              className="h-11 rounded-xl border-[#dfcfbd] bg-white/80"
              placeholder="Seu nome"
            />
          </div>

          <div className="flex flex-1 flex-col space-y-2">
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="guest-message-body" className="text-sm font-medium text-foreground">
                Sua mensagem
              </label>
              <span className="text-xs text-muted-foreground">
                {form.message.length}/{MESSAGE_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id="guest-message-body"
              value={form.message}
              onChange={(e) => onChange("message", e.target.value.slice(0, MESSAGE_MAX_LENGTH))}
              maxLength={MESSAGE_MAX_LENGTH}
              className="min-h-[6rem] flex-1 rounded-2xl border-[#dfcfbd] bg-white/80 px-4 py-3 text-sm leading-6"
              placeholder="Escreva uma mensagem carinhosa para os noivos."
            />
          </div>

          <div>
            <Button
              type="submit"
              className="h-11 w-full rounded-full border border-[#cda274]/40 bg-[#a46d49] px-7 text-[#fbf7f0] hover:bg-[#935f3e]"
              disabled={
                isSubmitting ||
                isVerifying ||
                form.authorName.trim().length < 2 ||
                form.message.trim().length === 0
              }
            >
              {isSubmitting || isVerifying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Enviando…
                </>
              ) : (
                "Enviar recado"
              )}
            </Button>
          </div>

          <Turnstile
            ref={turnstileRef}
            siteKey={TURNSTILE_SITE_KEY}
            execution="execute"
            appearance="interaction-only"
            className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2"
          />
        </form>
      </div>
    </motion.article>
  );
}

function MessageCard({ message, index }: { message: GuestMessage; index: number }) {
  const { dateLabel, timeLabel } = formatDateTime(message.createdAt);
  const contentRef = useRef<HTMLParagraphElement | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const check = () => setHasOverflow(element.scrollHeight > element.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.message]);

  return (
    <>
      <motion.article
        className={cardWidthClassName()}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.55, delay: Math.min(index, 3) * 0.08 }}
        data-recado-card
      >
        <div className={`relative flex ${CARD_HEIGHT_CLASS} flex-col overflow-hidden rounded-[1.75rem] border border-white/60 bg-[#fffaf3]/88 p-4 shadow-[0_24px_80px_-48px_rgba(115,73,27,0.45)] backdrop-blur-[2px] md:p-5`}>
          <Quote
            aria-hidden="true"
            className="absolute right-4 top-4 h-10 w-10 text-[#d6ae64]/28 md:right-5 md:top-5 md:h-12 md:w-12"
          />
          <div className="mb-3 border-b border-[#eadbca] pb-2">
            <p className="font-serif text-[1.45rem] text-foreground">{message.authorName}</p>
          </div>

          <div className="relative flex-1 overflow-hidden">
            <p
              ref={contentRef}
              className="h-full w-full min-w-0 overflow-hidden whitespace-pre-line wrap-break-word text-sm leading-6 text-muted-foreground"
            >
              {message.message}
            </p>

            {hasOverflow && (
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#fffaf3] to-transparent"
                />
                <button
                  type="button"
                  className="absolute bottom-0 left-0 text-sm font-medium text-[#a46d49] underline decoration-[#d6ae64]/65 underline-offset-4 transition-colors hover:text-[#8f5d3e]"
                  onClick={() => setIsDialogOpen(true)}
                >
                  ... mais
                </button>
              </>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-4 border-t border-[#eadbca] pt-2 text-xs uppercase tracking-[0.18em] text-[#8a735c]">
            <span>{dateLabel}</span>
            <span>{timeLabel}</span>
          </div>
        </div>
      </motion.article>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[1.75rem] border-[#dccab5] bg-[#fff9f2] p-0 shadow-[0_32px_100px_-52px_rgba(115,73,27,0.55)] sm:max-w-2xl">
          <DialogHeader className="border-b border-[#eadbca] px-8 pb-5 pt-8">
            <DialogTitle className="font-serif text-3xl text-foreground">
              {message.authorName}
            </DialogTitle>
            <DialogDescription className="pt-1 text-xs uppercase tracking-[0.18em] text-[#8a735c]">
              {dateLabel} • {timeLabel}
            </DialogDescription>
          </DialogHeader>
          <div className="px-8 pb-8 pt-6">
            <p className="w-full min-w-0 whitespace-pre-line wrap-break-word text-base leading-8 text-muted-foreground">
              {message.message}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FeedbackCard({ children }: { children: React.ReactNode }) {
  return (
    <motion.article
      className={cardWidthClassName()}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.55 }}
      data-recado-card
    >
      <div className={`flex ${CARD_HEIGHT_CLASS} items-center justify-center rounded-[1.75rem] border border-white/60 bg-[#fffaf3]/88 p-4 text-center shadow-[0_24px_80px_-48px_rgba(115,73,27,0.45)] backdrop-blur-[2px] md:p-5`}>
        <div className="text-sm leading-6 text-muted-foreground">{children}</div>
      </div>
    </motion.article>
  );
}

export function GuestMessages() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: "start", skipSnaps: false });
  const [prevEnabled, setPrevEnabled] = useState(false);
  const [nextEnabled, setNextEnabled] = useState(true);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [isVerifying, setIsVerifying] = useState(false);
  const queryClient = useQueryClient();
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const messagesQuery = useInfiniteQuery({
    queryKey: guestMessagesQueryKey,
    queryFn: ({ pageParam }: { pageParam: string | null }) => listGuestMessages(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const messages = messagesQuery.data?.pages.flatMap((page) => page.messages) ?? [];

  const scrollToNext = useCallback(() => {
    scrollToAnchor("#faq");
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
      const cardEl = root.querySelector<HTMLElement>("[data-recado-card]");
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

  const createMutation = useMutation({
    mutationFn: async (payload: CreateGuestMessageRequest) => {
      const turnstileToken = (await turnstileRef.current?.execute()) ?? null;
      return createGuestMessage(payload, turnstileToken);
    },
    onSuccess: (response) => {
      setForm(initialFormState);
      queryClient.setQueryData(
        guestMessagesQueryKey,
        (current: { pageParams: Array<string | null>; pages: GuestMessagesPage[] } | undefined) => {
          if (!current) {
            return {
              pageParams: [null],
              pages: [{ messages: [response.message], nextCursor: null }],
            };
          }

          const [firstPage, ...restPages] = current.pages;
          if (!firstPage) {
            return current;
          }

          return {
            ...current,
            pages: [
              {
                ...firstPage,
                messages: [response.message, ...firstPage.messages].slice(0, 50),
              },
              ...restPages,
            ],
          };
        }
      );
      turnstileRef.current?.reset();
      nameInputRef.current?.focus();
      emblaApi?.scrollTo(0);
      toast.success("Recado enviado.");
    },
    onError: (error) => {
      const message =
        error instanceof GuestMessagesApiError
          ? error.message
          : "Não conseguimos enviar seu recado agora.";
      toast.error(message);
    },
    onSettled: () => {
      setIsVerifying(false);
      turnstileRef.current?.reset();
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    await createMutation.mutateAsync(form);
  };

  const handleChange = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const shouldShowControls =
    messages.length > 0 || messagesQuery.isLoading || messagesQuery.isError;

  return (
    <section
      id="recados"
      className="relative isolate overflow-hidden border-t border-[#ead7c4]/70 bg-[linear-gradient(180deg,#f5ede7_0%,#efdfd2_45%,#f8f2ea_100%)] pt-12 pb-10 md:pt-14 md:pb-12"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_top,rgba(246,216,204,0.48),transparent_72%)]"
      />
      <div
        aria-hidden="true"
        className="absolute -left-12 top-24 h-56 w-56 rounded-full bg-[#d6ae64]/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -right-16 bottom-12 h-72 w-72 rounded-full bg-[#c98d7a]/12 blur-3xl"
      />

      <div className="container mx-auto px-6">
        <div className="relative mb-6 md:mb-8">
          <motion.div
            className="mx-auto max-w-3xl text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.24em] text-[#9a6a45]">
              Palavras com carinho
            </p>
            <h2 className="font-serif text-4xl text-[#2f251e] md:text-5xl">
              Recados para os Noivos
            </h2>
          </motion.div>

          {shouldShowControls && (
            <div className="absolute bottom-0 right-0 hidden shrink-0 items-center gap-3 md:flex">
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-full border-[#dcc7b3] bg-white/75 text-[#6f5648] shadow-sm transition-colors hover:bg-white hover:text-[#a46d49]"
                onClick={() => emblaApi?.scrollPrev()}
                disabled={!prevEnabled}
                aria-label="Recado anterior"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-full border-[#dcc7b3] bg-white/75 text-[#6f5648] shadow-sm transition-colors hover:bg-white hover:text-[#a46d49]"
                onClick={() => emblaApi?.scrollNext()}
                disabled={!nextEnabled}
                aria-label="Próximo recado"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>

        <div className="relative rounded-[2rem] border border-white/55 bg-white/30 px-4 py-5 shadow-[0_30px_90px_-54px_rgba(115,73,27,0.35)] backdrop-blur-sm md:px-5 md:py-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent"
          />
          <div className="pl-0 md:pl-6 lg:pl-[max(1.5rem,calc((100vw-1280px)/2))]">
          <div
            className="cursor-grab overflow-hidden focus:outline-none active:cursor-grabbing"
            ref={emblaRef}
            tabIndex={0}
            role="region"
            aria-roledescription="carrossel"
            aria-label="Carrossel de recados para os noivos"
          >
            <div className="flex items-stretch gap-5 pb-1 md:gap-5 lg:gap-6">
              <ComposeCard
                form={form}
                isSubmitting={createMutation.isPending}
                isVerifying={isVerifying}
                nameInputRef={nameInputRef}
                onChange={handleChange}
                onSubmit={handleSubmit}
                turnstileRef={turnstileRef}
              />

              {messagesQuery.isLoading && (
                <FeedbackCard>
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Carregando recados…
                  </span>
                </FeedbackCard>
              )}

              {messagesQuery.isError && (
                <FeedbackCard>Não conseguimos carregar os recados agora.</FeedbackCard>
              )}

              {!messagesQuery.isLoading &&
                !messagesQuery.isError &&
                messages.map((message, index) => (
                  <MessageCard key={message.messageId} message={message} index={index + 1} />
                ))}
            </div>
          </div>
        </div>
        </div>

        {messagesQuery.hasNextPage && (
          <div className="mt-5 flex justify-center md:mt-6">
            <Button
              type="button"
              variant="outline"
              className="rounded-full border-[#dcc7b3] bg-white/80 px-7 text-[#6f5648] hover:bg-white hover:text-[#a46d49]"
              disabled={messagesQuery.isFetchingNextPage}
              onClick={() => messagesQuery.fetchNextPage()}
            >
              {messagesQuery.isFetchingNextPage ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Carregando…
                </>
              ) : (
                "Carregar mais recados"
              )}
            </Button>
          </div>
        )}

        <div className="mt-3 flex justify-center md:mt-4">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 animate-bounce rounded-full border-[#dcc7b3] bg-white/65 text-[#6f5648] hover:bg-white hover:text-[#a46d49]"
            onClick={scrollToNext}
            aria-label="Rolar para a próxima seção"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  );
}
