export type StoryItem = {
  chapter: string;
  title: string;
  description: string;
  image: string;
  alt: string;
};

export type PhotoItem = {
  kicker: string;
  caption: string;
  image: string;
  alt: string;
};

export type PeopleGroup = {
  kicker: string;
  title: string;
  names: string[];
  family?: boolean;
};

export type Vendor = {
  role: string;
  name: string;
  instagram: string;
};

export type GiftItem = {
  id: string;
  name: string;
  description: string;
  image: string;
  totalValue: number;
  fractional: boolean;
  partValue: number | null;
  totalParts: number | null;
  partsFunded: number | null;
  fullyFunded: boolean;
};

export type InvitationGroup = {
  id: string;
  primaryName: string;
  guests: string[];
};

export type FaqItem = {
  question: string;
  answer: string;
};

export const WEDDING_DATE_ISO = "2026-12-06T15:00:00-03:00";

export const MAP_URL =
  "https://www.google.com/maps/dir/?api=1&destination=Rua%20Valentim%20Magalh%C3%A3es%2C%20293%20-%20S%C3%A3o%20Paulo%20-%20SP";

export const NAV_ITEMS = [
  { href: "#contagem", label: "Contagem" },
  { href: "#historia", label: "História" },
  { href: "#local", label: "Local" },
  { href: "#presentes", label: "Presentes" }
] as const;

export const STORY_ITEMS: StoryItem[] = [
  {
    chapter: "Capítulo 01",
    title: "A aula de teatro",
    description:
      "Foi numa aula de teatro que Brida e Max se encontraram. O começo veio com presença, escuta e uma cena que ainda estava por se revelar.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/6.jpg",
    alt: "Brida e Max em registro do casal para Nossa História"
  },
  {
    chapter: "Capítulo 02",
    title: "Par romântico em cena",
    description:
      "No palco, viveram um par romântico em uma peça. Entre texto, ensaio e troca de olhares, a história começou a ganhar outro sentido.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20240111_102922.jpg",
    alt: "Brida e Max em foto da biblioteca do casal"
  },
  {
    chapter: "Capítulo 03",
    title: "O primeiro beijo",
    description:
      "Durante um ensaio, aconteceu o primeiro beijo. Um momento simples, inesperado e impossível de esquecer.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20240908_210941.jpg",
    alt: "Brida e Max em registro afetivo do casal"
  },
  {
    chapter: "Capítulo 04",
    title: "Depois da cortina",
    description:
      "Quando a peça terminou, a vontade de estar perto continuou. Foi depois da cortina que os encontros começaram fora de cena.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20250412_134057.jpg",
    alt: "Brida e Max em registro do casal juntos"
  },
  {
    chapter: "Capítulo 05",
    title: "Belo Horizonte",
    description:
      "Em uma viagem a Belo Horizonte para um jogo de futebol, veio o pedido oficial de namoro. A resposta abriu um novo capítulo.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20230723_195019.jpg",
    alt: "Brida e Max em imagem da biblioteca do casal"
  },
  {
    chapter: "Capítulo 06",
    title: "Mais de 12 viagens",
    description:
      "Depois vieram mais de 12 viagens juntos, colecionando paisagens, conversas e memórias que viraram parte da casa dos dois.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20231029_142428.jpg",
    alt: "Brida e Max em foto de memória do casal"
  },
  {
    chapter: "Capítulo 07",
    title: "O pedido nas alturas",
    description:
      "Nas alturas, durante um voo de balão, veio o pedido de casamento. Um sim para continuar escolhendo a mesma história.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20250412_134211.jpg",
    alt: "Brida e Max em registro do casal para o encerramento da história"
  }
];

export const PRE_WEDDING_ITEMS: PhotoItem[] = [
  {
    kicker: "Foto pré-wedding 01",
    caption: "O caminho até o sim.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG-20231217-WA0019.jpg",
    alt: "Brida e Max em foto da biblioteca do casal para o Pré-Wedding"
  },
  {
    kicker: "Foto pré-wedding 02",
    caption: "Um registro para lembrar do tempo de agora.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20230828_110138.jpg",
    alt: "Brida e Max em registro do casal para o Pré-Wedding"
  },
  {
    kicker: "Foto pré-wedding 03",
    caption: "Entre carinho, riso e presença.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20240112_131120.jpg",
    alt: "Brida e Max em foto afetiva da biblioteca do casal"
  },
  {
    kicker: "Foto pré-wedding 04",
    caption: "A leveza de caminhar juntos.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20241123_171012.jpg",
    alt: "Brida e Max em imagem da biblioteca do casal"
  },
  {
    kicker: "Foto pré-wedding 05",
    caption: "Detalhes de uma história em movimento.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20250412_133742.jpg",
    alt: "Brida e Max em registro visual do casal"
  },
  {
    kicker: "Foto pré-wedding 06",
    caption: "Brida e Max, antes do grande dia.",
    image:
      "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/IMG_20240204_151947.jpg",
    alt: "Brida e Max em foto do casal antes do casamento"
  }
];

