import { describe, expect, it, vi } from "vitest";
import { GiftService } from "../src/domain/gift-service";

describe("GiftService", () => {
  it("returns shared gift metadata with zero-funded defaults when state rows are missing", async () => {
    const repository = {
      listGiftStates: vi.fn().mockResolvedValue([])
    };

    const service = new GiftService(repository as never);
    const response = await service.getGifts();
    const pixGift = response.gifts.find((gift) => gift.id === "g-test-pix");

    expect(response.ok).toBe(true);
    expect(pixGift).toEqual(
      expect.objectContaining({
        id: "g-test-pix",
        imageUrl: "https://brimax.life/images/gifts-home.png",
        partsFunded: 0,
        fullyFunded: false,
        updatedAt: null
      })
    );
  });

  it("merges stored gift state into the shared catalog", async () => {
    const repository = {
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
