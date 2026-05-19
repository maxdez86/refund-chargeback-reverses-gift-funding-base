import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
import { ResponsivePhoto } from "@/components/ResponsivePhoto";
import { Button } from "@/components/ui/button";
import { mediaUrl } from "@/lib/media";

type Media =
  | { kind: "image"; file: string; alt: string }
  | { kind: "video"; file: string; posterAlt: string };

type Chapter = {
  id: string;
  title: string;
  text: string;
  media: Media;
};

const chapters: Chapter[] = [
  {
    id: "luz",
    title: "Sob a luz dos seus olhos",
    text: "Eu conheci o Max no teatro. Era uma quarta-feira, e ele tinha acabado de entrar para a minha turma. Eu lembro perfeitamente daquele momento: saí do camarim, entrei no palco e lá estava ele. Um rosto novo entre tantas pessoas que eu já conhecia. Nas semanas seguintes, nós continuamos dividindo o mesmo espaço, os mesmos ensaios e os mesmos aquecimentos, mas ainda como dois desconhecidos. Até que um dia nossos olhares se encontraram de verdade. Foi rápido e tímido, e por sorte temos o registro! E eu lembro que, depois de passar por ele, acabei olhando para trás involuntariamente. Quando olhei, ele também estava olhando.",
    media: { kind: "video", file: "sob-a-luz-dos-seus-olhos.mp4", posterAlt: "Primeira vez no palco" },
  },
  {
    id: "beijo",
    title: "O último primeiro beijo",
    text: "O universo, com seu senso de humor, decidiu nos escalar para interpretar Dália e Arandir. Cunhada e cunhado. E, para piorar, minha personagem era apaixonada por ele em segredo. O roteiro exigia convivência, intimidade em cena, falas difíceis… e um beijo. Nenhum de nós estava preparado para aquilo. Muito menos quando, sem aviso nenhum, nossa diretora soltou: “Sobe no palco, Max. Vamos fazer A cena.” O beijo quase não saiu. Tentamos uma, duas vezes. Colocaram até música para aliviar a tensão. E então aconteceu. Quando as luzes do palco se apagaram, alguma coisa entre nós continuou acesa. Depois disso, nós começamos, aos poucos, a nos aproximar de verdade, até que surgiu uma frase que acabou dizendo tudo o que a gente ainda não sabia explicar: “Isso não é uma declaração, mas você me afeta.”",
    media: { kind: "video", file: "o-ultimo-primeiro-beijo.mp4", posterAlt: "Brida e Max em cena" },
  },
  {
    id: "ps",
    title: "PS. Eu Te Amo",
    text: "Seis meses depois do nosso primeiro encontro, fomos viajar juntos para São Vicente. Nessa altura, ainda nos chamávamos de “fofo” e “fofa”. Ninguém tinha dado o primeiro passo ainda, mas o sentimento já transbordava. Em um momento inesperado, olhando para ele, eu disse: “Eu te amo.” E ele sorriu daquele jeito que parecia esperar aquilo desde o primeiro dia. Então colocou “Você”, do Tim Maia, para tocar, me olhou nos olhos e repetiu: “Eu te amo, meu amor.” Depois do primeiro, vieram vários. Eu adorava ouvir como ele tinha se apaixonado por mim e sempre puxava esse assunto outra vez. Em uma dessas conversas, ele comentou que tinha fuçado meu Instagram. Brinquei perguntando se aquilo tinha acontecido antes ou depois de se interessar por mim. E ele respondeu: “Não teve antes. Só teve depois.”",
    media: { kind: "image", file: "ps-eu-te-amo.JPG", alt: "Primeiro eu te amo" },
  },
  {
    id: "namoro",
    title: "Amor na prática",
    text: "O amor foi acontecendo assim: cheio de pequenos momentos que viraram tudo. Em Belo Horizonte, durante uma viagem para assistir a um clássico de futebol, ele resolveu transformar sentimento em compromisso. Em um restaurante super chique, comigo de moletom, sem maquiagem, completamente desprevenida, ouvi ele dizer: “Tenho uma coisa pra você… fecha os olhos.” E foi assim que ele me pediu em namoro. Entre o prato principal e a sobremesa mais deliciosa que já comi na vida. Só nós dois, sendo exatamente quem sempre fomos um com o outro.",
    media: { kind: "image", file: "pedido-namoro.webp", alt: "Pedido de namoro" },
  },
  {
    id: "munhoz",
    title: "Memórias de um inverno",
    text: "Desde então, a gente passou a colecionar memórias favoritas. E uma das mais especiais mora em Munhoz. A cidade nos acolheu em um inverno delicioso. A gente conversou profundamente sobre a vida… daqueles assuntos que fazem duas pessoas perceberem que estão, aos poucos, se encontrando em um outro alguém. Vivemos todas as aventuras possíveis: tirolesa, rapel, passeio a cavalo, caiaque, frio no rosto e mãos dadas o tempo inteiro. Acho que foi em Munhoz que eu percebi, de um jeito ainda mais forte, como era fácil ser feliz ao lado dele.",
    media: { kind: "image", file: "memorias-de-um-inverno.jpg", alt: "Parque dos sonhos" },
  },
  {
    id: "estadio",
    title: "Viva paixões comigo",
    text: "Ele, um torcedor de alma. Eu, sua companheira fiel em cada jogo no estádio, onde eu oficialmente virei o amuleto da sorte dele. As paixões que começaram a fazer sentido porque passaram a ser vividas juntos. Até as brincadeiras mais simples ficaram especiais, como quando ele perguntou se seria muito romântico comemorar 11 meses no jogo do Palmeiras.",
    media: { kind: "image", file: "viva-paixoes-comigo.jpg", alt: "Estádio" },
  },
  {
    id: "buque",
    title: "O buquê da noiva",
    text: "E então vieram os sinais do universo. Em outubro, fomos ao casamento de Tami e Marquinhos. Em um determinado momento, chegou a tradicional hora do buquê. E, honestamente, eu nem ia participar. No meio da brincadeira, o buquê veio parar nas minhas mãos, dado pela própria noiva. Na hora, eu chorei, fiquei sem acreditar. Eu nunca tinha pegado um buquê antes! Pela reação de Max ele também não esperava por aquilo, ainda bem que temos esse registro também!",
    media: { kind: "video", file: "o-buque-da-noiva.mp4", posterAlt: "Brida pegando o buquê" },
  },
  {
    id: "casa",
    title: "Casa comigo",
    text: "O pedido aconteceu nas alturas. Literalmente. O destino oficial da viagem era Brotas, mas ele dirigiu uma hora a mais até São Pedro. Durante seis meses, ele planejou tudo escondido: um balão exclusivo, um cenário lindo e a pergunta que mudaria nossas vidas. No dia, a chuva quase estragou todos os planos. Cancelamos o balão e ele entrou em pânico. Mas, no dia seguinte, o céu abriu. O balão subiu. E lá em cima, a mil metros de altura, ele me perguntou se eu queria passar o resto da vida ao lado dele.",
    media: { kind: "video", file: "casa-comigo.mp4", posterAlt: "Noivado no balão" },
  },
  {
    id: "save",
    title: "Antes do sim",
    text: "Agora, com a data marcada e o coração cheio de expectativa, a gente se prepara para viver o capítulo mais bonito da nossa história. E dessa vez, cercados pelas pessoas que amamos.",
    media: { kind: "video", file: "antes-do-sim.mp4", posterAlt: "Save the date" },
  },
];

