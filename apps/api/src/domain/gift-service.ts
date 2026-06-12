import { GetGiftsResponseSchema, type Gift } from "@brimax/contracts";
import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { sweepStaleCheckouts } from "./checkout-expiry";

export class GiftService {
  constructor(private readonly repository = new PaymentRepository()) {}

  async getGifts() {
    // Release stale abandoned-checkout reservations before reading the gift
    // states, so this same response already reflects the freed parts. The
    // sweep must never take the registry down with it.
    try {
      await sweepStaleCheckouts(this.repository, Date.now());
    } catch (error) {
      console.error(
        JSON.stringify({
          metric: "CHECKOUT_EXPIRY_SWEEP_FAILED",
          errorMessage: error instanceof Error ? error.message : String(error)
        })
      );
    }

    const giftMetadata = await this.repository.listGiftMetadata();
    const giftStates = await this.repository.listGiftStates();
    const statesByGiftId = new Map(giftStates.map((state) => [state.giftId, state]));

    const gifts: Gift[] = giftMetadata.map((gift) => {
      const state = statesByGiftId.get(gift.id);
      const partsFunded = state?.partsFunded ?? 0;
      const partsReserved = state?.partsReserved ?? 0;
      const confirmedAmountCents =
        state?.confirmedAmountCents ??
        (gift.fractional
          ? partsFunded * (gift.partValueCents ?? 0)
          : partsFunded
            ? gift.totalValueCents
            : 0);
      const reservedAmountCents =
        state?.reservedAmountCents ??
        (gift.fractional
          ? partsReserved * (gift.partValueCents ?? 0)
          : partsReserved
            ? gift.totalValueCents
            : 0);

      return {
        id: gift.id,
        name: gift.name,
        image: gift.image,
        fractional: gift.fractional,
        totalValueCents: gift.totalValueCents,
        partValueCents: gift.partValueCents,
        totalParts: gift.totalParts,
        finalPartValueCents: gift.finalPartValueCents ?? null,
        fundingModelVersion: gift.fundingModelVersion ?? "LEGACY_FIXED_50",
        partsFunded,
        partsReserved,
        confirmedAmountCents,
        reservedAmountCents,
        availableAmountCents: Math.max(
          0,
          gift.totalValueCents - confirmedAmountCents - reservedAmountCents
        ),
        availableParts: Math.max(0, (gift.totalParts ?? 1) - partsFunded - partsReserved),
        fullyFunded: state?.fullyFunded ?? false,
        updatedAt: state?.updatedAt ?? null
      };
    });

    return GetGiftsResponseSchema.parse({
      ok: true,
      gifts
    });
  }
}
