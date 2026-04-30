import React, { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Group = {
  label: string;
  title: string;
  subtitle?: string;
  names: string[];
};

const groups: Group[] = [
  {
    label: "Ao lado do Max",
    title: "Padrinhos do Max",
    names: [
      "Amanda e Cris",
      "Fabi e Fernando",
      "Tami e Marcos",
      "Elis e Son",
      "Kelly e Sá",
      "Lila e Welton",
      "Nilza e Cerqueira (Pais do noivo)",
    ],
  },
  {
    label: "Ao lado da Brida",
    title: "Padrinhos da Brida",
    names: [
      "Débora e Nael",
      "Nessa e Carlos",
      "Nuza e Sid",
      "Carol e Igor",
      "Alice",
      "Raquel",
      "Julia",
      "Drielly",
      "Ronaldo (Pai da noiva)",
      "Cristiane e Juliano (Mãe da noiva)",
    ],
  },
  {
    label: "Família no altar",
    title: "Quem nos trouxe até aqui",
    subtitle:
      "Pais e padrinhos que caminham conosco lado a lado, do primeiro passo ao altar.",
    names: [
      "Nilza e Cerqueira (Pais do noivo)",
      "Ronaldo (Pai da noiva)",
      "Cristiane e Juliano (Mãe da noiva)",
    ],
  },
];

function GroupCard({ group, index, total }: { group: Group; index: number; total: number }) {
  return (
    <article
      className="padrinhos-v4-card flex h-full flex-col rounded-[1.5rem] border border-black/10 p-7 md:p-10"
      aria-labelledby={`group-title-${index}`}
    >
      <p className="padrinhos-v4-eyebrow text-xs uppercase text-foreground/55">
        {group.label} · {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </p>

      <h3
        id={`group-title-${index}`}
        className="padrinhos-v4-display mt-4 text-3xl leading-tight tracking-tight md:text-[2.25rem]"
      >
        {group.title}
      </h3>

      {group.subtitle && (
        <p className="mt-4 max-w-[38ch] text-base leading-relaxed text-foreground/70">
          {group.subtitle}
        </p>
      )}

      <ul className="mt-7 grid flex-1 content-start gap-x-8 gap-y-3 sm:grid-cols-2">
        {group.names.map((name) => (
          <li
            key={name}
            className="padrinhos-v4-name-item padrinhos-v4-display flex items-baseline gap-3 text-lg text-foreground md:text-xl"
          >
            <span aria-hidden="true" className="padrinhos-v4-name-accent h-px w-4 shrink-0 translate-y-[-4px]" />
            <span>{name}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

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
          <p className="padrinhos-v4-eyebrow mb-4 text-sm uppercase text-foreground/55">
            Padrinhos e Madrinhas
          </p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.56, delay: 0.05, ease: [0.22, 0.8, 0.32, 1] }}
        >
          <h2
            id="padrinhos-heading"
            className="padrinhos-v4-display max-w-[14ch] text-[clamp(2.75rem,4.8vw,4.9rem)] leading-[0.98] tracking-tight"
          >
            Quem caminha com a gente.
          </h2>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.56, delay: 0.12, ease: [0.22, 0.8, 0.32, 1] }}
          className="mt-6 md:mt-8"
        >
          <p className="max-w-[38rem] text-lg leading-relaxed text-foreground/70">
            Pessoas queridas que caminham conosco e terão um lugar especial nesse dia.
          </p>
        </motion.div>
      </div>

      <div className="mt-12 md:mt-16">
        <div
          className="overflow-hidden px-6 pb-6 md:px-10 focus:outline-none"
          ref={emblaRef}
          tabIndex={0}
          role="region"
          aria-roledescription="carrossel"
          aria-label="Carrossel de padrinhos e madrinhas"
        >
          <div className="flex items-stretch gap-5 md:gap-7">
            {groups.map((g, index) => (
              <motion.div
                key={g.title}
                className="flex min-w-0 flex-[0_0_88%] md:flex-[0_0_70%] lg:flex-[0_0_34rem]"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.08 }}
              >
                <GroupCard group={g} index={index} total={groups.length} />
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="mx-auto mt-4 flex max-w-[1180px] flex-wrap items-center gap-3 px-6 md:px-10"
        role="tablist"
        aria-label="Navegar entre os grupos"
      >
        {groups.map((g, i) => (
          <button
            key={g.title}
            type="button"
            onClick={() => scrollTo(i)}
            aria-label={`Ir para ${g.title}`}
            aria-current={selectedIndex === i ? "true" : undefined}
            aria-selected={selectedIndex === i}
            role="tab"
            className={`padrinhos-v4-progress px-3 py-2 text-xs uppercase ${
              selectedIndex === i
                ? "border-b-[#a7432a] text-foreground"
                : "border-b-transparent text-foreground/55 hover:text-foreground"
            }`}
          >
            {g.title}
          </button>
        ))}
      </div>

      <div className="mx-auto mt-2 hidden max-w-[1180px] justify-end gap-2 px-6 md:px-10 lg:flex">
        <button
          type="button"
          className="padrinhos-v4-arrow inline-flex h-11 w-11 items-center justify-center rounded-full"
          onClick={scrollPrev}
          disabled={!prevEnabled}
          aria-label="Grupo anterior"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="padrinhos-v4-arrow inline-flex h-11 w-11 items-center justify-center rounded-full"
          onClick={scrollNext}
          disabled={!nextEnabled}
          aria-label="Próximo grupo"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
