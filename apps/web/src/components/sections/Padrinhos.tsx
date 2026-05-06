import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const PHOTO_BASE =
  "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures";

const placeholderPhotos = [
  "IMG-20231217-WA0019.jpg",
  "IMG_20230723_195019.jpg",
  "IMG_20230828_110138.jpg",
  "IMG_20240111_102922.jpg",
  "IMG_20240112_131120.jpg",
  "IMG_20240908_210941.jpg",
  "IMG_20241123_171012.jpg",
  "IMG_20250309_065029.jpg",
  "IMG_20250412_134057.jpg",
  "IMG_20250412_134211.jpg",
];

type Person = {
  id: string;
  name: string;
  role?: string;
  isFamily?: boolean;
  photo?: string;
};

const people: Person[] = [
  { id: "nilza-cerqueira", name: "Nilza e Cerqueira", role: "Pais do noivo", isFamily: true, photo: "padrinhos/Nilza%20e%20Cerqueira.jpeg" },
  { id: "ronaldo", name: "Ronaldo", role: "Pai da noiva", isFamily: true },
  { id: "cristiane-juliano", name: "Cristiane e Juliano", role: "Mãe da noiva", isFamily: true },
  { id: "alice", name: "Alice", role: "Madrinha", photo: "padrinhos/Alice.jpeg" },
  { id: "amanda-cris", name: "Amanda e Chris" },
  { id: "ana-clara", name: "Ana Clara", role: "Dama de honra" },
  { id: "Carlinhos", name: "Carlinhos", role: "Pajem" },
  { id: "carol-igor", name: "Carol e Igor" },
  { id: "debora-nael", name: "Débora e Nael" },
  { id: "drielly", name: "Drielly", role: "Madrinha", photo: "padrinhos/Drielly.jpeg" },
  { id: "elis-son", name: "Elis e Son" },
  { id: "fabi-fernando", name: "Fabi e Fernando" },
  { id: "heitor", name: "Heitor", role: "Pajem" },
  { id: "julia", name: "Julia", role: "Madrinha" },
  { id: "kelly-sa", name: "Kelly e Sá" },
  { id: "lila-welton", name: "Lila e Welton", photo: "padrinhos/Lila%20e%20Welton.jpeg" },
  { id: "luiza", name: "Luiza", role: "Dama de honra", photo: "padrinhos/Luiza.jpeg" },
  { id: "nessa-carlos", name: "Nessa e Carlos" },
  { id: "nicolas", name: "Nícolas", role: "Pajem" },
  { id: "nuza-sid", name: "Nuza e Sid" },
  { id: "raquel", name: "Raquel", role: "Madrinha", photo: "padrinhos/Raquel.jpeg" },
  { id: "tami-marcos", name: "Tami e Marcos", photo: "padrinhos/Tami%20e%20Marcos.jpeg" },
];

export function Padrinhos() {
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
    <section
      id="padrinhos"
      aria-labelledby="padrinhos-heading"
      className="padrinhos-v4 overflow-hidden bg-[#f5efe6] py-24 text-foreground md:py-32"
    >
      <div className="container mx-auto px-6 mb-12 md:mb-20 flex flex-col md:flex-row md:items-end justify-between gap-8">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-xl"
        >
          <h2 id="padrinhos-heading" className="padrinhos-v4-heading mb-4">
            O Cortejo
          </h2>
        </motion.div>

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
          <div className="flex gap-6 md:gap-8 pb-12">
            {people.map((person, index) => {
              const photo = person.photo ?? placeholderPhotos[index % placeholderPhotos.length];
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
                    className={`aspect-[3/4] rounded-2xl overflow-hidden mb-6 bg-muted relative ${
                      person.isFamily
                        ? "ring-2 ring-[#d6ae64] ring-offset-2 ring-offset-[#f5efe6]"
                        : ""
                    }`}
                  >
                    <img
                      src={`${PHOTO_BASE}/${photo}`}
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

      <div
        className="container mx-auto px-6 mt-4 flex justify-center gap-2"
        role="tablist"
        aria-label="Progresso do cortejo"
      >
        {people.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => scrollTo(i)}
            aria-label={`Ir para a pessoa ${i + 1}`}
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
