import type { MouseEvent } from "react";
import { motion } from "framer-motion";
import { ResponsivePhoto } from "@/components/ResponsivePhoto";
import {
  buildDeviceImageFallbackSrc,
  buildDeviceImageSources,
} from "@/lib/media";
import { scrollToAnchor } from "@/lib/scroll-to-anchor";

const heroCopy = {
  weekday: "Domingo",
  dateShort: "06.12.2026",
  timeShort: "15:00",
  brideShort: "Brida",
  groomShort: "Max",
  tagline: "A medida do amor é amar sem medida.",
} as const;

function scrollToId(event: MouseEvent<HTMLAnchorElement>, id: string) {
  event.preventDefault();
  scrollToAnchor(id);
}

export function Hero() {
  return (
    <section
      id="inicio"
      className="hero-v2 relative flex min-h-[100svh] items-center justify-center overflow-hidden bg-[#111111]"
    >
      <div className="absolute inset-0">
        <ResponsivePhoto
          section="hero"
          sources={buildDeviceImageSources("hero")}
          fallbackSrc={buildDeviceImageFallbackSrc("hero")}
          alt="Casal de mãos dadas ao pôr do sol"
          className="h-full w-full object-cover object-[50%_50%] md:object-[50%_48%] xl:object-[50%_42%] 2xl:object-[50%_38%]"
          fetchPriority="high"
        />
        <div className="hero-v2-gradient absolute inset-0" />
        <div className="absolute inset-0 bg-black/20" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mx-auto max-w-4xl px-6 pt-24 text-center text-[#fbf7f0] md:pt-28"
      >
        <p className="font-sans text-xs uppercase tracking-[0.25em] text-[#d6ae64] sm:tracking-[0.4em]">
          {heroCopy.weekday} · {heroCopy.dateShort} · {heroCopy.timeShort}
        </p>
        <h1 className="hero-v2-balance font-serif mt-6 text-[clamp(3.5rem,11vw,8.5rem)] leading-[0.95] tracking-tight">
          {heroCopy.brideShort}
          <span className="mx-3 italic text-[#d6ae64]">&amp;</span>
          {heroCopy.groomShort}
        </h1>
        <div className="mx-auto my-8 h-px w-24 bg-[#d6ae64]/70" />
        <p className="font-serif mx-auto max-w-xl text-lg italic text-[#fbf7f0]/90 md:text-xl">
          {heroCopy.tagline}
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#confirmar-presenca"
            onClick={(event) => scrollToId(event, "#confirmar-presenca")}
            className="font-sans hero-v2-gold-button inline-flex h-12 min-w-[220px] items-center justify-center px-8 text-sm font-medium text-[#2a2217] transition-opacity hover:opacity-90"
          >
            Confirmar Presença
          </a>
          <a
            href="#presentes"
            onClick={(event) => scrollToId(event, "#presentes")}
            className="font-sans inline-flex h-12 min-w-[220px] items-center justify-center border border-[#fbf7f0]/60 bg-transparent px-8 text-sm font-medium text-[#fbf7f0] transition-colors hover:bg-[#fbf7f0]/10"
          >
            Lista de Presentes
          </a>
        </div>
      </motion.div>
    </section>
  );
}
