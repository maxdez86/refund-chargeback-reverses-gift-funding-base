import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { ResponsivePhoto } from "@/components/ResponsivePhoto";
import { Button } from "@/components/ui/button";
import {
  buildSharedWidthImageFallbackSrc,
  buildSharedWidthImageSources,
} from "@/lib/media";
import { scrollToAnchor } from "@/lib/scroll-to-anchor";

type Person = {
  id: string;
  name: string;
  role?: string;
  isFamily?: boolean;
  photoSlug: string;
};

const people: Person[] = [
  { id: "nilza-e-cerqueira", name: "Nilza e Cerqueira", role: "Pais do noivo", isFamily: true, photoSlug: "nilza-e-cerqueira" },
  { id: "ronaldo", name: "Ronaldo", role: "Pai da noiva", isFamily: true, photoSlug: "ronaldo" },
  { id: "cristiane-e-juliano", name: "Cristiane e Juliano", role: "Mãe da noiva & Padrinho", isFamily: true, photoSlug: "cristiane-e-juliano" },
  { id: "alice", name: "Alice", role: "Madrinha", photoSlug: "alice" },
  // { id: "amanda-chris", name: "Amanda e Christian", photoSlug: "amanda-chris" },
  { id: "ana-clara", name: "Ana Clara", role: "Dama de honra", photoSlug: "ana-clara" },
  { id: "carlinhos", name: "Carlos Henrique", role: "Pajem", photoSlug: "carlinhos" },
  // { id: "carol-higor", name: "Carol e Higor", photoSlug: "carol-higor" },
  { id: "debora-nael", name: "Débora e Nael", photoSlug: "debora-nael" },
  { id: "drielly", name: "Drielly", role: "Madrinha", photoSlug: "drielly" },
  { id: "elis-son", name: "Elís e Emerson", photoSlug: "elis-son" },
  { id: "fabi-fernando", name: "Fabiola e Fernando", photoSlug: "fabi-fernando" },
  { id: "heitor", name: "Heitor", role: "Pajem", photoSlug: "heitor" },
  { id: "julia", name: "Julia", role: "Madrinha", photoSlug: "julia" },
  { id: "kelly-e-sa", name: "Kelly e Samuel", photoSlug: "kelly-e-sa" },
  { id: "lila-e-welton", name: "Lila e Welton", photoSlug: "lila-e-welton" },
  { id: "luiza", name: "Luiza", role: "Florista", photoSlug: "luiza" },
  { id: "nessa-carlos", name: "Vanessa e Carlos", photoSlug: "nessa-carlos" },
  { id: "nicolas", name: "Nícolas", role: "Pajem", photoSlug: "nicolas" },
  { id: "nuza-sid", name: "Vanuzia e Sidnei", photoSlug: "nuza-sid" },
  { id: "raquel", name: "Raquel", role: "Madrinha", photoSlug: "raquel" },
  { id: "tami-e-marcos", name: "Tamires e Marcos", photoSlug: "tami-e-marcos" },
];

const PADRINHOS_IMAGE_SIZES = "(max-width: 767px) 85vw, (max-width: 1279px) 45vw, 32vw";

export function Padrinhos() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: "start", skipSnaps: false });
  const [prevEnabled, setPrevEnabled] = useState(false);
  const [nextEnabled, setNextEnabled] = useState(true);

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);

  const scrollToNext = useCallback(() => {
    scrollToAnchor("#fornecedores");
  }, []);

  const scrollToPrev = useCallback(() => {
    scrollToAnchor("#local");
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
      const photoEl = root.querySelector<HTMLElement>("[data-padrinhos-photo]");
      if (!photoEl) return;
      const band = photoEl.getBoundingClientRect();
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

  return (
    <section
      id="padrinhos"
      aria-labelledby="padrinhos-heading"
      className="padrinhos-v4 overflow-hidden bg-accent/30 py-4 text-foreground md:py-5"
    >
      <div className="container relative mx-auto mb-3 flex flex-col justify-between gap-6 px-6 md:mb-3 md:flex-row md:items-end">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-xl"
        >
          <h2 id="padrinhos-heading" className="padrinhos-v4-heading">
            O Cortejo
          </h2>
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
            aria-label="Pessoa anterior"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full border-border/50 text-foreground"
            onClick={scrollNext}
            disabled={!nextEnabled}
            aria-label="Próxima pessoa"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
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
          aria-label="Carrossel de padrinhos, madrinhas e família"
        >
          <div className="flex gap-5 pb-3 md:gap-6 md:pb-4">
            {people.map((person, index) => {
              const eyebrow = person.role ?? (person.isFamily ? "Família" : "Madrinha & Padrinho");
              return (
                <motion.article
                  key={person.id}
                  className="flex-[0_0_85%] md:flex-[0_0_45%] lg:flex-[0_0_32%] min-w-0"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: Math.min(index, 3) * 0.08 }}
                  aria-labelledby={`person-name-${person.id}`}
                >
                  <div
                    data-padrinhos-photo
                    className={`relative mb-3 flex h-[21rem] items-center justify-center overflow-hidden rounded-2xl bg-[#efe6d7] md:h-[23rem] lg:h-[25rem] xl:h-[27rem] ${
                      person.isFamily
                        ? "ring-2 ring-[#d6ae64] ring-offset-2 ring-offset-[#f5efe6]"
                        : ""
                    }`}
                  >
                    <ResponsivePhoto
                      section="padrinhos"
                      sources={buildSharedWidthImageSources("padrinhos", person.photoSlug, PADRINHOS_IMAGE_SIZES)}
                      fallbackSrc={buildSharedWidthImageFallbackSrc("padrinhos", person.photoSlug)}
                      alt=""
                      pictureClassName="block h-full w-full"
                      className="h-full w-full object-contain object-center"
                      loading="lazy"
                    />
                    <div className="absolute left-3 top-3 rounded-full bg-background/85 px-3 py-1 text-xs font-medium uppercase tracking-widest text-foreground/80 backdrop-blur-sm">
                      {String(index + 1).padStart(2, "0")} / {String(people.length).padStart(2, "0")}
                    </div>
                  </div>
                  <div className="pr-4">
                    <span className="mb-2.5 block text-xs font-medium uppercase tracking-[0.18em] text-foreground/40">
                      {eyebrow}
                    </span>
                    <h3
                      id={`person-name-${person.id}`}
                      className="mb-2 font-serif text-2xl text-foreground md:text-[1.9rem] xl:text-3xl"
                    >
                      {person.name}
                    </h3>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </div>
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
    </section>
  );
}
