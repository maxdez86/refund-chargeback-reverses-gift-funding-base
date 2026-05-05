import React, { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const faqs = [
  {
    question: "Qual o dress code?",
    answer:
      "Esporte fino / Passeio completo. Queremos que você se sinta elegante e confortável para aproveitar a festa. Evite as cores branco, off-white e tons de rosa muito claros (reservados para as madrinhas)."
  },
  {
    question: "Crianças são bem-vindas?",
    answer:
      "Amamos os pequenos, mas devido ao formato da nossa celebração, o evento será restrito a adultos, com exceção de familiares muito próximos já convidados. Esperamos que compreendam e aproveitem a noite livre!"
  },
  {
    question: "Há estacionamento no local?",
    answer:
      "Sim, o Buffet Tulipas conta com serviço de valet com manobrista no local para maior conforto dos convidados."
  },
  {
    question: "Como funcionam os presentes?",
    answer:
      "Para nós, sua presença é o maior presente! Porém, se desejar contribuir para nossa vida juntos e lua de mel, disponibilizamos nossa chave PIX na seção 'Lista de Presentes'."
  },
  {
    question: "Qual o horário de chegada ideal?",
    answer:
      "A cerimônia começará pontualmente às 15:00. Recomendamos chegar com 15 a 30 minutos de antecedência para se acomodar com tranquilidade."
  },
  {
    question: "Hospedagem sugerida?",
    answer:
      "Para quem vem de fora, existem ótimas opções no bairro do Tatuapé e região, que ficam a uma curta distância do buffet."
  },
  {
    question: "Como voltar após a festa?",
    answer:
      "Recomendamos fortemente o uso de aplicativos de transporte como Uber ou táxi, especialmente se for consumir bebidas alcoólicas. A região é de fácil acesso."
  },
  {
    question: "Fotos nas redes sociais?",
    answer:
      "Por favor! Adoramos fotos. Use nossa hashtag #brimax nas redes sociais para podermos ver todos os momentos especiais pelos olhos de vocês."
  }
];

function FaqItem({
  answer,
  isOpen,
  onClick,
  question,
}: {
  answer: string;
  isOpen: boolean;
  onClick: () => void;
  question: string;
}) {
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={onClick}
        className="font-serif flex w-full items-center justify-between py-4 text-left text-lg text-foreground md:text-xl"
      >
        <span>{question}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>
      <div
        className={cn(
          "overflow-hidden text-base leading-relaxed text-muted-foreground transition-[grid-template-rows] duration-200",
          isOpen ? "grid grid-rows-[1fr]" : "grid grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="pb-4">{answer}</div>
        </div>
      </div>
    </div>
  );
}

export function FAQ() {
  const [openItem, setOpenItem] = useState<string | null>("item-0");

  return (
    <section id="faq" className="faq-v2 bg-[#f4eee5] py-24 md:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.56, ease: [0.22, 0.8, 0.32, 1] }}
        >
          <p className="faq-v2-eyebrow text-xs uppercase text-[#9f7a34]">
            Perguntas frequentes
          </p>
          <h2 className="faq-v2-balance font-serif mt-4 text-4xl text-[#30251f] md:text-5xl">
            Tire suas dúvidas.
          </h2>
          <div className="faq-v2-divider mx-auto mt-8 w-24" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.56, delay: 0.12, ease: [0.22, 0.8, 0.32, 1] }}
          className="mt-12"
        >
          {faqs.map((faq, index) => {
            const key = `item-${index}`;
            const isOpen = openItem === key;

            return (
              <FaqItem
                key={key}
                question={faq.question}
                answer={faq.answer}
                isOpen={isOpen}
                onClick={() => setOpenItem(isOpen ? null : key)}
              />
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