function TextCard({ chapter, index }: { chapter: Chapter; index: number }) {
  return (
    <motion.article
      data-historia-card
      className="flex-[0_0_85%] md:flex-[0_0_45%] lg:flex-[0_0_32%] min-w-0"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: Math.min(index, 3) * 0.08 }}
      aria-roledescription="capítulo"
      aria-label={chapter.title}
    >
      <div className="min-h-[28rem] md:min-h-[32rem] lg:min-h-[36rem] rounded-2xl bg-[#efe6d7] p-6 md:p-8 flex flex-col">
        <h3 className="font-serif text-2xl md:text-3xl mb-4 text-foreground">{chapter.title}</h3>
        <p className="text-muted-foreground leading-relaxed text-sm md:text-base">{chapter.text}</p>
      </div>
    </motion.article>
  );
}

function MediaCard({
  chapter,
  index,
  playing,
  onPlay,
}: {
  chapter: Chapter;
  index: number;
  playing: boolean;
  onPlay: () => void;
}) {
  const { media } = chapter;
  return (
    <motion.article
      data-historia-card
      className="flex-[0_0_85%] md:flex-[0_0_45%] lg:flex-[0_0_32%] min-w-0"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: Math.min(index, 3) * 0.08 }}
    >
      <div className="h-[28rem] md:h-[32rem] lg:h-[36rem] rounded-2xl overflow-hidden bg-muted relative">
        {media.kind === "image" ? (
          <ResponsivePhoto
            section="story"
            fallbackSrc={mediaUrl("story", media.file)}
            alt={media.alt}
            className="w-full h-full object-cover transition-transform duration-700 hover:scale-[1.03]"
            loading="lazy"
          />
        ) : playing ? (
          <video
            src={mediaUrl("story", media.file)}
            title={chapter.title}
            className="absolute inset-0 h-full w-full object-cover bg-black"
            controls
            autoPlay
            playsInline
            preload="metadata"
          />
        ) : (
          <button
            type="button"
            onClick={onPlay}
            aria-label={`Reproduzir ${chapter.title}: ${media.posterAlt}`}
            className="group absolute inset-0 h-full w-full cursor-pointer overflow-hidden border-0 bg-black p-0"
          >
            <video
              src={mediaUrl("story", media.file)}
              preload="metadata"
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover pointer-events-none transition-transform duration-700 group-hover:scale-[1.03]"
            />
            <span aria-hidden="true" className="absolute inset-0 bg-black/15 transition-colors group-hover:bg-black/25" />
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#d6ae64] shadow-xl transition-transform duration-300 group-hover:scale-105 md:h-24 md:w-24"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-9 w-9 translate-x-[2px] text-white md:h-10 md:w-10">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}
      </div>
    </motion.article>
  );
}