export const PEOPLE_GROUPS: PeopleGroup[] = [
  {
    kicker: "Grupo do Max",
    title: "Padrinhos do Max",
    names: ["Amanda e Cris", "Fabi e Fernando", "Tami e Marcos", "Elis e Son", "Kelly e Sá", "Lila e Welton"]
  },
  {
    kicker: "Família no altar",
    title: "Família do Max",
    names: ["Nilza e Cerqueira (Pais do noivo)"],
    family: true
  },
  {
    kicker: "Grupo da Brida",
    title: "Padrinhos da Brida",
    names: ["Débora e Nael", "Nessa e Carlos", "Nuza e Sid", "Carol e Igor", "Alice", "Raquel", "Julia", "Drielly"]
  },
  {
    kicker: "Família no altar",
    title: "Família da Brida",
    names: ["Ronaldo (Pai da noiva)", "Cristiane e Juliano (Mãe da noiva)"],
    family: true
  }
];

export const VENDORS: Vendor[] = [
  {
    role: "Doces finos",
    name: "Anastacia Rocha Doces Finos",
    instagram: "https://www.instagram.com/anastaciarochadoces/"
  },
  {
    role: "Buquês",
    name: "BELA FLOR BUQUÊS",
    instagram: "https://www.instagram.com/belaflorbuques"
  },
  {
    role: "Celebrante",
    name: "Fernando Ribeiro Celebrante",
    instagram: "https://www.instagram.com/fernandoribeirocelebrante/"
  },
  {
    role: "Makeup",
    name: "Izabela Spacca Makeup",
    instagram: "https://www.instagram.com/izaspaccamakeup/"
  },
  {
    role: "Buffet",
    name: "Tulipas Buffet",
    instagram: "https://www.instagram.com/tulipasbuffet/"
  },
  {
    role: "Assessoria",
    name: "Cinthia Rosenberg Assessoria",
    instagram: "https://www.instagram.com/cinthia.rosenberg/"
  },
  {
    role: "Fotografia",
    name: "Bruno Franco Fotografia",
    instagram: "https://www.instagram.com/brunofrancofotografia/"
  },
  {
    role: "Storymaker",
    name: "STORYMAKER MAVI",
    instagram: "https://www.instagram.com/storymakermavi/"
  }
];

export const GIFT_ITEMS: GiftItem[] = [
  {
    id: "presente-06",
    name: "Jogo de Toalhas",
    description: "Toalhas para o novo lar.",
    image: "toalhas",
    totalValue: 150,
    fractional: false,
    partValue: null,
    totalParts: null,
    partsFunded: null,
    fullyFunded: false
  },
  {
    id: "presente-07",
    name: "Porta-retratos",
    description: "Para guardar memórias da nossa nova fase.",
    image: "porta-retratos",
    totalValue: 80,
    fractional: false,
    partValue: null,
    totalParts: null,
    partsFunded: null,
    fullyFunded: false
  },
  {
    id: "presente-08",
    name: "Vela decorativa",
    description: "Um detalhe acolhedor para a casa.",
    image: "vela",
    totalValue: 60,
    fractional: false,
    partValue: null,
    totalParts: null,
    partsFunded: null,
    fullyFunded: true
  },
  {
    id: "presente-01",
    name: "Robô de Cozinha",
    description: "Para preparar receitas com mais praticidade.",
    image: "robo-cozinha",
    totalValue: 1200,
    fractional: true,
    partValue: 60,
    totalParts: 20,
    partsFunded: 0,
    fullyFunded: false
  },
  {
    id: "presente-05",
    name: "Jogo de Cama King",
    description: "Conforto para os primeiros dias de casa nova.",
    image: "cama-king",
    totalValue: 350,
    fractional: true,
    partValue: 50,
    totalParts: 7,
    partsFunded: 0,
    fullyFunded: false
  },
  {
    id: "presente-02",
    name: "Jogo de Panelas",
    description: "Para cozinhar os almoços de domingo.",
    image: "panelas",
    totalValue: 800,
    fractional: true,
    partValue: 50,
    totalParts: 16,
    partsFunded: 3,
    fullyFunded: false
  },
  {
    id: "presente-03",
    name: "Aparelho de Jantar",
    description: "Para receber pessoas queridas à mesa.",
    image: "jantar",
    totalValue: 600,
    fractional: true,
    partValue: 50,
    totalParts: 12,
    partsFunded: 6,
    fullyFunded: false
  },
  {
    id: "presente-04",
    name: "Aspirador Robô",
    description: "Para facilitar a rotina da casa.",
    image: "aspirador",
    totalValue: 500,
    fractional: true,
    partValue: 50,
    totalParts: 10,
    partsFunded: 10,
    fullyFunded: false
  }
];

