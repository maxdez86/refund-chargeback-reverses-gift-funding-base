import { useCallback, useEffect, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { ResponsivePhoto } from "@/components/ResponsivePhoto";
import { Button } from "@/components/ui/button";
import {
  buildSharedWidthImageFallbackSrc,
  buildSharedWidthImageSources,
  mediaFileUrl,
} from "@/lib/media";
import { scrollToAnchor } from "@/lib/scroll-to-anchor";

type Media =
  | { kind: "image"; slug: string; alt: string }
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
    text: "O universo decidiu nos escalar para interpretar Dália e Arandir. Cunhada e cunhado. E, para piorar, minha personagem era apaixonada por ele em segredo. O roteiro exigia convivência, intimidade em cena, falas difíceis… e um beijo. Nenhum de nós estava preparado para aquilo. Muito menos quando, sem aviso, nossa diretora soltou: “Sobe no palco, Max. Vamos fazer A cena.” O beijo quase não saiu. Tentamos uma, duas vezes. Colocaram música para aliviar a tensão. E então aconteceu. Quando as luzes do palco se apagaram, alguma coisa entre nós continuou acesa. Depois disso, começamos, aos poucos, a nos aproximar de verdade, até surgir uma frase que acabou dizendo tudo o que a gente ainda não sabia explicar: “você me afeta”.",
    media: { kind: "image", slug: "o-ultimo-primeiro-beijo", alt: "Brida e Max em cena" },
  },
  {
    id: "ps",
    title: "P.S. Eu Te Amo",
    text: "Seis meses depois do nosso primeiro encontro, fomos viajar juntos para São Vicente. Nessa altura, ainda nos chamávamos de “fofo” e “fofa”. Ninguém tinha dado o primeiro passo, mas o sentimento já transbordava. Em um momento inesperado, olhando para ele, eu disse: “Eu te amo.” E ele sorriu daquele jeito que parecia esperar aquilo desde o primeiro dia. Então colocou “Você”, do Tim Maia, para tocar, me olhou nos olhos e repetiu: “Eu te amo, meu amor.” Depois do primeiro, vieram vários. Eu adorava ouvir como ele tinha se apaixonado por mim e sempre puxava esse assunto. Em uma dessas conversas, comentou que tinha fuçado meu Instagram. Perguntei se aquilo tinha acontecido antes ou depois de se interessar por mim. E ele respondeu: “Não teve antes. Só teve depois.”",
    media: { kind: "image", slug: "ps-eu-te-amo", alt: "Primeiro eu te amo" },
  },
  {
    id: "namoro",
    title: "Amor na prática",
    text: "O amor foi acontecendo assim: cheio de pequenos momentos que viraram tudo. Em Belo Horizonte, durante uma viagem para assistir a um clássico de futebol, ele resolveu transformar sentimento em compromisso. Em um restaurante super chique, comigo de moletom, sem maquiagem, completamente desprevenida, ouvi ele dizer: “Tenho uma coisa pra você… fecha os olhos.” E foi assim que ele me pediu em namoro. Entre o prato principal e a sobremesa mais deliciosa que já comi na vida. Só nós dois, sendo exatamente quem sempre fomos um com o outro. Curiosamente, o pedido aconteceu sete meses depois do nosso primeiro encontro. Mas, para nós, a data oficial do namoro sempre será 23 de julho, o dia em que saímos juntos pela primeira vez. Porque foi ali que a nossa história realmente começou.",
    media: { kind: "image", slug: "pedido-namoro", alt: "Pedido de namoro" },
  },
  {
    id: "munhoz",
    title: "Memórias de um inverno",
    text: "Desde então, a gente passou a colecionar memórias favoritas. E uma das mais especiais mora em Munhoz. A cidade nos acolheu em um inverno delicioso. A gente conversou profundamente sobre a vida… daqueles assuntos que fazem duas pessoas perceberem que estão, aos poucos, se encontrando em um outro alguém. Vivemos todas as aventuras possíveis: tirolesa, rapel, passeio a cavalo, caiaque, frio no rosto e mãos dadas o tempo inteiro. Acho que foi em Munhoz que eu percebi, de um jeito ainda mais forte, como era fácil ser feliz ao lado dele.",
    media: { kind: "image", slug: "memorias-de-um-inverno", alt: "Parque dos sonhos" },
  },
  {
    id: "estadio",
    title: "Viva paixões comigo",
    text: "Ele, um torcedor de alma. Eu, sua companheira fiel em cada jogo no estádio, onde eu oficialmente virei o amuleto da sorte dele. E os números pareciam concordar. Assistimos juntos a 33 partidas no estádio e vimos apenas duas derrotas. Foi assim que muitas das nossas paixões passaram a fazer ainda mais sentido: porque começaram a ser vividas juntos. Até as brincadeiras mais simples ficaram especiais, como quando ele me perguntou se seria muito romântico comemorar 11 meses no jogo do Palmeiras.",
    media: { kind: "image", slug: "viva-paixoes-comigo", alt: "Estádio" },
  },
  {
    id: "buque",
    title: "O buquê da noiva",
    text: "E então vieram os sinais do universo. Em outubro, fomos padrinhos do casamento de um dos nossos casais favoritos, Tami e Marquinhos. Estávamos cercados por pessoas queridas e celebrando uma história que admiramos muito. Durante o esperado momento do buquê, algo que nunca me aconteceu surpreendeu não só a mim, como Max também. E, honestamente, eu nem ia participar. Sorte que algo me fez levantar da cadeira. E foi aí que tudo mudou, o buquê veio parar nas minhas mãos, dado pela própria noiva. Na hora, eu chorei, sem acreditar. E apenas dois meses depois, viveríamos um dos capítulos mais importantes da nossa história.",
    media: { kind: "video", file: "o-buque-da-noiva.mp4", posterAlt: "Brida pegando o buquê" },
  },
  {
    id: "casa",
    title: "Casa comigo",
    text: "O pedido aconteceu nas alturas. Literalmente. O destino oficial da viagem era Brotas, mas ele dirigiu uma hora a mais até São Pedro. Durante seis meses, ele planejou tudo escondido: um balão exclusivo, um cenário lindo e a pergunta que mudaria nossas vidas. No dia, a chuva quase estragou todos os planos. Cancelamos o balão e ele entrou em pânico. Mas, no dia seguinte, o céu abriu. O balão subiu. E lá em cima, a mil metros de altura, ele me perguntou se eu queria passar o resto da vida ao lado dele.",
    media: { kind: "image", slug: "casa-comigo", alt: "Noivado no balão" },
  },
  {
    id: "save",
    title: "Antes do sim",
    text: "Agora, com a data marcada e o coração cheio de expectativa, a gente se prepara para viver o capítulo mais bonito da nossa história. E dessa vez, cercados pelas pessoas que amamos.",
    media: { kind: "video", file: "antes-do-sim.mp4", posterAlt: "Save the date" },
  },
];

