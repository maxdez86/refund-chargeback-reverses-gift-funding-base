import React, { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const faqs = [
  {
    question: "Qual o dress code?",
    answer: (
      <>
        Esporte fino / Passeio completo. Queremos que você se sinta elegante e confortável para aproveitar a festa. Evite as cores branco, off-white e tons de rosa muito claros (reservados para as madrinhas).{" "}
        <a
          href="https://photos.app.goo.gl/GwwmS9diZCcBzQ1u8"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#9f7a34] underline underline-offset-2 transition-colors hover:text-[#d6ae64]"
        >
          Veja aqui
        </a>
        {" "}a paleta que escolhemos para os padrinhos para ter uma ideia das cores que combinam com a celebração.
      </>
    )
  },
  {
    question: "Crianças são bem-vindas?",
    answer:
      "Sim, os pequenos são muito bem-vindos! Durante a festa teremos um espaço kids com muitos brinquedos divertidos e três profissionais especializados cuidando das crianças, para que você possa aproveitar a celebração com tranquilidade."
  },
  {
    question: "Há estacionamento no local?",
    answer:
      "Sim, o Buffet Tulipas conta com serviço de valet com manobrista no local para maior conforto dos convidados."
  },
  {
    question: "Os presentes da lista são reais ou apenas ilustrativos?",
    answer:
      "Reais! Cada item foi escolhido por nós com carinho para a nossa nova casa. Para facilitar, você escolhe o presente e nós mesmos compramos todos de uma vez no final, assim eles chegam direto na nossa futura casa, sem que você precise se preocupar com a loja."
  },
  {
    question: "Qual o horário de chegada ideal?",
    answer:
      "A cerimônia começará às 15:00. Recomendamos chegar com 15 minutos de antecedência para se acomodar com tranquilidade."
  },
  {
    question: "Hospedagem sugerida?",
    answer:
      "Para quem vem de fora, existem ótimas opções no bairro do Tatuapé e região, que ficam a uma curta distância do buffet."
  },
  {
    question: "Fotos nas redes sociais?",
    answer:
      "Por favor! Adoramos fotos. Marque nosso @brimax.life no instagram para podermos ver todos os momentos especiais pelos olhos de vocês."
  },
  {
    question: "Posso pedir para os fotógrafos tirarem uma foto minha?",
    answer:
      "Por favor, recomendamos muito! Todos vocês estarão lindos e queremos registrar o máximo de fotos com nossos convidados. Contratamos um time de fotografia maravilhoso e eles estarão atentos para fotografar todos. Depois da festa, vamos disponibilizar um link com todas as fotos profissionais para que vocês possam baixar à vontade — então aproveitem para tirar aquela foto especial!"
  },
  {
    question: "Posso levar um convidado que não está na lista?",
    answer: (
      <>
        Pedimos desculpas se nos esquecemos de incluir alguém especial no seu convite! Por gentileza, envie um e-mail para{" "}
        <a
          href="mailto:casamento@brimax.life"
          className="text-[#9f7a34] underline underline-offset-2 transition-colors hover:text-[#d6ae64]"
        >
          casamento@brimax.life
        </a>
        {" "}com o nome do convidado para que possamos atualizar o sistema. Muito obrigado pela compreensão!
      </>
    )
  }
];

function FaqItem({
  answer,
  isOpen,
  onClick,
  question,
}: {
  answer: React.ReactNode;
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
