import { GetGiftsResponseSchema, type Gift } from "@brimax/contracts";
import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";

export class GiftService {
  constructor(private readonly repository = new PaymentRepository()) {}

  async getGifts() {
    const giftMetadata = await this.repository.listGiftMetadata();
    const giftStates = await this.repository.listGiftStates();
    const statesByGiftId = new Map(giftStates.map((state) => [state.giftId, state]));

    const gifts: Gift[] = giftMetadata.map((gift) => {
      const state = statesByGiftId.get(gift.id);

      return {
        id: gift.id,
        name: gift.name,
        image: gift.image,
        fractional: gift.fractional,
        totalValueCents: gift.totalValueCents,
        partValueCents: gift.partValueCents,
        totalParts: gift.totalParts,
        finalPartValueCents: gift.finalPartValueCents,
        fundingModelVersion: gift.fundingModelVersion,
        partsFunded: state?.partsFunded ?? 0,
        partsReserved: state?.partsReserved ?? 0,
        confirmedAmountCents:
          state?.confirmedAmountCents ??
          (gift.fractional
            ? (state?.partsFunded ?? 0) * (gift.partValueCents ?? 0)
            : state?.partsFunded
              ? gift.totalValueCents
              : 0),
        reservedAmountCents:
          state?.reservedAmountCents ??
          (state?.partsReserved ?? 0) * (gift.partValueCents ?? 0),
        availableAmountCents: Math.max(
          0,
          gift.totalValueCents - ((state?.confirmedAmountCents ?? 0) + (state?.reservedAmountCents ?? 0))
        ),
        availableParts: Math.max(0, (gift.totalParts ?? 1) - ((state?.partsFunded ?? 0) + (state?.partsReserved ?? 0))),
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
