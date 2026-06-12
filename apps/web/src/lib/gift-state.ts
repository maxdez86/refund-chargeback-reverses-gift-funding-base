import { type Gift as GiftResource } from "@brimax/contracts";

export type GiftView = {
  id: string;
  name: string;
  imageSlug: string;
  totalValue: number;
  fractional: boolean;
  partValue: number | null;
  totalParts: number | null;
  finalPartValue: number | null;
  fundingModelVersion: "LEGACY_FIXED_50" | "EXACT_FINAL_QUOTA";
  partsFunded: number | null;
  partsReserved: number | null;
  confirmedAmount: number;
  reservedAmount: number;
  availableAmount: number;
  availableParts: number;
};

export type GiftAvailability = "AVAILABLE" | "RESERVED_PENDING" | "CONFIRMED_FUNDED";

export function toGiftView(gift: GiftResource): GiftView {
  return {
    id: gift.id,
    name: gift.name,
    imageSlug: gift.image,
    totalValue: gift.totalValueCents / 100,
    fractional: gift.fractional,
    partValue: gift.partValueCents ? gift.partValueCents / 100 : null,
    totalParts: gift.totalParts,
    finalPartValue: gift.finalPartValueCents ? gift.finalPartValueCents / 100 : null,
    fundingModelVersion: gift.fundingModelVersion,
    partsFunded: gift.partsFunded,
    partsReserved: gift.partsReserved,
    confirmedAmount: gift.confirmedAmountCents / 100,
    reservedAmount: gift.reservedAmountCents / 100,
    availableAmount: gift.availableAmountCents / 100,
    availableParts: gift.availableParts,
  };
}

// Availability is derived only from confirmed-vs-reserved math. The backend
// `fullyFunded` flag is intentionally not read here: reservation writes have
// historically set it before payment confirmation, so a pending (abandoned)
// checkout would otherwise render as a purchased gift.
export function getGiftAvailability(g: GiftView): GiftAvailability {
  if (g.fundingModelVersion === "EXACT_FINAL_QUOTA") {
    const confirmedFunded =
      g.totalParts != null && g.partsFunded != null
        ? g.partsFunded >= g.totalParts
        : g.confirmedAmount >= g.totalValue;

    if (confirmedFunded) {
      return "CONFIRMED_FUNDED";
    }
    if (g.availableParts <= 0 || g.availableAmount <= 0) {
      return "RESERVED_PENDING";
    }
    return "AVAILABLE";
  }

  if (g.fractional && g.totalParts != null) {
    if ((g.partsFunded ?? 0) >= g.totalParts) {
      return "CONFIRMED_FUNDED";
    }
    if ((g.partsFunded ?? 0) + (g.partsReserved ?? 0) >= g.totalParts) {
      return "RESERVED_PENDING";
    }
    return "AVAILABLE";
  }

  if ((g.partsFunded ?? 0) >= 1) {
    return "CONFIRMED_FUNDED";
  }
  if ((g.partsReserved ?? 0) >= 1) {
    return "RESERVED_PENDING";
  }
  return "AVAILABLE";
}

export function fundedPercent(g: GiftView): number {
  if (g.fundingModelVersion === "EXACT_FINAL_QUOTA") {
    if (g.totalValue <= 0) return 0;
    return Math.min(100, Math.round((g.confirmedAmount / g.totalValue) * 100));
  }

  if (!g.fractional || !g.totalParts || g.partsFunded == null) return 0;
  return Math.min(100, Math.round((g.partsFunded / g.totalParts) * 100));
}

export function getRemainingParts(gift: GiftView) {
  if (gift.fundingModelVersion === "EXACT_FINAL_QUOTA") {
    return gift.availableParts;
  }

  return gift.fractional && gift.totalParts != null && gift.partsFunded != null
    ? gift.totalParts - gift.partsFunded - (gift.partsReserved ?? 0)
    : 0;
}

export function getFundedAmount(gift: GiftView) {
  if (gift.fundingModelVersion === "EXACT_FINAL_QUOTA") {
    return gift.confirmedAmount;
  }

  return gift.fractional && gift.partValue != null && gift.partsFunded != null
    ? gift.partValue * gift.partsFunded
    : 0;
}

export function getContributionAmount(gift: GiftView, quantity: number) {
  if (!gift.fractional) {
    return gift.totalValue;
  }

  if (gift.fundingModelVersion !== "EXACT_FINAL_QUOTA") {
    return quantity * (gift.partValue ?? 0);
  }

  const partValue = gift.partValue ?? 0;
  const finalPartValue = gift.finalPartValue ?? partValue;
  const regularPartsTotal = Math.max(0, (gift.totalParts ?? 0) - 1);
  const soldParts = Math.max(0, (gift.totalParts ?? 0) - gift.availableParts);
  const regularPartsRemaining = Math.max(0, regularPartsTotal - soldParts);
  const regularPartsToTake = Math.min(quantity, regularPartsRemaining);
  const finalPartsToTake = Math.max(0, quantity - regularPartsToTake);

  return regularPartsToTake * partValue + finalPartsToTake * finalPartValue;
}

export function sortGifts(gifts: GiftView[]): GiftView[] {
  return [...gifts].sort((a, b) => a.totalValue - b.totalValue);
}