const STORY_IMAGE_SIZES = "(max-width: 767px) 85vw, (max-width: 1279px) 45vw, 32vw";

function TextCard({ chapter, index }: { chapter: Chapter; index: number }) {
  return (
    <motion.article
      data-historia-card
      className="min-w-0 flex-[0_0_85%] md:flex-[0_0_48%] lg:flex-[0_0_38%] xl:flex-[0_0_32%]"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: Math.min(index, 3) * 0.08 }}
      aria-roledescription="capítulo"
      aria-label={chapter.title}
    >
      <div className="flex min-h-[24rem] flex-col rounded-2xl border border-white/55 bg-[#f3e5d1] p-5 shadow-[0_22px_70px_-46px_rgba(92,58,24,0.42)] md:min-h-[24.5rem] md:p-5 lg:min-h-[26rem] lg:p-5 xl:min-h-[30rem] xl:p-6">
        <h3 className="mb-2 font-serif text-[1.65rem] text-[#2c211a] md:text-[1.85rem] lg:text-[1.95rem] xl:mb-3 xl:text-[2rem]">
          {chapter.title}
        </h3>
        <p className="text-sm leading-[1.72] text-[#5f4d40] md:text-[0.9rem] lg:text-[0.92rem] xl:text-[0.95rem] xl:leading-relaxed">
          {chapter.text}
        </p>
      </div>
    </motion.article>
  );
}

