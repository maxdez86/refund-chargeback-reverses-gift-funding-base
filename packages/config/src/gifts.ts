export type PaymentGift = {
  id: string;
  name: string;
  image: string;
  totalValueCents: number;
  fractional: boolean;
  partValueCents: number | null;
  totalParts: number | null;
};

function single(id: string, name: string, priceInBrl: number, image: string): PaymentGift {
  return {
    id,
    name,
    image,
    totalValueCents: priceInBrl * 100,
    fractional: false,
    partValueCents: null,
    totalParts: null
  };
}

function fractional(id: string, name: string, priceInBrl: number, image: string): PaymentGift {
  const partValueCents = 5_000;

  return {
    id,
    name,
    image,
    totalValueCents: priceInBrl * 100,
    fractional: true,
    partValueCents,
    totalParts: Math.ceil((priceInBrl * 100) / partValueCents)
  };
}

export const PAYMENT_GIFTS: PaymentGift[] = [
  single("g-toalhas-banho", "4 Toalhas de Banho", 176, "4-toalhas-banho.jpg"),
  single("g-air-fryer", "Air Fryer", 170, "air-fryer-169.webp"),
  fractional("g-armario", "Armário de Cozinha", 1749, "armario-cozinha.webp"),
  single("g-aspirador", "Aspirador", 139, "aspirador.jpg"),
  single("g-balde", "Balde Retrátil 10L", 69, "balde-retratil.webp"),
  single("g-batedeira", "Batedeira", 79, "batedeira.jpg"),
  fractional("g-cama", "Cama", 1199, "cama.webp"),
  single("g-edredom", "Edredom King", 136, "edredom-king.webp"),
  single("g-escorredor", "Escorredor de Louça", 100, "escorredor-louca.jpg"),
  fractional("g-fogao", "Fogão", 1000, "fogao.jpg"),
  fractional("g-guarda-roupa", "Guarda-roupa", 3000, "guarda-roupa.jpg"),
  single("g-ferramentas", "Jogo de Ferramentas", 99, "jogo-ferramentas.webp"),
  fractional("g-pratos", "Jogo de Pratos 12 Peças", 331, "jogo-pratos.jpg"),
  single("g-talheres", "Jogo de Talheres", 178, "jogo-talheres.jpg"),
  single("g-xicaras", "Jogo de Xícaras", 188, "jogo-xicaras.webp"),
  single("g-toalhas-rosto", "Kit 4 Toalhas de Rosto", 65, "kit-toalhas-rosto.jpg"),
  fractional("g-lava-seca", "Lava e Seca 11kg", 2900, "lava-seca.jpg"),
  fractional("g-lava-loucas", "Lava-louças", 1900, "lava-loucas.jpg"),
  single("g-liquidificador", "Liquidificador", 94, "liquidificador.jpg"),
  fractional("g-mesa", "Mesa de Jantar", 650, "mesa-jantar.webp"),
  fractional("g-microondas", "Micro-ondas", 484, "microondas.jpg"),
  single("g-processador", "Processador de Alimentos", 129, "processador.jpg"),
  single("g-purificador", "Purificador de Água", 169, "purificador-agua.png"),
  fractional("g-refrigerador", "Geladeira Brastemp", 2960, "geladeira-brastemp.jpg"),
  fractional("g-sofa", "Sofá", 1482, "sofa.webp"),
  single("g-steamer", "Steamer", 141, "steamer.jpg"),
  single("g-travesseiros", "Travesseiros", 15, "travesseiros.jpg")
];

export const PAYMENT_GIFTS_BY_ID = new Map(PAYMENT_GIFTS.map((gift) => [gift.id, gift]));
