import { describe, expect, it } from "vitest";
import { PAYMENT_GIFTS } from "./gifts";

describe("PAYMENT_GIFTS", () => {
  it("uses values divisible by R$50 for gifts over R$200", () => {
    const invalidGifts = PAYMENT_GIFTS.filter(
      (gift) => gift.totalValueCents > 20_000 && gift.totalValueCents % 5_000 !== 0
    );

    expect(invalidGifts).toEqual([]);
  });
});
