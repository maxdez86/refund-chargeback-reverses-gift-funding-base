import React, { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type Chapter = {
  number: string;
  title: string;
  text: string;
  image: string;
  imageAlt: string;
};

const PHOTO_BASE =
  "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures";

const chapters: Chapter[] = [
  {
    number: "Capítulo 01",
    title: "A aula de teatro",
    text: "Tudo começou nas aulas de teatro, onde Brida e Max se conheceram entre ensaios, marcações e olhares trocados em cena.",
    image: `${PHOTO_BASE}/IMG_20230723_195019.jpg`,
    imageAlt: "Brida e Max em um momento juntos",
  },
  {
    number: "Capítulo 02",
    title: "Par romântico em cena",
    text: "Foram escalados como par romântico em uma peça. O que era ficção começou a ganhar contornos de algo verdadeiro.",
    image: `${PHOTO_BASE}/IMG_20230828_110138.jpg`,
    imageAlt: "Brida e Max sorrindo lado a lado",
  },
  {
    number: "Capítulo 03",
    title: "O primeiro beijo",
    text: "Durante um ensaio, veio o primeiro beijo. Sem plateia, sem cortina aberta — só os dois e a certeza de que algo tinha mudado.",
    image: `${PHOTO_BASE}/IMG-20231217-WA0019.jpg`,
    imageAlt: "Brida e Max em um momento de carinho",
  },
  {
    number: "Capítulo 04",
    title: "Depois da cortina",
    text: "Quando a peça terminou, a história entre eles continuou. Começaram a namorar levando para a vida o que tinha começado no palco.",
    image: `${PHOTO_BASE}/IMG_20240111_102922.jpg`,
    imageAlt: "Brida e Max curtindo o tempo juntos",
  },
  {
    number: "Capítulo 05",
    title: "Belo Horizonte",
    text: "Em uma viagem a Belo Horizonte para assistir a um jogo de futebol, veio o pedido oficial de namoro — entre torcida, cidade nova e um sim inesquecível.",
    image: `${PHOTO_BASE}/IMG_20240112_131120.jpg`,
    imageAlt: "Brida e Max em uma viagem juntos",
  },
  {
    number: "Capítulo 06",
    title: "Mais de 12 viagens",
    text: "De lá para cá, foram mais de doze viagens compartilhadas. Cada destino virou uma página a mais dessa história em comum.",
    image: `${PHOTO_BASE}/IMG_20241123_171012.jpg`,
    imageAlt: "Brida e Max em uma de suas viagens",
  },
  {
    number: "Capítulo 07",
    title: "O pedido nas alturas",
    text: "O pedido de casamento aconteceu em pleno voo de balão. Lá em cima, com o mundo inteiro embaixo, veio o sim que trouxe vocês até este dia.",
    image: `${PHOTO_BASE}/IMG_20240908_210941.jpg`,
    imageAlt: "Brida e Max no momento do pedido de casamento",
  },
];

export function Story() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: "start", skipSnaps: false });
  const [prevEnabled, setPrevEnabled] = useState(false);
  const [nextEnabled, setNextEnabled] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

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

  return (
    <section id="historia" className="py-16 md:py-20 bg-[#f4eee5] overflow-hidden">
      <div className="container mx-auto px-6 mb-8 md:mb-12 flex flex-col md:flex-row md:items-end justify-between gap-8">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-xl"
        >
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl text-foreground mb-6">
            Nossa História
          </h2>
          <p className="text-lg text-muted-foreground font-light leading-relaxed">
            Antes do grande dia, existe uma história feita de encontros, palco, viagens e escolhas vividas com carinho.
          </p>
        </motion.div>

        <div className="hidden md:flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-12 w-12 border-border/50 text-foreground"
            onClick={scrollPrev}
            disabled={!prevEnabled}
            aria-label="Capítulo anterior"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-12 w-12 border-border/50 text-foreground"
            onClick={scrollNext}
            disabled={!nextEnabled}
            aria-label="Próximo capítulo"
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
          aria-label="Carrossel da nossa história"
        >
          <div className="flex gap-6 md:gap-8 pb-12">
            {chapters.map((c, index) => (
              <motion.article
                key={index}
                className="flex-[0_0_85%] md:flex-[0_0_45%] lg:flex-[0_0_32%] min-w-0"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: Math.min(index, 3) * 0.08 }}
                aria-roledescription="capítulo"
                aria-label={`${c.number}: ${c.title}`}
              >
                <div className="aspect-[3/4] rounded-2xl overflow-hidden mb-6 bg-muted relative">
                  <img
                    src={c.image}
                    alt={c.imageAlt}
                    className="w-full h-full object-cover transition-transform duration-700 hover:scale-[1.03]"
                    loading="lazy"
                  />
                  <div className="absolute top-4 left-4 bg-background/85 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-medium tracking-widest uppercase text-foreground/80">
                    {String(index + 1).padStart(2, "0")} / {String(chapters.length).padStart(2, "0")}
                  </div>
                </div>
                <div className="pr-4">
                  <span className="text-xs font-medium tracking-[0.2em] uppercase text-foreground/40 mb-3 block">
                    {c.number}
                  </span>
                  <h3 className="font-serif text-2xl md:text-3xl mb-3 text-foreground">{c.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{c.text}</p>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </div>

      {/* Progress dots */}
      <div className="container mx-auto px-6 mt-4 flex justify-center gap-2" role="tablist" aria-label="Progresso da história">
        {chapters.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => scrollTo(i)}
            aria-label={`Ir para o capítulo ${i + 1}`}
            aria-selected={selectedIndex === i}
            role="tab"
            className={`h-2 rounded-full transition-all duration-300 ${
              selectedIndex === i ? "w-8 bg-foreground" : "w-2 bg-foreground/25 hover:bg-foreground/50"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