export const INVITATION_GROUPS: InvitationGroup[] = [
  { id: "grupo-amanda-cris", primaryName: "Amanda", guests: ["Amanda", "Cris"] },
  { id: "grupo-fabi-fernando", primaryName: "Fabi", guests: ["Fabi", "Fernando"] },
  { id: "grupo-tami-marcos", primaryName: "Tami", guests: ["Tami", "Marcos"] },
  { id: "grupo-nessa-carlos", primaryName: "Nessa", guests: ["Nessa", "Carlos"] },
  { id: "grupo-carol-igor", primaryName: "Carol", guests: ["Carol", "Igor"] },
  { id: "grupo-debora-nael", primaryName: "Débora", guests: ["Débora", "Nael"] },
  { id: "grupo-nilza-cerqueira", primaryName: "Nilza", guests: ["Nilza", "Cerqueira"] },
  {
    id: "grupo-cristiane-juliano-ronaldo",
    primaryName: "Cristiane",
    guests: ["Cristiane", "Juliano", "Ronaldo"]
  },
  {
    id: "grupo-alice-raquel-julia-drielly",
    primaryName: "Alice",
    guests: ["Alice", "Raquel", "Julia", "Drielly"]
  }
];

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Qual é o horário da cerimônia?",
    answer:
      "A cerimônia será no dia 06/12/2026, às 15h. Se puder, programe sua chegada com um pouco de antecedência para aproveitar tudo com calma."
  },
  {
    question: "Onde será o casamento?",
    answer:
      "Vamos nos encontrar no Buffet Tulipas - Unidade Villa Valentim, na Rua Valentim Magalhães, 293, em São Paulo - SP. O link para o mapa está disponível na seção de local da página."
  },
  {
    question: "Como confirmo minha presença?",
    answer:
      "Na seção de confirmação, basta digitar um nome do seu convite. A página localiza o grupo correspondente e mostra apenas os nomes que já fazem parte desse convite para você marcar quem poderá comparecer."
  },
  {
    question: "Posso levar alguém que não está no convite?",
    answer:
      "Para mantermos a organização do evento, a confirmação mostra apenas os nomes que já fazem parte do seu convite. Caso tenha alguma dúvida, fale com a gente pelo e-mail casamento@brimax.life."
  },
  {
    question: "Como funciona a lista de presentes?",
    answer:
      "A lista reúne sugestões para a nossa nova fase. Alguns itens aparecem como presente integral e outros como cotas, sempre com um aviso honesto de que esta prévia ainda será conectada à integração final."
  },
  {
    question: "Existe sugestão de traje?",
    answer:
      "Queremos que você se sinta bem e à vontade para celebrar com a gente. Se estiver em dúvida sobre o traje, vale apostar em uma produção mais arrumada para a ocasião ou falar conosco pelo e-mail casamento@brimax.life."
  },
  {
    question: "Com quem falo se tiver alguma dúvida?",
    answer:
      "Você pode falar com a gente pelo e-mail casamento@brimax.life. Vamos adorar ajudar no que for preciso."
  },
  {
    question: "O local tem acesso fácil para convidados com mobilidade reduzida?",
    answer:
      "Se você ou alguém do seu convite precisar de apoio específico de mobilidade, escreva para casamento@brimax.life. Assim conseguimos orientar com mais cuidado antes do grande dia."
  }
];