function StoryVideo({ src, title }: { src: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Start muted; the guest can unmute via the native control bar. React's
    // declarative `muted` is unreliable on WebKit (see Local.tsx), so enforce
    // it imperatively before play to avoid an unmuted blip after the click.
    video.muted = true;
    video.defaultMuted = true;
    Promise.resolve(video.play()).catch(() => {});
  }, []);

  return (
    <video
      ref={videoRef}
      src={src}
      title={title}
      className="absolute inset-0 h-full w-full object-cover bg-black"
      controls
      muted
      playsInline
      preload="metadata"
    />
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
      className="min-w-0 flex-[0_0_85%] md:flex-[0_0_48%] lg:flex-[0_0_38%] xl:flex-[0_0_32%]"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: Math.min(index, 3) * 0.08 }}
    >
      <div className="relative h-[24rem] overflow-hidden rounded-2xl border border-white/50 bg-[#ead8c1] shadow-[0_22px_70px_-46px_rgba(92,58,24,0.34)] md:h-[24.5rem] lg:h-[26rem] xl:h-[30rem]">
        {media.kind === "image" ? (
          <ResponsivePhoto
            section="story"
            sources={buildSharedWidthImageSources("story", media.slug, STORY_IMAGE_SIZES)}
            fallbackSrc={buildSharedWidthImageFallbackSrc("story", media.slug)}
            alt={media.alt}
            className="w-full h-full object-cover transition-transform duration-700 hover:scale-[1.03]"
            loading="lazy"
          />
        ) : playing ? (
          <StoryVideo src={mediaFileUrl("story", media.file)} title={chapter.title} />
        ) : (
          <button
            type="button"
            onClick={onPlay}
            aria-label={`Reproduzir ${chapter.title}: ${media.posterAlt}`}
            className="group absolute inset-0 h-full w-full cursor-pointer overflow-hidden border-0 bg-black p-0"
          >
            <video
              src={mediaFileUrl("story", media.file)}
              preload="metadata"
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover pointer-events-none transition-transform duration-700 group-hover:scale-[1.03]"
            />
            <span aria-hidden="true" className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/30" />
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[linear-gradient(135deg,#e3bc74_0%,#b8844c_100%)] shadow-[0_18px_45px_-18px_rgba(92,58,24,0.65)] transition-transform duration-300 group-hover:scale-105 md:h-24 md:w-24"
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

  const scrollToNext = useCallback(() => {
    scrollToAnchor("#review");
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
    <section
      id="historia"
      className="relative isolate overflow-hidden bg-[linear-gradient(180deg,#eee1cf_0%,#e7d4bc_42%,#f4ebe0_100%)] py-3 md:py-4"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(242,217,183,0.42),transparent_72%)]"
      />
      <div
        aria-hidden="true"
        className="absolute -left-14 top-24 h-56 w-56 rounded-full bg-[#d6ae64]/14 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -right-12 bottom-14 h-64 w-64 rounded-full bg-[#c98d63]/12 blur-3xl"
      />

      <div className="container relative mx-auto mb-2 flex flex-col gap-6 px-6 md:mb-2 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-end lg:gap-4 xl:gap-6">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="w-full min-w-0 max-w-[17ch] md:max-w-none"
        >
          <h2 className="mb-2 font-serif text-4xl text-[#2c211a] md:whitespace-nowrap md:text-[3.4rem] lg:text-[4.3rem] xl:text-6xl">
            A história do ponto de vista dela
          </h2>
        </motion.div>

        <div className="hidden shrink-0 md:flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full border-[#d5b88d] bg-white/65 text-[#8f6630] shadow-sm transition-colors hover:bg-white/85 hover:text-[#734f1f]"
            onClick={scrollPrev}
            disabled={!prevEnabled}
            aria-label="Capítulo anterior"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full border-[#d5b88d] bg-white/65 text-[#8f6630] shadow-sm transition-colors hover:bg-white/85 hover:text-[#734f1f]"
            onClick={scrollNext}
            disabled={!nextEnabled}
            aria-label="Próximo capítulo"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="relative pl-6 md:pl-12 lg:pl-[max(1.5rem,calc((100vw-1280px)/2))]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-6 top-0 bottom-8 rounded-[2rem] border border-white/35 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] md:inset-x-10 lg:inset-x-[max(1.5rem,calc((100vw-1280px)/2))]"
        />
        <div
          className="relative overflow-hidden cursor-grab focus:outline-none active:cursor-grabbing"
          ref={emblaRef}
          tabIndex={0}
          role="region"
          aria-roledescription="carrossel"
          aria-label="Carrossel da nossa história"
        >
          <div className="flex items-stretch gap-5 pb-8 md:gap-5 md:pb-7 lg:gap-6 lg:pb-8 xl:pb-9">
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
          className="h-10 w-10 animate-bounce rounded-full border-[#d5b88d] bg-white/65 text-[#8f6630] hover:bg-white/85 hover:text-[#734f1f]"
          onClick={scrollToNext}
          aria-label="Rolar para a próxima seção"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
