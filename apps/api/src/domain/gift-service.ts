import { PAYMENT_GIFTS } from "@brimax/config";
import { GetGiftsResponseSchema, type Gift } from "@brimax/contracts";
import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";

export class GiftService {
  constructor(private readonly repository = new PaymentRepository()) {}

  async getGifts() {
    const giftStates = await this.repository.listGiftStates();
    const statesByGiftId = new Map(giftStates.map((state) => [state.giftId, state]));

    const gifts: Gift[] = PAYMENT_GIFTS.map((gift) => {
      const state = statesByGiftId.get(gift.id);

      return {
        id: gift.id,
        name: gift.name,
        image: gift.image,
        fractional: gift.fractional,
        totalValueCents: gift.totalValueCents,
        partValueCents: gift.partValueCents,
        totalParts: gift.totalParts,
        partsFunded: state?.partsFunded ?? 0,
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
