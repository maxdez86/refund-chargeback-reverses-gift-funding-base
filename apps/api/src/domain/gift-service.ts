import { AdminGiftSchema, GetGiftsResponseSchema, type Gift } from "@brimax/contracts";
import { PAYMENT_GIFTS } from "@brimax/config";
import { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";

export class GiftService {
  constructor(private readonly repository = new PaymentRepository()) {}

  async getGifts() {
    // Fast read: one BatchGetItem over metadata + state keys for every known
    // gift id, instead of two full-table Scans. Stale-checkout cleanup no longer
    // runs here — it is durable, traffic-independent background work (SQS +
    // EventBridge worker). A reservation that expired but has not yet been swept
    // may briefly show as unavailable; the worker reconciles within ~1 min.
    const giftIds = PAYMENT_GIFTS.map((gift) => gift.id);
    const { metadata, states } = await this.repository.batchGetGiftCatalog(giftIds);
    const statesByGiftId = new Map(states.map((state) => [state.giftId, state]));

    const gifts: Gift[] = metadata.map((gift) => {
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
        fullyFunded:
          partsFunded >= (gift.fractional ? (gift.totalParts ?? 1) : 1) ||
          (gift.totalValueCents > 0 && confirmedAmountCents >= gift.totalValueCents),
        updatedAt: state?.updatedAt ?? null
      };
    });

    // METADATA is seeded for every gift, so a gap means real drift, not a normal
    // absent-state row. Omit it (matches the old Scan behavior) and log it.
    const presentIds = new Set(metadata.map((gift) => gift.id));
    const missingMetadataIds = giftIds.filter((id) => !presentIds.has(id));
    if (missingMetadataIds.length > 0) {
      console.warn(
        JSON.stringify({
          metric: "GIFT_METADATA_MISSING",
          giftIds: missingMetadataIds
        })
      );
    }

    return GetGiftsResponseSchema.parse({
      ok: true,
      gifts
    });
  }

  async getAdminGifts() {
    const response = await this.getGifts();
    const payerNamesByGiftId = await this.repository.listConfirmedPayerNamesByGiftIds(
      response.gifts.map((gift) => gift.id)
    );

    return {
      ok: true as const,
      gifts: response.gifts.map((gift) =>
        AdminGiftSchema.parse({
          ...gift,
          payerNames: payerNamesByGiftId[gift.id] ?? []
        })
      )
    };
  }
}
