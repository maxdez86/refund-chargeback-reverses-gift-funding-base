import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GiftService } from "../src/domain/gift-service";

function repositoryWith(metadata: unknown[], states: unknown[]) {
  return {
    batchGetGiftCatalog: vi.fn().mockResolvedValue({ metadata, states })
  };
}

describe("GiftService", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // METADATA is seeded for every PAYMENT_GIFTS id, so a subset fixture logs
    // GIFT_METADATA_MISSING for the rest — silence it except where asserted.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns shared gift metadata with zero-funded defaults when state rows are missing", async () => {
    const repository = repositoryWith(
      [
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
      ],
      []
    );

    const service = new GiftService(repository as never);
    const response = await service.getGifts();
    const toalhasGift = response.gifts.find((gift) => gift.id === "g-toalhas-banho");

    expect(response.ok).toBe(true);
    expect(repository.batchGetGiftCatalog).toHaveBeenCalledTimes(1);
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
    const repository = repositoryWith(
      [
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
      ],
      [
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
      ]
    );

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
    const repository = repositoryWith(
      [
        {
          id: "g-armario",
          name: "Armário de Cozinha",
          image: "armario-cozinha",
          totalValueCents: 174_900,
          fractional: true,
          partValueCents: 5_000,
          totalParts: 35
        }
      ],
      [
        {
          giftId: "g-armario",
          partsFunded: 3,
          fullyFunded: false,
          updatedAt: "2026-05-13T00:00:00.000Z"
        }
      ]
    );

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

  it("reads the catalog with a single batch get and never runs a sweep", async () => {
    const repository = repositoryWith([], []) as Record<string, unknown> & {
      batchGetGiftCatalog: ReturnType<typeof vi.fn>;
    };
    // Sweep collaborators must not exist on the read path anymore.
    repository.listStaleOpenReservations = vi.fn();
    repository.tryExpireStalePayment = vi.fn();
    repository.releaseReservationAfterCheckoutFailure = vi.fn();

    const service = new GiftService(repository as never);
    const response = await service.getGifts();

    expect(response.ok).toBe(true);
    expect(repository.batchGetGiftCatalog).toHaveBeenCalledTimes(1);
    expect(repository.listStaleOpenReservations).not.toHaveBeenCalled();
    expect(repository.tryExpireStalePayment).not.toHaveBeenCalled();
    expect(repository.releaseReservationAfterCheckoutFailure).not.toHaveBeenCalled();
  });

  it("omits gifts whose metadata row is absent and logs the gap", async () => {
    const repository = repositoryWith([], []);

    const service = new GiftService(repository as never);
    const response = await service.getGifts();

    expect(response.gifts).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"GIFT_METADATA_MISSING\"")
    );
  });
});