export function Story() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ align: "start", skipSnaps: false });
  const [prevEnabled, setPrevEnabled] = useState(false);
  const [nextEnabled, setNextEnabled] = useState(true);
  const [playingVideos, setPlayingVideos] = useState<Set<number>>(new Set());

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);

  const scrollToPrev = useCallback(() => {
    const el = document.querySelector("#contagem");
    if (!el) return;
    const offset = 80;
    const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  const scrollToNext = useCallback(() => {
    const el = document.querySelector("#pre-wedding");
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
      const cardEl = root.querySelector<HTMLElement>("[data-historia-card]");
      if (!cardEl) return;
      const band = cardEl.getBoundingClientRect();
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
    <section id="historia" className="py-4 md:py-6 bg-[#f4eee5] overflow-hidden">
      <div className="container mx-auto px-6 mb-2 md:mb-3 flex flex-col md:flex-row md:items-end justify-between gap-8 relative">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-xl"
        >
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl text-foreground mb-3">
            A história do ponto de vista dela
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
            aria-label="Capítulo anterior"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-12 w-12 border-border/50 text-foreground"
            onClick={scrollNext}
            disabled={!nextEnabled}
            aria-label="Próximo capítulo"
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
          aria-label="Carrossel da nossa história"
        >
          <div className="flex gap-6 md:gap-8 pb-12 items-stretch">
            {chapters.flatMap((c, i) => [
              <TextCard key={`${c.id}-text`} chapter={c} index={i} />,
              <MediaCard
                key={`${c.id}-media`}
                chapter={c}
                index={i}
                playing={playingVideos.has(i)}
                onPlay={() => setPlayingVideos((prev) => new Set(prev).add(i))}
              />,
            ])}
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
