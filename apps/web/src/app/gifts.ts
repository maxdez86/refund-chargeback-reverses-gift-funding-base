import type { GiftItem } from "./data";

export type GiftViewModel = GiftItem & {
  originalIndex: number;
  fullyFunded: boolean;
};

export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

export function normalizeGift(gift: GiftItem, originalIndex = 0): GiftViewModel {
  const fullyFunded = gift.fractional ? gift.partsFunded === gift.totalParts : gift.fullyFunded;

  return {
    ...gift,
    originalIndex,
    fullyFunded
  };
}

export function remainingParts(gift: GiftItem): number | null {
  if (!gift.fractional || gift.partsFunded == null || gift.totalParts == null) {
    return null;
  }

  return Math.max(0, gift.totalParts - gift.partsFunded);
}

export function fundingPercent(gift: GiftItem): number {
  if (!gift.fractional || !gift.totalParts || gift.partsFunded == null) {
    return 0;
  }

  return Math.round((gift.partsFunded / gift.totalParts) * 100);
}

export function fundedAmount(gift: GiftItem): number {
  if (!gift.fractional || gift.partValue == null || gift.partsFunded == null) {
    return gift.fullyFunded ? gift.totalValue : 0;
  }

  return gift.partsFunded * gift.partValue;
}

export function giftSortBucket(gift: GiftItem): number {
  if (gift.fullyFunded) return 4;
  if (!gift.fractional) return 1;
  if ((gift.partsFunded ?? 0) === 0) return 2;
  return 3;
}

export function sortGifts(gifts: GiftItem[]): GiftViewModel[] {
  return gifts
    .map((gift, index) => normalizeGift(gift, index))
    .sort((left, right) => {
      const bucketDifference = giftSortBucket(left) - giftSortBucket(right);

      if (bucketDifference) {
        return bucketDifference;
      }

      if (giftSortBucket(left) === 3) {
        return fundingPercent(left) - fundingPercent(right);
      }

      return left.originalIndex - right.originalIndex;
    });
}

export function giftStateLabel(gift: GiftItem): string {
  if (gift.fullyFunded) return "Presente já garantido";
  if (gift.fractional && (gift.partsFunded ?? 0) > 0) return "Parcialmente presenteado";
  return "Disponível";
}

export function clampGiftQuantity(value: number | string, gift: GiftItem | null): number {
  const max = remainingParts(gift ?? ({} as GiftItem)) ?? 1;
  const parsed = Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed)) {
    return 1;
  }

  return Math.min(max, Math.max(1, parsed));
}
