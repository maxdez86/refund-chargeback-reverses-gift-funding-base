import React, { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const PHOTO_BASE =
  "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures";

type PrePhoto = { src: string; slot: string; caption: string };

const photos: PrePhoto[] = [
  { src: `${PHOTO_BASE}/IMG_20240111_102922.jpg`, slot: "Foto pré-wedding 01", caption: "Manhã leve, juntos." },
  { src: `${PHOTO_BASE}/IMG-20231217-WA0019.jpg`, slot: "Foto pré-wedding 02", caption: "Um instante a dois." },
  { src: `${PHOTO_BASE}/IMG_20241123_171012.jpg`, slot: "Foto pré-wedding 03", caption: "Final de tarde." },
  { src: `${PHOTO_BASE}/IMG_20250412_134057.jpg`, slot: "Foto pré-wedding 04", caption: "Caminhos compartilhados." },
  { src: `${PHOTO_BASE}/IMG_20230723_195019.jpg`, slot: "Foto pré-wedding 05", caption: "Sorrisos espontâneos." },
  { src: `${PHOTO_BASE}/IMG_20250309_065029.jpg`, slot: "Foto pré-wedding 06", caption: "Pausa para o agora." },
  { src: `${PHOTO_BASE}/IMG_20250412_134211.jpg`, slot: "Foto pré-wedding 07", caption: "A caminho do grande dia." },
];

export function PreWedding() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: "center", skipSnaps: false, loop: true });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((i: number) => emblaApi && emblaApi.scrollTo(i), [emblaApi]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
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

  return (
    <section id="pre-wedding" className="py-24 md:py-32 bg-secondary/30 overflow-hidden">
      <div className="container mx-auto px-6 mb-12 flex flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-2xl"
        >
          <span className="text-sm font-medium tracking-[0.2em] uppercase text-muted-foreground mb-4 block">
            Galeria
          </span>
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl text-foreground mb-6">
            Pré-Wedding
          </h2>
          <p className="text-lg text-muted-foreground font-light leading-relaxed">
            Alguns registros para guardar a atmosfera desse caminho até o casamento.
          </p>
        </motion.div>
      </div>

      <div className="w-full relative px-4 md:px-0">
        <div
          className="overflow-hidden cursor-grab active:cursor-grabbing focus:outline-none"
          ref={emblaRef}
          tabIndex={0}
          role="region"
          aria-roledescription="carrossel"
          aria-label="Galeria de fotos pré-wedding"
        >
          <div className="flex gap-4 md:gap-8 pb-8 items-center">
            {photos.map((p, index) => {
              const isActive = selectedIndex === index;
              return (
                <motion.figure
                  key={index}
                  className={`flex-[0_0_78%] md:flex-[0_0_45%] lg:flex-[0_0_34%] min-w-0 transition-opacity duration-500 ${
                    isActive ? "opacity-100" : "opacity-60"
                  }`}
                  initial={{ opacity: 0, scale: 0.96 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6 }}
                >
                  <div className="aspect-[4/5] rounded-xl overflow-hidden bg-muted shadow-lg relative">
                    <img
                      src={p.src}
                      alt={`${p.slot} — Brida e Max`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <figcaption className="mt-4 px-1 flex items-baseline justify-between gap-3">
                    <span className="text-xs font-medium tracking-[0.2em] uppercase text-foreground/40">
                      {String(index + 1).padStart(2, "0")} / {String(photos.length).padStart(2, "0")}
                    </span>
                    <span className="text-sm md:text-base text-foreground/70 font-light italic text-right">
                      {p.caption}
                    </span>
                  </figcaption>
                </motion.figure>
              );
            })}
          </div>
        </div>

        <div className="container mx-auto px-6 flex flex-col items-center gap-4 mt-6">
          <div className="flex justify-center gap-2" role="tablist" aria-label="Progresso da galeria">
            {photos.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => scrollTo(i)}
                aria-label={`Ir para a foto ${i + 1}`}
                aria-selected={selectedIndex === i}
                role="tab"
                className={`h-2 rounded-full transition-all duration-300 ${
                  selectedIndex === i ? "w-8 bg-foreground" : "w-2 bg-foreground/25 hover:bg-foreground/50"
                }`}
              />
            ))}
          </div>

          <div className="hidden md:flex justify-center gap-3 mt-2">
            <Button
              variant="outline"
              size="icon"
              className="rounded-full h-12 w-12 border-border/50 text-foreground bg-background/50 backdrop-blur-sm"
              onClick={scrollPrev}
              aria-label="Foto anterior"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="rounded-full h-12 w-12 border-border/50 text-foreground bg-background/50 backdrop-blur-sm"
              onClick={scrollNext}
              aria-label="Próxima foto"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
