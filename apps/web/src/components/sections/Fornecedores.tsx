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
  { name: "Izabela Spacca Makeup", role: "Makeup", url: "https://www.instagram.com/izaspaccamakeup/" },
  { name: "STORYMAKER MAVI", role: "Storymaker", url: "https://www.instagram.com/storymakermavi/" },
  { name: "Tulipas Buffet", role: "Buffet", url: "https://www.instagram.com/tulipasbuffet/" },
];

const getInstagramHandle = (url: string): string => {
  const match = url.match(/instagram\.com\/([^/?#]+)/);
  return match ? `@${match[1]}` : "";
};

export function Fornecedores() {
  return (
    <section id="fornecedores" className="fornecedores-v2 bg-[#f4eee5] py-20 md:py-24">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.56, ease: [0.22, 0.8, 0.32, 1] }}
          className="mx-auto max-w-2xl"
        >
          <p className="fornecedores-v2-eyebrow text-xs uppercase text-[#9f7a34]">
            Por trás do nosso dia
          </p>
          <h2 className="fornecedores-v2-balance font-serif mt-4 text-3xl text-[#30251f] md:text-4xl">
            Profissionais que tornaram tudo possível.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-[#6e5b4f]">
            Siga e mande um carinho para quem está fazendo esse dia acontecer.
          </p>
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
                  className="group flex h-full flex-col items-center rounded-2xl border border-[#9f7a34]/15 bg-white/40 p-5 text-center shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[#9f7a34]/40 hover:bg-white/80 hover:shadow-md"
                >
                  <FaInstagram
                    aria-hidden="true"
                    className="text-2xl text-[#9f7a34] transition-transform duration-300 group-hover:scale-110"
                  />
                  <div className="mt-3 font-serif text-lg leading-snug text-[#30251f] transition-colors group-hover:text-[#9f7a34]">
                    {fornecedor.name}
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[#6e5b4f]">
                    {fornecedor.role}
                  </div>
                  {handle && (
                    <div className="mt-2 max-w-full truncate text-xs text-[#9f7a34]/85">
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
