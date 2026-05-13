export type PaymentGift = {
  id: string;
  name: string;
  imageUrl: string;
  totalValueCents: number;
  fractional: boolean;
  partValueCents: number | null;
  totalParts: number | null;
};

const GIFT_IMAGE_BASE_URL =
  "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/gifts";

function hostedGiftImageUrl(filename: string) {
  return `${GIFT_IMAGE_BASE_URL}/${encodeURIComponent(filename)}`;
}

function single(id: string, name: string, priceInBrl: number, imageUrl: string): PaymentGift {
  return {
    id,
    name,
    imageUrl,
    totalValueCents: priceInBrl * 100,
    fractional: false,
    partValueCents: null,
    totalParts: null
  };
}

function fractional(id: string, name: string, priceInBrl: number, imageUrl: string): PaymentGift {
  const partValueCents = 5_000;

  return {
    id,
    name,
    imageUrl,
    totalValueCents: priceInBrl * 100,
    fractional: true,
    partValueCents,
    totalParts: Math.ceil((priceInBrl * 100) / partValueCents)
  };
}

export const PAYMENT_GIFTS: PaymentGift[] = [
  single("g-test-pix", "PIX Teste", 5, "https://brimax.life/images/gifts-home.png"),
  single("g-toalhas-banho", "4 Toalhas de Banho", 176, hostedGiftImageUrl("4 Toalhas De Banho_176.jpg")),
  fractional("g-armario", "Armário de Cozinha", 1749, hostedGiftImageUrl("armario_cozinha_ 1749.webp")),
  single("g-aspirador", "Aspirador", 139, hostedGiftImageUrl("aspirador_139.jpg")),
  single("g-balde", "Balde Retrátil 10L", 69, hostedGiftImageUrl("Balde 10l Retrátil_69.webp")),
  single("g-batedeira", "Batedeira", 79, hostedGiftImageUrl("Batedeira_79.jpg")),
  fractional("g-cama", "Cama", 1199, hostedGiftImageUrl("cama_1199.webp")),
  single("g-edredom", "Edredom King", 136, hostedGiftImageUrl("edredom-king_136.webp")),
  single("g-escorredor", "Escorredor de Louça", 100, hostedGiftImageUrl("Escorredores de Louça_100.jpg")),
  fractional("g-fogao", "Fogão", 1000, hostedGiftImageUrl("fogao_1000.jpg")),
  fractional("g-guarda-roupa", "Guarda-roupa", 3000, hostedGiftImageUrl("Guarda-roupa_3000.jpg")),
  single("g-ferramentas", "Jogo de Ferramentas", 99, hostedGiftImageUrl("Jogo De Ferramentas_99.webp")),
  fractional("g-pratos", "Jogo de Pratos 12 Peças", 331, hostedGiftImageUrl("jogo_prato_12pecas_331.jpg")),
  single("g-talheres", "Jogo de Talheres", 178, hostedGiftImageUrl("jogo_talheres_178.jpg")),
  single("g-xicaras", "Jogo de Xícaras", 188, hostedGiftImageUrl("jogo_de_xicara_188.webp")),
  single("g-toalhas-rosto", "Kit 4 Toalhas de Rosto", 65, hostedGiftImageUrl("Kit 4 Toalhas De Rosto_65.jpg")),
  fractional("g-lava-seca", "Lava e Seca 11kg", 2900, hostedGiftImageUrl("Lava e Seca 11kg_2900.jpg")),
  fractional("g-lava-loucas", "Lava-louças", 1900, hostedGiftImageUrl("Lava-louças_1900.jpg")),
  single("g-liquidificador", "Liquidificador", 94, hostedGiftImageUrl("liquidificador_94.jpg")),
  fractional("g-mesa", "Mesa de Jantar", 650, hostedGiftImageUrl("mesa_650.webp")),
  fractional("g-microondas", "Micro-ondas", 484, hostedGiftImageUrl("microondas_484.jpg")),
  single("g-processador", "Processador de Alimentos", 129, hostedGiftImageUrl("processador_129.jpg")),
  single("g-purificador", "Purificador de Água", 169, hostedGiftImageUrl("purificador_agua_169.png")),
  fractional("g-refrigerador", "Geladeira Brastemp", 2960, hostedGiftImageUrl("Geladeira_Brastemp_2960.jpg")),
  fractional("g-sofa", "Sofá", 1482, hostedGiftImageUrl("sofa_ 1482.webp")),
  single("g-steamer", "Steamer", 141, hostedGiftImageUrl("steamer_141.jpg")),
  single("g-travesseiros", "Travesseiros", 59, hostedGiftImageUrl("travesseiros_59.jpg"))
];

export const PAYMENT_GIFTS_BY_ID = new Map(PAYMENT_GIFTS.map((gift) => [gift.id, gift]));
