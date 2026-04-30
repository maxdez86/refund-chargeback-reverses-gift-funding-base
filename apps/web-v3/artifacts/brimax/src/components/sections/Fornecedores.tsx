import React from "react";
import { motion } from "framer-motion";

type Vendor = { name: string; role: string; url: string };

const fornecedores: Vendor[] = [
  { name: "Anastacia Rocha Doces Finos", role: "Doces finos", url: "https://www.instagram.com/anastaciarochadoces/" },
  { name: "BELA FLOR BUQUÊS", role: "Buquês", url: "https://www.instagram.com/belaflorbuques" },
  { name: "Fernando Ribeiro Celebrante", role: "Celebrante", url: "https://www.instagram.com/fernandoribeirocelebrante/" },
  { name: "Izabela Spacca Makeup", role: "Makeup", url: "https://www.instagram.com/izaspaccamakeup/" },
  { name: "Tulipas Buffet", role: "Buffet", url: "https://www.instagram.com/tulipasbuffet/" },
  { name: "Cinthia Rosenberg Assessoria", role: "Assessoria", url: "https://www.instagram.com/cinthia.rosenberg/" },
  { name: "Bruno Franco Fotografia", role: "Fotografia", url: "https://www.instagram.com/brunofrancofotografia/" },
  { name: "STORYMAKER MAVI", role: "Storymaker", url: "https://www.instagram.com/storymakermavi/" },
];

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
        </motion.div>

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-4">
          {fornecedores.map((fornecedor, index) => (
            <motion.div
              key={fornecedor.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-8%" }}
              transition={{ duration: 0.48, delay: (index % 4) * 0.05 }}
              className="text-center"
            >
              <a
                href={fornecedor.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block"
                aria-label={`${fornecedor.name} — ${fornecedor.role} — abrir Instagram em nova aba`}
              >
                <div className="font-serif text-lg leading-snug text-[#30251f] transition-colors group-hover:text-[#9f7a34]">
                  {fornecedor.name}
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.2em] text-[#6e5b4f]">
                  {fornecedor.role}
                </div>
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
