import React, { useCallback, useEffect, useMemo, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Minus, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Gift = {
  id: string;
  name: string;
  description?: string;
  image: string;
  totalValue: number;
  fractional: boolean;
  partValue: number | null;
  totalParts: number | null;
  partsFunded: number | null;
  fullyFunded: boolean;
};

const giftsData: Gift[] = [
  {
    id: "presente-01",
    name: "Robô de Cozinha",
    description: "Para cozinhar juntos com mais praticidade.",
    image:
      "https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?w=800&q=80&auto=format&fit=crop",
    totalValue: 1200,
    fractional: true,
    partValue: 60,
    totalParts: 20,
    partsFunded: 5,
    fullyFunded: false,
  },
  {
    id: "presente-02",
    name: "Jogo de Panelas",
    description: "Receber amigos em casa com carinho.",
    image:
      "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80&auto=format&fit=crop",
    totalValue: 800,
    fractional: true,
    partValue: 50,
    totalParts: 16,
    partsFunded: 0,
    fullyFunded: false,
  },
  {
    id: "presente-03",
    name: "Aparelho de Jantar",
    description: "Mesa posta para os almoços de família.",
    image:
      "https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=800&q=80&auto=format&fit=crop",
    totalValue: 600,
    fractional: true,
    partValue: 50,
    totalParts: 12,
    partsFunded: 8,
    fullyFunded: false,
  },
  {
    id: "presente-04",
    name: "Aspirador Robô",
    description: "Mais tempo livre no fim de semana.",
    image:
      "https://images.unsplash.com/photo-1647937415049-2c8f2f8b5b58?w=800&q=80&auto=format&fit=crop",
    totalValue: 500,
    fractional: true,
    partValue: 50,
    totalParts: 10,
    partsFunded: 10,
    fullyFunded: false,
  },
  {
    id: "presente-05",
    name: "Jogo de Cama King",
    description: "Conforto para os dias de descanso.",
    image:
      "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&q=80&auto=format&fit=crop",
    totalValue: 350,
    fractional: true,
    partValue: 50,
    totalParts: 7,
    partsFunded: 2,
    fullyFunded: false,
  },
  {
    id: "presente-06",
    name: "Jogo de Toalhas",
    description: "Toalhas macias para o novo lar.",
    image:
      "https://images.unsplash.com/photo-1584208632869-f0e8aaccdb20?w=800&q=80&auto=format&fit=crop",
    totalValue: 150,
    fractional: false,
    partValue: null,
    totalParts: null,
    partsFunded: null,
    fullyFunded: false,
  },
  {
    id: "presente-07",
    name: "Porta-retratos",
    description: "Para guardar lembranças desse dia.",
    image:
      "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=800&q=80&auto=format&fit=crop",
    totalValue: 80,
    fractional: false,
    partValue: null,
    totalParts: null,
    partsFunded: null,
    fullyFunded: false,
  },
  {
    id: "presente-08",
    name: "Vela decorativa",
    description: "Aroma suave para a sala de estar.",
    image:
      "https://images.unsplash.com/photo-1602874801007-aa20fecd5c8d?w=800&q=80&auto=format&fit=crop",
    totalValue: 60,
    fractional: false,
    partValue: null,
    totalParts: null,
    partsFunded: null,
    fullyFunded: true,
  },
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

        {gift.description && (
          <p className="text-sm text-muted-foreground font-light leading-relaxed">
            {gift.description}
          </p>
        )}

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
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setQuantity(1);
    setConfirmed(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-background rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-foreground">
            {gift.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {gift.fractional
              ? "Escolha quantas cotas você gostaria de presentear."
              : "Confirme abaixo para sinalizar este presente."}
          </DialogDescription>
        </DialogHeader>

        {confirmed ? (
          <div className="py-6 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-secondary/60 flex items-center justify-center">
              <Check className="h-6 w-6 text-foreground" aria-hidden="true" />
            </div>
            <h4 className="font-serif text-xl text-foreground">
              Obrigado pelo seu carinho!
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Obrigado pelo seu interesse! O link para a lista completa estará
              disponível em breve.
            </p>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Fechar
            </Button>
          </div>
        ) : (
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
                    <input
                      id="qty"
                      type="number"
                      min={1}
                      max={remainingParts}
                      step={1}
                      value={quantity}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n)) {
                          setQuantity(
                            Math.max(1, Math.min(remainingParts || 1, n))
                          );
                        }
                      }}
                      className="w-16 text-center bg-background border border-border rounded-xl h-10 font-medium text-foreground"
                    />
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
                onClick={() => setConfirmed(true)}
              >
                Confirmar contribuição
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

  const handleOpen = (g: Gift) => {
    setActiveGift(g);
    setDialogOpen(true);
  };

  return (
    <section
      id="presentes"
      className="py-24 md:py-32 bg-background border-t border-border/30 overflow-hidden"
    >
      <div className="container mx-auto px-6 mb-12 md:mb-16 flex flex-col md:flex-row md:items-end justify-between gap-8">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-xl"
        >
          <span className="text-sm font-medium tracking-[0.2em] uppercase text-muted-foreground mb-4 block">
            Carinho em forma de presente
          </span>
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl text-foreground mb-6">
            Lista de Presentes
          </h2>
          <p className="text-lg text-muted-foreground font-light leading-relaxed">
            Se quiser nos presentear, preparamos uma seleção para nossa nova fase.
          </p>
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

      <p className="container mx-auto px-6 mt-6 text-center text-xs text-muted-foreground max-w-2xl">
        Demonstração da lista. As cotas e contribuições serão conectadas a um
        meio de pagamento real em breve.
      </p>

      <GiftDialog
        gift={activeGift}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </section>
  );
}
