import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Quote, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { CreateGuestMessageRequest, GuestMessage } from "@brimax/contracts";
import {
  createGuestMessage,
  guestMessagesQueryKey,
  GuestMessagesApiError,
  type GuestMessagesPage,
  listGuestMessages
} from "@/lib/guest-messages-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "";
const NAVIGATION_OFFSET = 80;
const MESSAGE_MAX_LENGTH = 320;
const SUCCESS_SCROLL_RELEASE_DELAY_MS = 500;

type FormState = {
  authorName: string;
  message: string;
};

const initialFormState: FormState = {
  authorName: "",
  message: ""
};

function formatDateTime(value: string) {
  const date = new Date(value);
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo"
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo"
  }).format(date);

  return { dateLabel, timeLabel };
}

function MessageCard({ message, index }: { message: GuestMessage; index: number }) {
  const { dateLabel, timeLabel } = formatDateTime(message.createdAt);

  return (
    <motion.article
      className="min-w-0 flex-[0_0_85%] md:flex-[0_0_48%] lg:flex-[0_0_38%] xl:flex-[0_0_32%]"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.55, delay: Math.min(index, 3) * 0.08 }}
      data-recado-card
    >
      <div className="relative flex min-h-[20rem] flex-col overflow-hidden rounded-[1.75rem] border border-[#d8c6ab]/60 bg-[#fffaf3] p-6 shadow-[0_20px_60px_-42px_rgba(115,73,27,0.5)]">
        <Quote
          aria-hidden="true"
          className="absolute right-5 top-5 h-12 w-12 text-[#d6ae64]/20"
        />
        <div className="mb-5 border-b border-[#e6d9c4] pb-4">
          <p className="font-serif text-[1.45rem] text-foreground">{message.authorName}</p>
        </div>
        <p className="flex-1 whitespace-pre-line text-sm leading-7 text-muted-foreground">
          {message.message}
        </p>
        <div className="mt-6 flex items-center justify-between gap-4 border-t border-[#e6d9c4] pt-4 text-xs uppercase tracking-[0.18em] text-[#8e7553]">
          <span>{dateLabel}</span>
          <span>{timeLabel}</span>
        </div>
      </div>
    </motion.article>
  );
}

function EmptyState({ onFocusForm }: { onFocusForm: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="rounded-[2rem] border border-[#d8c6ab]/60 bg-[#fffaf3] px-7 py-10 text-center shadow-[0_24px_80px_-48px_rgba(115,73,27,0.5)]"
    >
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-[#f2e3c6] text-[#9e7443]">
        <Sparkles className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="font-serif text-3xl text-foreground">
        Seja o primeiro a deixar um recado para os noivos
      </h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
        Uma lembrança em palavras pode virar uma memória para sempre. Deixe seu carinho
        registrado para esse novo capítulo.
      </p>
      <Button
        type="button"
        className="mt-6 rounded-full px-7"
        onClick={onFocusForm}
      >
        Escrever o primeiro recado
      </Button>
    </motion.div>
  );
}

function SuccessState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex min-h-[20rem] flex-col items-center justify-center text-center">
      <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-[#f2e3c6] text-[#9e7443]">
        <Sparkles className="h-7 w-7" aria-hidden="true" />
      </div>
      <h3 className="font-serif text-3xl text-foreground">
        Seu carinho já chegou até os noivos
      </h3>
      <p className="mt-3 max-w-md text-sm leading-7 text-muted-foreground">
        Obrigado por deixar um recado tão especial. Ele já entrou na nossa coleção de
        memórias deste capítulo.
      </p>
      <Button type="button" variant="outline" className="mt-6 rounded-full px-7" onClick={onReset}>
        Escrever outro recado
      </Button>
    </div>
  );
}

