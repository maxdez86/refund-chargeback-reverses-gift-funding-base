import React from "react";
import { motion } from "framer-motion";
import { FaInstagram } from "react-icons/fa";

type Vendor = { name: string; role: string; url: string };

const fornecedores: Vendor[] = [
  { name: "Anastacia Rocha Doces Finos", role: "Doces finos", url: "https://www.instagram.com/anastaciarochadoces/" },
  { name: "BELA FLOR BUQUÊS", role: "Buquês", url: "https://www.instagram.com/belaflorbuques" },
  { name: "Bruno Franco Fotografia", role: "Fotografia", url: "https://www.instagram.com/brunofrancofotografia/" },
  { name: "Cinthia Rosenberg Assessoria", role: "Assessoria", url: "https://www.instagram.com/cinthia.rosenberg/" },
  { name: "Fernando Ribeiro Celebrante", role: "Celebrante", url: "https://www.instagram.com/fernandoribeirocelebrante/" },
  { name: "Izabela Spacca Makeup", role: "Makeup", url: "https://www.instagram.com/izaspaccabeauty/" },
  { name: "STORYMAKER MAVI", role: "Storymaker", url: "https://www.instagram.com/storymakermavi/" },
  { name: "Tulipas Buffet", role: "Buffet", url: "https://www.instagram.com/tulipasbuffet/" },
];

const getInstagramHandle = (url: string): string => {
  const match = url.match(/instagram\.com\/([^/?#]+)/);
  return match ? `@${match[1]}` : "";
};

export function Fornecedores() {
  return (
    <section
      id="fornecedores"
      className="fornecedores-v2 relative isolate overflow-hidden bg-[linear-gradient(180deg,#f2e5cf_0%,#f6eddf_38%,#fbf7f0_100%)] py-20 md:py-24"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(circle_at_top,rgba(214,174,100,0.24),transparent_68%)]"
      />
      <div
        aria-hidden="true"
        className="absolute -left-16 top-14 h-52 w-52 rounded-full bg-[#d6ae64]/12 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -right-12 bottom-8 h-60 w-60 rounded-full bg-[#c98f6a]/10 blur-3xl"
      />

      <div className="relative z-10 mx-auto max-w-6xl px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.56, ease: [0.22, 0.8, 0.32, 1] }}
          className="mx-auto max-w-3xl"
        >
          <p className="fornecedores-v2-eyebrow text-xs uppercase tracking-[0.22em] text-[#9f7a34]">
            Por trás do nosso dia
          </p>
          <h2 className="fornecedores-v2-balance mt-4 font-serif text-3xl text-[#2f251e] md:text-4xl">
            Profissionais que tornaram tudo possível.
          </h2>
        </motion.div>

        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-2 gap-4 md:grid-cols-4 md:gap-5">
          {fornecedores.map((fornecedor, index) => {
            const handle = getInstagramHandle(fornecedor.url);
            return (
              <motion.div
                key={fornecedor.name}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-8%" }}
                transition={{ duration: 0.48, delay: (index % 4) * 0.05 }}
              >
                <a
                  href={fornecedor.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${fornecedor.name} — ${fornecedor.role} — abrir Instagram em nova aba`}
                  className="group flex h-full flex-col items-center rounded-[1.75rem] border border-white/55 bg-white/68 p-5 text-center shadow-[0_20px_60px_-42px_rgba(115,73,27,0.35)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-[#c5974a]/40 hover:bg-white/82 hover:shadow-[0_24px_80px_-44px_rgba(115,73,27,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9f7a34]/35"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f6ead8] text-[#9f7a34] transition-transform duration-300 group-hover:scale-105 group-hover:bg-[#f1dfc3]">
                    <FaInstagram aria-hidden="true" className="text-xl" />
                  </div>
                  <div className="mt-4 font-serif text-lg leading-snug text-[#30251f] transition-colors group-hover:text-[#9f7a34]">
                    {fornecedor.name}
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[#7b695a]">
                    {fornecedor.role}
                  </div>
                  {handle && (
                    <div className="mt-2 max-w-full truncate text-xs text-[#9f7a34]/90">
                      {handle}
                    </div>
                  )}
                </a>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
