import { useCallback, useEffect, useMemo, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Minus, Plus, Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { type CreatePaymentRequest } from "@brimax/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { createPayment, PaymentApiError } from "@/lib/payments-api";
import { LAST_PAYMENT_ID_STORAGE_KEY } from "@/lib/payment-flow";

type Gift = {
  id: string;
  name: string;
  image: string;
  totalValue: number;
  fractional: boolean;
  partValue: number | null;
  totalParts: number | null;
  partsFunded: number | null;
  fullyFunded: boolean;
};

const PHOTO_BASE =
  "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures";

const giftImage = (filename: string) =>
  `${PHOTO_BASE}/gifts/${encodeURIComponent(filename)}`;

const localGiftImage = (filename: string) => `/images/${filename}`;

const single = (id: string, name: string, price: number, file: string): Gift => ({
  id,
  name,
  image: giftImage(file),
  totalValue: price,
  fractional: false,
  partValue: null,
  totalParts: null,
  partsFunded: null,
  fullyFunded: false,
});

const fractional = (id: string, name: string, price: number, file: string): Gift => {
  const partValue = 50;
  return {
    id,
    name,
    image: giftImage(file),
    totalValue: price,
    fractional: true,
    partValue,
    totalParts: Math.ceil(price / partValue),
    partsFunded: 0,
    fullyFunded: false,
  };
};

const giftsData: Gift[] = [
  {
    id: "g-test-pix",
    name: "PIX Teste",
    image: localGiftImage("gifts-home.png"),
    totalValue: 5,
    fractional: false,
    partValue: null,
    totalParts: null,
    partsFunded: null,
    fullyFunded: false,
  },
  single("g-toalhas-banho", "4 Toalhas de Banho", 176, "4 Toalhas De Banho_176.jpg"),
  fractional("g-armario", "Armário de Cozinha", 1749, "armario_cozinha_ 1749.webp"),
  single("g-aspirador", "Aspirador", 139, "aspirador_139.jpg"),
  single("g-balde", "Balde Retrátil 10L", 69, "Balde 10l Retrátil_69.webp"),
  single("g-batedeira", "Batedeira", 79, "Batedeira_79.jpg"),
  fractional("g-cama", "Cama", 1199, "cama_1199.webp"),
  single("g-edredom", "Edredom King", 136, "edredom-king_136.webp"),
  single("g-escorredor", "Escorredor de Louça", 100, "Escorredores de Louça_100.jpg"),
  fractional("g-fogao", "Fogão", 1000, "fogao_1000.jpg"),
  fractional("g-guarda-roupa", "Guarda-roupa", 3000, "Guarda-roupa_3000.jpg"),
  single("g-ferramentas", "Jogo de Ferramentas", 99, "Jogo De Ferramentas_99.webp"),
  fractional("g-pratos", "Jogo de Pratos 12 Peças", 331, "jogo_prato_12pecas_331.jpg"),
  single("g-talheres", "Jogo de Talheres", 178, "jogo_talheres_178.jpg"),
  single("g-xicaras", "Jogo de Xícaras", 188, "jogo_de_xicara_188.webp"),
  single("g-toalhas-rosto", "Kit 4 Toalhas de Rosto", 65, "Kit 4 Toalhas De Rosto_65.jpg"),
  fractional("g-lava-seca", "Lava e Seca 11kg", 2900, "Lava e Seca 11kg_2900.jpg"),
  fractional("g-lava-loucas", "Lava-louças", 1900, "Lava-louças_1900.jpg"),
  single("g-liquidificador", "Liquidificador", 94, "liquidificador_94.jpg"),
  fractional("g-mesa", "Mesa de Jantar", 650, "mesa_650.webp"),
  fractional("g-microondas", "Micro-ondas", 484, "microondas_484.jpg"),
  single("g-processador", "Processador de Alimentos", 129, "processador_129.jpg"),
  single("g-purificador", "Purificador de Água", 169, "purificador_agua_169.png"),
  fractional("g-refrigerador", "Geladeira Brastemp", 2960, "Geladeira_Brastemp_2960.jpg"),
  fractional("g-sofa", "Sofá", 1482, "sofa_ 1482.webp"),
  single("g-steamer", "Steamer", 141, "steamer_141.jpg"),
  single("g-travesseiros", "Travesseiros", 59, "travesseiros_59.jpg"),
];

const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function isFullyFunded(g: Gift): boolean {
  if (g.fractional && g.totalParts != null && g.partsFunded != null) {
    return g.partsFunded >= g.totalParts;
  }
  return g.fullyFunded;
}

function fundedPercent(g: Gift): number {
  if (!g.fractional || !g.totalParts || g.partsFunded == null) return 0;
  return Math.min(100, Math.round((g.partsFunded / g.totalParts) * 100));
}

function sortGifts(gifts: Gift[]): Gift[] {
  return [...gifts].sort((a, b) => {
    const bucket = (g: Gift) => {
      if (isFullyFunded(g)) return 4;
      if (!g.fractional) return 1;
      if ((g.partsFunded ?? 0) === 0) return 2;
      return 3;
    };
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;
    if (ba === 3) return fundedPercent(a) - fundedPercent(b);
    return 0;
  });
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

function GiftCard({ gift, onOpen }: { gift: Gift; onOpen: (g: Gift) => void }) {
  const fullFunded = isFullyFunded(gift);
  const percent = gift.fractional ? fundedPercent(gift) : fullFunded ? 100 : 0;
  const remainingParts =
    gift.fractional && gift.totalParts != null && gift.partsFunded != null
      ? gift.totalParts - gift.partsFunded
      : 0;
  const fundedAmount =
    gift.fractional && gift.partValue != null && gift.partsFunded != null
      ? gift.partValue * gift.partsFunded
      : 0;

  return (
    <article
      className={`flex flex-col h-full bg-card border border-border/50 rounded-2xl overflow-hidden shadow-sm transition-all ${
        fullFunded ? "opacity-70" : "hover:shadow-md"
      }`}
      aria-label={`${gift.name} — ${formatBRL(gift.totalValue)}${
        fullFunded ? " — presente já garantido" : ""
      }`}
    >
      <div className="relative aspect-[4/5] bg-muted overflow-hidden">
        <img
          src={gift.image}
          alt={gift.name}
          loading="lazy"
          className={`w-full h-full object-cover ${fullFunded ? "grayscale" : ""}`}
        />
        {fullFunded && (
          <div className="absolute inset-0 bg-background/40 flex items-center justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-background/90 px-4 py-2 text-xs font-medium tracking-widest uppercase text-foreground/80 shadow-sm">
              <Check className="h-3 w-3" aria-hidden="true" />
              Presente já garantido
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col flex-1 p-6 gap-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif text-xl text-foreground leading-snug">
            {gift.name}
          </h3>
          {gift.fractional && (
            <span className="shrink-0 text-[10px] font-medium tracking-widest uppercase text-foreground/55 mt-1">
              Cotas
            </span>
          )}
        </div>

        <div className="mt-2">
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
          <div className="mt-2 space-y-2">
            <ProgressBar percent={percent} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {formatBRL(fundedAmount)} de {formatBRL(gift.totalValue)}
              </span>
              <span>{percent}%</span>
            </div>
            {!fullFunded && (
              <div className="text-xs text-muted-foreground">
                {remainingParts}{" "}
                {remainingParts === 1 ? "cota restante" : "cotas restantes"}
              </div>
            )}
          </div>
        )}

        <div className="mt-auto pt-4">
          {fullFunded ? (
            <Button
              variant="outline"
              className="w-full rounded-full h-11 cursor-not-allowed"
              disabled
              aria-disabled="true"
            >
              Presente já garantido
            </Button>
          ) : (
            <Button
              className="w-full rounded-full h-11"
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

function GiftDialog({
  gift,
  open,
  onOpenChange,
}: {
  gift: Gift | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [step, setStep] = useState<"select" | "confirm">("select");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setQuantity(1);
    setStep("select");
    setSubmitting(false);
  }, [gift?.id, open]);

  if (!gift) return null;

  const remainingParts =
    gift.fractional && gift.totalParts != null && gift.partsFunded != null
      ? gift.totalParts - gift.partsFunded
      : 0;
  const partValue = gift.partValue ?? 0;
  const contribution = gift.fractional ? quantity * partValue : gift.totalValue;
  const percent = gift.fractional ? fundedPercent(gift) : 0;

  const dec = () => setQuantity((q) => Math.max(1, q - 1));
  const inc = () =>
    setQuantity((q) => Math.min(remainingParts || 1, q + 1));

  const handleOpenChange = (next: boolean) => {
    if (submitting && !next) return;
    onOpenChange(next);
  };

  const onSubmit = async () => {
    setSubmitting(true);
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
      window.localStorage.setItem(
        LAST_PAYMENT_ID_STORAGE_KEY,
        JSON.stringify({ paymentId: payment.paymentId, createdAt: Date.now() })
      );
      window.location.href = payment.checkout.url;
    } catch (err) {
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
      <DialogContent className="sm:max-w-lg bg-background rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-foreground">
            {gift.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {step === "select"
              ? gift.fractional
                ? "Escolha quantas cotas você gostaria de presentear."
                : "Confirme abaixo para sinalizar este presente."
              : "Confira o valor e siga para o pagamento na Asaas."}
          </DialogDescription>
        </DialogHeader>

        {step === "select" ? (
          <div className="space-y-5">
            <div className="aspect-[4/3] rounded-xl overflow-hidden bg-muted">
              <img
                src={gift.image}
                alt={gift.name}
                className="w-full h-full object-cover"
              />
            </div>

            {gift.fractional && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Cada cota</span>
                  <span className="font-medium text-foreground">
                    {formatBRL(partValue)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Disponível</span>
                  <span className="font-medium text-foreground">
                    {remainingParts}{" "}
                    {remainingParts === 1 ? "cota" : "cotas"}
                  </span>
                </div>

                <div className="space-y-2">
                  <ProgressBar percent={percent} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{percent}% arrecadado</span>
                    <span>
                      {formatBRL((gift.partsFunded ?? 0) * partValue)} de{" "}
                      {formatBRL(gift.totalValue)}
                    </span>
                  </div>
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
              >
                Cancelar
              </Button>
              <Button
                type="button"
                className="rounded-full flex-1"
                onClick={() => setStep("confirm")}
              >
                Continuar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
              <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total a pagar</span>
                  <span className="font-serif text-xl text-foreground">
                    {formatBRL(contribution)}
                  </span>
                </div>
                {gift.fractional && (
                  <p className="text-sm text-muted-foreground">
                    {quantity} {quantity === 1 ? "cota" : "cotas"} de {formatBRL(partValue)}
                  </p>
                )}
              </div>

              <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background p-4 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                <span>
                  Pagamento seguro via Asaas.
                </span>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full flex-1"
                  onClick={() => setStep("select")}
                  disabled={submitting}
                >
                  Voltar
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
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Presentes() {
  const sorted = useMemo(() => sortGifts(giftsData), []);
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    skipSnaps: false,
  });
  const [prevEnabled, setPrevEnabled] = useState(false);
  const [nextEnabled, setNextEnabled] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeGift, setActiveGift] = useState<Gift | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((i: number) => emblaApi && emblaApi.scrollTo(i), [emblaApi]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setPrevEnabled(emblaApi.canScrollPrev());
    setNextEnabled(emblaApi.canScrollNext());
    setSelectedIndex(emblaApi.selectedScrollSnap());
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
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 4) return;
      const goingNext = delta > 0;
      if (goingNext && !emblaApi.canScrollNext()) return;
      if (!goingNext && !emblaApi.canScrollPrev()) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastFire < 220) return;
      lastFire = now;
      if (goingNext) emblaApi.scrollNext();
      else emblaApi.scrollPrev();
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [emblaApi]);

  const handleOpen = (g: Gift) => {
    setActiveGift(g);
    setDialogOpen(true);
  };

  return (
    <section
      id="presentes"
      className="py-16 md:py-20 bg-[#fbf7f0] border-t border-border/30 overflow-hidden"
    >
      <div className="container mx-auto px-6 mb-8 md:mb-12 flex flex-col md:flex-row md:items-end justify-between gap-8">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-xl"
        >
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl text-foreground mb-6">
            Se você quiser nos<br />presentear
          </h2>
        </motion.div>

        <div className="hidden md:flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-12 w-12 border-border/50 text-foreground"
            onClick={scrollPrev}
            disabled={!prevEnabled}
            aria-label="Presente anterior"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-12 w-12 border-border/50 text-foreground"
            onClick={scrollNext}
            disabled={!nextEnabled}
            aria-label="Próximo presente"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="pl-6 md:pl-12 lg:pl-[max(1.5rem,calc((100vw-1280px)/2))]">
        <div
          className="overflow-hidden cursor-grab active:cursor-grabbing focus:outline-none"
          ref={emblaRef}
          tabIndex={0}
          role="region"
          aria-roledescription="carrossel"
          aria-label="Carrossel de presentes"
        >
          <div className="flex gap-4 md:gap-6 pb-12 items-stretch">
            {sorted.map((gift, index) => (
              <motion.div
                key={gift.id}
                className="flex-[0_0_82%] md:flex-[0_0_42%] lg:flex-[0_0_28%] min-w-0 flex"
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
      </div>

      <div
        className="container mx-auto px-6 mt-2 flex justify-center gap-2"
        role="tablist"
        aria-label="Progresso da lista de presentes"
      >
        {sorted.map((g, i) => (
          <button
            key={g.id}
            type="button"
            onClick={() => scrollTo(i)}
            aria-label={`Ir para ${g.name}`}
            aria-selected={selectedIndex === i}
            role="tab"
            className={`h-2 rounded-full transition-all duration-300 ${
              selectedIndex === i
                ? "w-8 bg-foreground"
                : "w-2 bg-foreground/25 hover:bg-foreground/50"
            }`}
          />
        ))}
      </div>

      <GiftDialog
        gift={activeGift}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </section>
  );
}
