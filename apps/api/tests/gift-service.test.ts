import { describe, expect, it, vi } from "vitest";
import { GiftService } from "../src/domain/gift-service";

describe("GiftService", () => {
  it("returns shared gift metadata with zero-funded defaults when state rows are missing", async () => {
    const repository = {
      listGiftMetadata: vi.fn().mockResolvedValue([
        {
          id: "g-toalhas-banho",
          name: "4 Toalhas de Banho",
          image: "toalhas-banho",
          totalValueCents: 17_600,
          fractional: false,
          partValueCents: null,
          totalParts: null,
          finalPartValueCents: null,
          fundingModelVersion: "LEGACY_FIXED_50"
        }
      ]),
      listGiftStates: vi.fn().mockResolvedValue([])
    };

    const service = new GiftService(repository as never);
    const response = await service.getGifts();
    const toalhasGift = response.gifts.find((gift) => gift.id === "g-toalhas-banho");

    expect(response.ok).toBe(true);
    expect(toalhasGift).toEqual(
      expect.objectContaining({
        id: "g-toalhas-banho",
        image: "toalhas-banho",
        partsFunded: 0,
        partsReserved: 0,
        confirmedAmountCents: 0,
        reservedAmountCents: 0,
        availableAmountCents: 17_600,
        availableParts: 1,
        fullyFunded: false,
        updatedAt: null
      })
    );
  });

  it("merges stored gift state into the shared catalog", async () => {
    const repository = {
      listGiftMetadata: vi.fn().mockResolvedValue([
        {
          id: "g-armario",
          name: "Armário de Cozinha",
          image: "armario-cozinha",
          totalValueCents: 174_900,
          fractional: true,
          partValueCents: 5_000,
          totalParts: 35,
          finalPartValueCents: null,
          fundingModelVersion: "LEGACY_FIXED_50"
        }
      ]),
      listGiftStates: vi.fn().mockResolvedValue([
        {
          giftId: "g-armario",
          partsFunded: 3,
          partsReserved: 1,
          confirmedAmountCents: 15_000,
          reservedAmountCents: 5_000,
          fullyFunded: false,
          version: 1,
          updatedAt: "2026-05-13T00:00:00.000Z"
        }
      ])
    };

    const service = new GiftService(repository as never);
    const response = await service.getGifts();
    const gift = response.gifts.find((item) => item.id === "g-armario");

    expect(gift).toEqual(
      expect.objectContaining({
        id: "g-armario",
        partsFunded: 3,
        partsReserved: 1,
        confirmedAmountCents: 15_000,
        reservedAmountCents: 5_000,
        availableAmountCents: 154_900,
        availableParts: 31,
        fullyFunded: false,
        updatedAt: "2026-05-13T00:00:00.000Z"
      })
    );
  });

  it("normalizes legacy metadata and part-only state rows", async () => {
    const repository = {
      listGiftMetadata: vi.fn().mockResolvedValue([
        {
          id: "g-armario",
          name: "Armário de Cozinha",
          image: "armario-cozinha",
          totalValueCents: 174_900,
          fractional: true,
          partValueCents: 5_000,
          totalParts: 35
        }
      ]),
      listGiftStates: vi.fn().mockResolvedValue([
        {
          giftId: "g-armario",
          partsFunded: 3,
          fullyFunded: false,
          updatedAt: "2026-05-13T00:00:00.000Z"
        }
      ])
    };

    const service = new GiftService(repository as never);
    const response = await service.getGifts();

    expect(response.gifts[0]).toEqual(
      expect.objectContaining({
        finalPartValueCents: null,
        fundingModelVersion: "LEGACY_FIXED_50",
        partsFunded: 3,
        partsReserved: 0,
        confirmedAmountCents: 15_000,
        reservedAmountCents: 0,
        availableAmountCents: 159_900,
        availableParts: 32
      })
    );
  });
});