export function GuestMessages() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: "start", skipSnaps: false });
  const [prevEnabled, setPrevEnabled] = useState(false);
  const [nextEnabled, setNextEnabled] = useState(true);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [submittedMessageId, setSubmittedMessageId] = useState<string | null>(null);
  const [cardMinHeight, setCardMinHeight] = useState<number | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const queryClient = useQueryClient();
  const sectionRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const successScrollFrameRef = useRef<number | null>(null);
  const successScrollReleaseTimeoutRef = useRef<number | null>(null);

  const messagesQuery = useInfiniteQuery({
    queryKey: guestMessagesQueryKey,
    queryFn: ({ pageParam }: { pageParam: string | null }) => listGuestMessages(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor
  });

  const messages = useMemo(
    () => messagesQuery.data?.pages.flatMap((page) => page.messages) ?? [],
    [messagesQuery.data]
  );

  const clearSuccessTransitionLock = () => {
    if (successScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(successScrollFrameRef.current);
      successScrollFrameRef.current = null;
    }
    if (successScrollReleaseTimeoutRef.current !== null) {
      window.clearTimeout(successScrollReleaseTimeoutRef.current);
      successScrollReleaseTimeoutRef.current = null;
    }
    setCardMinHeight(null);
  };

  const scrollToSectionTop = () => {
    const section = sectionRef.current;
    if (!section) return;

    const top = Math.max(
      section.getBoundingClientRect().top + window.scrollY - NAVIGATION_OFFSET,
      0
    );
    window.scrollTo({ top, behavior: "smooth" });
  };

  const focusForm = useCallback(() => {
    nameInputRef.current?.focus();
    const top = cardRef.current?.getBoundingClientRect().top;
    if (typeof top === "number") {
      const scrollTop = top + window.pageYOffset - NAVIGATION_OFFSET;
      window.scrollTo({ top: scrollTop, behavior: "smooth" });
    }
  }, []);

  const resetForm = useCallback(() => {
    clearSuccessTransitionLock();
    setSubmittedMessageId(null);
    setForm(initialFormState);
    turnstileRef.current?.reset();
    window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);
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

  useEffect(() => {
    if (!submittedMessageId) return;

    successScrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollToSectionTop();
      successScrollReleaseTimeoutRef.current = window.setTimeout(() => {
        setCardMinHeight(null);
        successScrollReleaseTimeoutRef.current = null;
      }, SUCCESS_SCROLL_RELEASE_DELAY_MS);
    });

    return () => {
      clearSuccessTransitionLock();
    };
  }, [submittedMessageId]);

  const createMutation = useMutation({
    mutationFn: async (payload: CreateGuestMessageRequest) => {
      const turnstileToken = (await turnstileRef.current?.execute()) ?? null;
      return createGuestMessage(payload, turnstileToken);
    },
    onSuccess: (response) => {
      const currentCardHeight = cardRef.current?.getBoundingClientRect().height ?? 0;
      setCardMinHeight(currentCardHeight > 0 ? currentCardHeight : null);
      setSubmittedMessageId(response.message.messageId);
      setForm(initialFormState);
      queryClient.setQueryData(
        guestMessagesQueryKey,
        (current: { pageParams: Array<string | null>; pages: GuestMessagesPage[] } | undefined) => {
          if (!current) {
            return {
              pageParams: [null],
              pages: [{ messages: [response.message], nextCursor: null }]
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
                messages: [response.message, ...firstPage.messages].slice(0, 50)
              },
              ...restPages
            ]
          };
        }
      );
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
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearSuccessTransitionLock();
    setIsVerifying(true);
    await createMutation.mutateAsync(form);
  };

  const remainingCharacters = MESSAGE_MAX_LENGTH - form.message.length;

  return (
    <section
      id="recados"
      ref={sectionRef}
      className="overflow-hidden border-t border-border/30 bg-[linear-gradient(180deg,#f4eee5_0%,#efe4d4_100%)] py-24 md:py-32"
    >
      <div className="container mx-auto px-6">
        <motion.div
          className="mx-auto max-w-3xl text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <span className="text-xs uppercase tracking-[0.32em] text-[#8e7553]">
            Um carinho em palavras
          </span>
          <h2 className="mt-4 font-serif text-4xl text-foreground md:text-5xl">
            Recados para os Noivos
          </h2>
          <p className="mt-4 text-sm leading-7 text-muted-foreground md:text-base">
            Deixe uma lembrança carinhosa para esse novo capítulo. Cada mensagem vira
            um pedacinho da memória que queremos guardar para sempre.
          </p>
        </motion.div>

        <motion.div
          ref={cardRef}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="mx-auto mt-12 max-w-3xl rounded-[2rem] border border-[#d8c6ab]/60 bg-[#fffaf3] p-8 shadow-[0_30px_90px_-55px_rgba(115,73,27,0.55)] md:p-10"
          style={cardMinHeight ? { minHeight: `${cardMinHeight}px` } : undefined}
        >
          {submittedMessageId ? (
            <SuccessState onReset={resetForm} />
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="guest-message-author" className="text-sm font-medium text-foreground">
                  Seu nome
                </label>
                <Input
                  id="guest-message-author"
                  ref={nameInputRef}
                  value={form.authorName}
                  onChange={(e) => setForm((current) => ({ ...current, authorName: e.target.value }))}
                  maxLength={60}
                  autoComplete="name"
                  className="h-12 rounded-xl bg-background"
                  placeholder="Como você gostaria de assinar?"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="guest-message-body" className="text-sm font-medium text-foreground">
                    Sua mensagem
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {remainingCharacters} caracteres restantes
                  </span>
                </div>
                <Textarea
                  id="guest-message-body"
                  value={form.message}
                  onChange={(e) => setForm((current) => ({ ...current, message: e.target.value.slice(0, MESSAGE_MAX_LENGTH) }))}
                  maxLength={MESSAGE_MAX_LENGTH}
                  className="min-h-[9rem] rounded-2xl bg-background px-4 py-3 text-sm leading-7"
                  placeholder="Escreva aqui um recado carinhoso para os noivos."
                />
              </div>

              <div className="flex flex-col items-start justify-between gap-4 pt-2 sm:flex-row sm:items-center">
                <p className="max-w-md text-xs leading-6 text-muted-foreground">
                  Protegemos este espaço com uma validação discreta para manter os recados
                  humanos e especiais.
                </p>
                <Button
                  type="submit"
                  className="h-12 rounded-full px-8"
                  disabled={
                    createMutation.isPending ||
                    isVerifying ||
                    form.authorName.trim().length < 2 ||
                    form.message.trim().length === 0
                  }
                >
                  {createMutation.isPending || isVerifying ? (
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
          )}
        </motion.div>

        <div className="mt-16">
          <div className="mb-6 flex flex-col gap-6 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <h3 className="font-serif text-3xl text-foreground md:text-4xl">
                Carinho já deixado por aqui
              </h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                Os recados mais recentes aparecem primeiro, à esquerda do carousel.
              </p>
            </div>

            {messages.length > 0 && (
              <div className="hidden items-center gap-3 md:flex">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full border-border/50 bg-white/70 text-foreground"
                  onClick={() => emblaApi?.scrollPrev()}
                  disabled={!prevEnabled}
                  aria-label="Recado anterior"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full border-border/50 bg-white/70 text-foreground"
                  onClick={() => emblaApi?.scrollNext()}
                  disabled={!nextEnabled}
                  aria-label="Próximo recado"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>

          {messagesQuery.isLoading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando recados…
            </div>
          ) : messagesQuery.isError ? (
            <div className="rounded-[2rem] border border-[#d8c6ab]/60 bg-[#fffaf3] px-7 py-8 text-center text-sm leading-7 text-muted-foreground">
              Não conseguimos carregar os recados agora.
            </div>
          ) : messages.length === 0 ? (
            <EmptyState onFocusForm={focusForm} />
          ) : (
            <>
              <div className="pl-0 md:pl-6 lg:pl-[max(1.5rem,calc((100vw-1280px)/2))]">
                <div
                  className="cursor-grab overflow-hidden focus:outline-none active:cursor-grabbing"
                  ref={emblaRef}
                  tabIndex={0}
                  role="region"
                  aria-roledescription="carrossel"
                  aria-label="Carrossel de recados para os noivos"
                >
                  <div className="flex items-stretch gap-5 pb-3 md:gap-5 lg:gap-6">
                    {messages.map((message, index) => (
                      <MessageCard key={message.messageId} message={message} index={index} />
                    ))}
                  </div>
                </div>
              </div>

              {messagesQuery.hasNextPage && (
                <div className="mt-8 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full bg-white/70 px-7"
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
            </>
          )}
        </div>
      </div>
    </section>
  );
}
