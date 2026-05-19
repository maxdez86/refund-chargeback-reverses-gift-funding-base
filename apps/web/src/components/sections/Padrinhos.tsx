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
  { id: "amanda-chris", name: "Amanda e Chris", photoSlug: "amanda-chris" },
  { id: "ana-clara", name: "Ana Clara", role: "Dama de honra", photoSlug: "ana-clara" },
  { id: "carlinhos", name: "Carlinhos", role: "Pajem", photoSlug: "carlinhos" },
  { id: "carol-higor", name: "Carol e Igor", photoSlug: "carol-higor" },
  { id: "debora-nael", name: "Débora e Nael", photoSlug: "debora-nael" },
  { id: "drielly", name: "Drielly", role: "Madrinha", photoSlug: "drielly" },
  { id: "elis-son", name: "Elís e Son", photoSlug: "elis-son" },
  { id: "fabi-fernando", name: "Fabi e Fernando", photoSlug: "fabi-fernando" },
  { id: "heitor", name: "Heitor", role: "Pajem", photoSlug: "heitor" },
  { id: "julia", name: "Julia", role: "Madrinha", photoSlug: "julia" },
  { id: "kelly-e-sa", name: "Kelly e Sá", photoSlug: "kelly-e-sa" },
  { id: "lila-e-welton", name: "Lila e Welton", photoSlug: "lila-e-welton" },
  { id: "luiza", name: "Luiza", role: "Florista", photoSlug: "luiza" },
  { id: "nessa-carlos", name: "Nessa e Carlos", photoSlug: "nessa-carlos" },
  { id: "nicolas", name: "Nícolas", role: "Pajem", photoSlug: "nicolas" },
  { id: "nuza-sid", name: "Nuza e Sid", photoSlug: "nuza-sid" },
  { id: "raquel", name: "Raquel", role: "Madrinha", photoSlug: "raquel" },
  { id: "tami-e-marcos", name: "Tami e Marcos", photoSlug: "tami-e-marcos" },
];

const PADRINHOS_IMAGE_SIZES = "(max-width: 767px) 85vw, (max-width: 1279px) 45vw, 32vw";

export function Padrinhos() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: "start", skipSnaps: false });
  const [prevEnabled, setPrevEnabled] = useState(false);
  const [nextEnabled, setNextEnabled] = useState(true);

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);

  const scrollToNext = useCallback(() => {
    const el = document.querySelector("#fornecedores");
    if (!el) return;
    const offset = 80;
    const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  const scrollToPrev = useCallback(() => {
    const el = document.querySelector("#local");
    if (!el) return;
    const offset = 80;
    const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top, behavior: "smooth" });
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
      className="padrinhos-v4 overflow-hidden bg-accent/30 py-4 text-foreground md:py-6"
    >
      <div className="container mx-auto px-6 mb-2 md:mb-3 flex flex-col md:flex-row md:items-end justify-between gap-8 relative">
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
            className="rounded-full h-12 w-12 border-border/50 text-foreground animate-bounce pointer-events-auto"
            onClick={scrollToPrev}
            aria-label="Rolar para a seção anterior"
          >
            <ChevronUp className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-12 w-12 border-border/50 text-foreground"
            onClick={scrollPrev}
            disabled={!prevEnabled}
            aria-label="Pessoa anterior"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-12 w-12 border-border/50 text-foreground"
            onClick={scrollNext}
            disabled={!nextEnabled}
            aria-label="Próxima pessoa"
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
          aria-label="Carrossel de padrinhos, madrinhas e família"
        >
          <div className="flex gap-6 md:gap-8 pb-2">
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
                    className={`aspect-[5/6] rounded-2xl overflow-hidden mb-3 bg-muted relative ${
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
                      className="w-full h-full object-cover transition-transform duration-700 hover:scale-[1.03]"
                      loading="lazy"
                    />
                    <div className="absolute top-4 left-4 bg-background/85 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-medium tracking-widest uppercase text-foreground/80">
                      {String(index + 1).padStart(2, "0")} / {String(people.length).padStart(2, "0")}
                    </div>
                  </div>
                  <div className="pr-4">
                    <span className="text-xs font-medium tracking-[0.2em] uppercase text-foreground/40 mb-3 block">
                      {eyebrow}
                    </span>
                    <h3
                      id={`person-name-${person.id}`}
                      className="font-serif text-2xl md:text-3xl mb-3 text-foreground"
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
          className="rounded-full h-12 w-12 border-border/50 text-foreground animate-bounce"
          onClick={scrollToNext}
          aria-label="Rolar para a próxima seção"
        >
          <ChevronDown className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
