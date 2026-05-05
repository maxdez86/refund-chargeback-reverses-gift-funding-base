import React, { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
  { id: "nilza-cerqueira", name: "Nilza e Cerqueira", role: "Pais do noivo", isFamily: true },
  { id: "ronaldo", name: "Ronaldo", role: "Pai da noiva", isFamily: true },
  { id: "cristiane-juliano", name: "Cristiane e Juliano", role: "Mãe da noiva", isFamily: true },
  { id: "alice", name: "Alice" },
  { id: "amanda-cris", name: "Amanda e Cris" },
  { id: "ana-clara", name: "Ana Clara" },
  { id: "carilhos", name: "Carilhos" },
  { id: "carol-igor", name: "Carol e Igor" },
  { id: "debora-nael", name: "Débora e Nael" },
  { id: "drielly", name: "Drielly" },
  { id: "elis-son", name: "Elis e Son" },
  { id: "fabi-fernando", name: "Fabi e Fernando" },
  { id: "heitor", name: "Heitor" },
  { id: "julia", name: "Julia" },
  { id: "kelly-sa", name: "Kelly e Sá" },
  { id: "lila-welton", name: "Lila e Welton" },
  { id: "luiza", name: "Luiza" },
  { id: "nessa-carlos", name: "Nessa e Carlos" },
  { id: "nicolas", name: "Nícolas" },
  { id: "nuza-sid", name: "Nuza e Sid" },
  { id: "raquel", name: "Raquel" },
  { id: "tami-marcos", name: "Tami e Marcos" },
];

function PersonCard({ person, index }: { person: Person; index: number }) {
  const photo = person.photo ?? placeholderPhotos[index % placeholderPhotos.length];

  return (
    <article
      className={`padrinhos-v4-card flex h-full flex-col overflow-hidden rounded-[1.5rem] ${
        person.isFamily
          ? "ring-2 ring-[#d6ae64] ring-offset-2 ring-offset-[#f5efe6]"
          : "border border-black/10"
      }`}
      aria-labelledby={`person-name-${person.id}`}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-[#f7f3ec]">
        <img
          src={`${PHOTO_BASE}/${photo}`}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 hover:scale-[1.03]"
        />
      </div>

      <div className="flex flex-1 flex-col p-6 md:p-7">
        <h3
          id={`person-name-${person.id}`}
          className="padrinhos-v4-display text-2xl leading-tight tracking-tight md:text-[1.75rem]"
        >
          {person.name}
        </h3>
      </div>
    </article>
  );
}

export function Padrinhos() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: "start", skipSnaps: false });
  const [prevEnabled, setPrevEnabled] = useState(false);
  const [nextEnabled, setNextEnabled] = useState(true);

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);

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

  return (
    <section
      id="padrinhos"
      aria-labelledby="padrinhos-heading"
      className="padrinhos-v4 overflow-hidden bg-[#f5efe6] py-24 text-foreground md:py-32"
    >
      <div className="mx-auto max-w-[1180px] px-6 md:px-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.56, ease: [0.22, 0.8, 0.32, 1] }}
        >
          <p
            id="padrinhos-heading"
            className="padrinhos-v4-eyebrow mb-4 text-sm uppercase text-foreground/55"
          >
            Padrinhos e Madrinhas
          </p>
        </motion.div>
      </div>

      <div className="mt-12 md:mt-16 pl-6 md:pl-12 lg:pl-[max(1.5rem,calc((100vw-1280px)/2))]">
        <div
          className="overflow-hidden cursor-grab active:cursor-grabbing pb-6 focus:outline-none"
          ref={emblaRef}
          tabIndex={0}
          role="region"
          aria-roledescription="carrossel"
          aria-label="Carrossel de padrinhos, madrinhas e família"
        >
          <div className="flex items-stretch gap-1 md:gap-2">
            {people.map((p, index) => (
              <motion.div
                key={p.id}
                className="flex min-w-0 flex-[0_0_85%] md:flex-[0_0_45%] lg:flex-[0_0_32%]"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: Math.min(index, 6) * 0.06 }}
              >
                <PersonCard person={p} index={index} />
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-6 hidden max-w-[1180px] justify-end gap-2 px-6 md:px-10 lg:flex">
        <button
          type="button"
          className="padrinhos-v4-arrow inline-flex h-11 w-11 items-center justify-center rounded-full"
          onClick={scrollPrev}
          disabled={!prevEnabled}
          aria-label="Pessoa anterior"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="padrinhos-v4-arrow inline-flex h-11 w-11 items-center justify-center rounded-full"
          onClick={scrollNext}
          disabled={!nextEnabled}
          aria-label="Próxima pessoa"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
