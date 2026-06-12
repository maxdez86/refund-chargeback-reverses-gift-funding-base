import { describe, expect, it } from "vitest";
import type { Gift as GiftResource } from "@brimax/contracts";
import {
  type GiftView,
  fundedPercent,
  getGiftAvailability,
  toGiftView,
} from "@/lib/gift-state";

function makeView(overrides: Partial<GiftView> = {}): GiftView {
  return {
    id: "g-test",
    name: "Jogo de Taças",
    imageSlug: "g-tacas",
    totalValue: 250,
    fractional: true,
    partValue: 50,
    totalParts: 5,
    finalPartValue: 50,
    fundingModelVersion: "EXACT_FINAL_QUOTA",
    partsFunded: 0,
    partsReserved: 0,
    confirmedAmount: 0,
    reservedAmount: 0,
    availableAmount: 250,
    availableParts: 5,
    ...overrides,
  };
}

function makeResource(overrides: Partial<GiftResource> = {}): GiftResource {
  return {
    id: "g-test",
    name: "Jogo de Taças",
    image: "g-tacas",
    fractional: true,
    totalValueCents: 25_000,
    partValueCents: 5_000,
    totalParts: 5,
    finalPartValueCents: 5_000,
    fundingModelVersion: "EXACT_FINAL_QUOTA",
    partsFunded: 0,
    partsReserved: 0,
    confirmedAmountCents: 0,
    reservedAmountCents: 0,
    availableAmountCents: 25_000,
    availableParts: 5,
    fullyFunded: false,
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("getGiftAvailability", () => {
  describe("EXACT_FINAL_QUOTA", () => {
    it("reports a fully reserved but unconfirmed gift as RESERVED_PENDING, not funded", () => {
      const gift = makeView({
        partsFunded: 0,
        partsReserved: 5,
        confirmedAmount: 0,
        reservedAmount: 250,
        availableAmount: 0,
        availableParts: 0,
      });

      expect(getGiftAvailability(gift)).toBe("RESERVED_PENDING");
    });

    it("reports a fully confirmed gift as CONFIRMED_FUNDED", () => {
      const gift = makeView({
        partsFunded: 5,
        partsReserved: 0,
        confirmedAmount: 250,
        reservedAmount: 0,
        availableAmount: 0,
        availableParts: 0,
      });

      expect(getGiftAvailability(gift)).toBe("CONFIRMED_FUNDED");
    });

    it("reports a non-fractional gift without parts as CONFIRMED_FUNDED from the confirmed amount", () => {
      const gift = makeView({
        fractional: false,
        partValue: null,
        totalParts: null,
        finalPartValue: null,
        partsFunded: null,
        partsReserved: null,
        confirmedAmount: 250,
        availableAmount: 0,
        availableParts: 0,
      });

      expect(getGiftAvailability(gift)).toBe("CONFIRMED_FUNDED");
    });

    it("keeps a partially reserved gift with parts left AVAILABLE", () => {
      const gift = makeView({
        partsFunded: 1,
        partsReserved: 2,
        confirmedAmount: 50,
        reservedAmount: 100,
        availableAmount: 100,
        availableParts: 2,
      });

      expect(getGiftAvailability(gift)).toBe("AVAILABLE");
    });
  });

  describe("legacy fractional", () => {
    const legacy = (overrides: Partial<GiftView>) =>
      makeView({ fundingModelVersion: "LEGACY_FIXED_50", ...overrides });

    it("is CONFIRMED_FUNDED when all parts are funded", () => {
      expect(getGiftAvailability(legacy({ partsFunded: 5, partsReserved: 0 }))).toBe(
        "CONFIRMED_FUNDED"
      );
    });

    it("is RESERVED_PENDING when funded plus reserved covers all parts", () => {
      expect(getGiftAvailability(legacy({ partsFunded: 3, partsReserved: 2 }))).toBe(
        "RESERVED_PENDING"
      );
    });

    it("is AVAILABLE while parts remain", () => {
      expect(getGiftAvailability(legacy({ partsFunded: 3, partsReserved: 1 }))).toBe(
        "AVAILABLE"
      );
    });
  });

  describe("legacy non-fractional", () => {
    const legacy = (overrides: Partial<GiftView>) =>
      makeView({
        fundingModelVersion: "LEGACY_FIXED_50",
        fractional: false,
        partValue: null,
        totalParts: null,
        finalPartValue: null,
        ...overrides,
      });

    it("is CONFIRMED_FUNDED once funded", () => {
      expect(getGiftAvailability(legacy({ partsFunded: 1, partsReserved: 0 }))).toBe(
        "CONFIRMED_FUNDED"
      );
    });

    it("is RESERVED_PENDING while only reserved", () => {
      expect(getGiftAvailability(legacy({ partsFunded: 0, partsReserved: 1 }))).toBe(
        "RESERVED_PENDING"
      );
    });

    it("is AVAILABLE with no funding or reservation", () => {
      expect(getGiftAvailability(legacy({ partsFunded: 0, partsReserved: 0 }))).toBe(
        "AVAILABLE"
      );
    });

    it("treats null counters as AVAILABLE", () => {
      expect(getGiftAvailability(legacy({ partsFunded: null, partsReserved: null }))).toBe(
        "AVAILABLE"
      );
    });
  });

  it("ignores a poisoned fullyFunded=true flag when counters show no confirmed funding", () => {
    const gift = toGiftView(
      makeResource({
        fullyFunded: true,
        partsFunded: 0,
        partsReserved: 0,
        confirmedAmountCents: 0,
        reservedAmountCents: 0,
        availableAmountCents: 25_000,
        availableParts: 5,
      })
    );

    expect(getGiftAvailability(gift)).toBe("AVAILABLE");
  });
});

describe("fundedPercent", () => {
  it("stays confirmed-only for a fully reserved gift", () => {
    const gift = makeView({
      partsFunded: 1,
      partsReserved: 4,
      confirmedAmount: 50,
      reservedAmount: 200,
      availableAmount: 0,
      availableParts: 0,
    });

    expect(fundedPercent(gift)).toBe(20);
  });
});
