export type PaymentGift = {
  id: string;
  name: string;
  image: string;
  totalValueCents: number;
  fractional: boolean;
  partValueCents: number | null;
  totalParts: number | null;
  finalPartValueCents: number | null;
  fundingModelVersion: "LEGACY_FIXED_50" | "EXACT_FINAL_QUOTA";
};

function single(id: string, name: string, priceInBrl: number, image: string): PaymentGift {
  return {
    id,
    name,
    image,
    totalValueCents: priceInBrl * 100,
    fractional: false,
    partValueCents: null,
    totalParts: null,
    finalPartValueCents: null,
    fundingModelVersion: "LEGACY_FIXED_50"
  };
}

function fractional(
  id: string,
  name: string,
  priceInBrl: number,
  image: string,
  fundingModelVersion: "LEGACY_FIXED_50" | "EXACT_FINAL_QUOTA" = "LEGACY_FIXED_50"
): PaymentGift {
  const partValueCents = 5_000;
  const totalValueCents = priceInBrl * 100;
  const totalParts = Math.ceil(totalValueCents / partValueCents);
  const finalPartValueCents =
    fundingModelVersion === "EXACT_FINAL_QUOTA" && totalParts > 0
      ? totalValueCents - partValueCents * (totalParts - 1)
      : null;

  return {
    id,
    name,
    image,
    totalValueCents,
    fractional: true,
    partValueCents,
    totalParts,
    finalPartValueCents,
    fundingModelVersion
  };
}

export const PAYMENT_GIFTS: PaymentGift[] = [
  single("g-toalhas-banho", "4 Toalhas de Banho", 176, "toalhas-banho"),
  single("g-air-fryer", "Air Fryer", 170, "air-fryer-169"),
  fractional("g-armario", "Armário de Cozinha", 1700, "armario-cozinha"),
  single("g-aspirador", "Aspirador", 139, "aspirador"),
  single("g-balde", "Balde Retrátil 10L", 69, "balde-retratil"),
  single("g-batedeira", "Batedeira", 79, "batedeira"),
  fractional("g-cama", "Cama", 1150, "cama"),
  single("g-edredom", "Edredom King", 136, "edredom-king"),
  single("g-escorredor", "Escorredor de Louça", 100, "escorredor-louca"),
  fractional("g-fogao", "Fogão", 1000, "fogao"),
  fractional("g-guarda-roupa", "Guarda-roupa", 3000, "guarda-roupa"),
  single("g-ferramentas", "Jogo de Ferramentas", 99, "jogo-ferramentas"),
  fractional("g-pratos", "Jogo de Pratos 12 Peças", 300, "jogo-pratos", "EXACT_FINAL_QUOTA"),
  single("g-talheres", "Jogo de Talheres", 178, "jogo-talheres"),
  single("g-xicaras", "Jogo de Xícaras", 188, "jogo-xicaras"),
  single("g-toalhas-rosto", "Kit 4 Toalhas de Rosto", 65, "kit-toalhas-rosto"),
  fractional("g-lava-seca", "Lava e Seca 11kg", 2900, "lava-seca"),
  fractional("g-lava-loucas", "Lava-louças", 1900, "lava-loucas"),
  single("g-liquidificador", "Liquidificador", 94, "liquidificador"),
  fractional("g-mesa", "Mesa de Jantar", 650, "mesa-jantar"),
  fractional("g-microondas", "Micro-ondas", 450, "microondas"),
  single("g-processador", "Processador de Alimentos", 129, "processador"),
  single("g-purificador", "Purificador de Água", 169, "purificador-agua"),
  fractional("g-refrigerador", "Geladeira Brastemp", 2950, "geladeira-brastemp"),
  fractional("g-sofa", "Sofá", 1450, "sofa"),
  single("g-steamer", "Steamer", 141, "steamer"),
  single("g-travesseiros", "Travesseiros", 59, "travesseiros")
];

export const PAYMENT_GIFTS_BY_ID = new Map(PAYMENT_GIFTS.map((gift) => [gift.id, gift]));
