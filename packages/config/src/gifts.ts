export type PaymentGift = {
  id: string;
  name: string;
  totalValueCents: number;
  fractional: boolean;
  partValueCents: number | null;
  totalParts: number | null;
};

function single(id: string, name: string, priceInBrl: number): PaymentGift {
  return {
    id,
    name,
    totalValueCents: priceInBrl * 100,
    fractional: false,
    partValueCents: null,
    totalParts: null
  };
}

function fractional(id: string, name: string, priceInBrl: number): PaymentGift {
  const partValueCents = 5_000;

  return {
    id,
    name,
    totalValueCents: priceInBrl * 100,
    fractional: true,
    partValueCents,
    totalParts: Math.ceil((priceInBrl * 100) / partValueCents)
  };
}

export const PAYMENT_GIFTS: PaymentGift[] = [
  single("g-test-pix", "PIX Teste", 5),
  single("g-toalhas-banho", "4 Toalhas de Banho", 176),
  fractional("g-armario", "Armário de Cozinha", 1749),
  single("g-aspirador", "Aspirador", 139),
  single("g-balde", "Balde Retrátil 10L", 69),
  single("g-batedeira", "Batedeira", 79),
  fractional("g-cama", "Cama", 1199),
  single("g-edredom", "Edredom King", 136),
  single("g-escorredor", "Escorredor de Louça", 100),
  fractional("g-fogao", "Fogão", 1000),
  fractional("g-guarda-roupa", "Guarda-roupa", 3000),
  single("g-ferramentas", "Jogo de Ferramentas", 99),
  fractional("g-pratos", "Jogo de Pratos 12 Peças", 331),
  single("g-talheres", "Jogo de Talheres", 178),
  single("g-xicaras", "Jogo de Xícaras", 188),
  single("g-toalhas-rosto", "Kit 4 Toalhas de Rosto", 65),
  fractional("g-lava-seca", "Lava e Seca 11kg", 2900),
  fractional("g-lava-loucas", "Lava-louças", 1900),
  single("g-liquidificador", "Liquidificador", 94),
  fractional("g-mesa", "Mesa de Jantar", 650),
  fractional("g-microondas", "Micro-ondas", 484),
  single("g-processador", "Processador de Alimentos", 129),
  single("g-purificador", "Purificador de Água", 169),
  fractional("g-refrigerador", "Geladeira Brastemp", 2960),
  fractional("g-sofa", "Sofá", 1482),
  single("g-steamer", "Steamer", 141),
  single("g-travesseiros", "Travesseiros", 59)
];

export const PAYMENT_GIFTS_BY_ID = new Map(PAYMENT_GIFTS.map((gift) => [gift.id, gift]));
