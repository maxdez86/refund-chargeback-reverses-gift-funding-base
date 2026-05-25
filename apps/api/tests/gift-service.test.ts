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
          totalParts: null
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
    const gift = response.gifts.find((item) => item.id === "g-armario");

    expect(gift).toEqual(
      expect.objectContaining({
        id: "g-armario",
        partsFunded: 3,
        fullyFunded: false,
        updatedAt: "2026-05-13T00:00:00.000Z"
      })
    );
  });
});
