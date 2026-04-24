import { GIFT_ITEMS } from "../src/app/data";
import { clampGiftQuantity, fundingPercent, remainingParts, sortGifts } from "../src/app/gifts";
import { buildConfirmationPayload, normalizeLookupValue, resolveInvitationGroup } from "../src/app/rsvp";

describe("gift helpers", () => {
  it("sorts available gifts before funded ones", () => {
    const sorted = sortGifts(GIFT_ITEMS);

    expect(sorted[0].name).toBe("Jogo de Toalhas");
    expect(sorted.at(-1)?.name).toBe("Aspirador Robô");
  });

  it("computes gift progress and clamps quantities", () => {
    const gift = GIFT_ITEMS.find((item) => item.id === "presente-02")!;

    expect(fundingPercent(gift)).toBe(19);
    expect(remainingParts(gift)).toBe(13);
    expect(clampGiftQuantity(99, gift)).toBe(13);
    expect(clampGiftQuantity("abc", gift)).toBe(1);
  });
});

describe("rsvp helpers", () => {
  it("normalizes lookup values and resolves exact and fuzzy matches", () => {
    expect(normalizeLookupValue(" Débora  ")).toBe("debora");
    expect(resolveInvitationGroup("Débora")).toEqual({
      state: "resolved",
      groupId: "grupo-debora-nael"
    });
    expect(resolveInvitationGroup("Debra")).toEqual({
      state: "resolved",
      groupId: "grupo-debora-nael"
    });
    expect(resolveInvitationGroup("car")).toEqual({
      state: "ambiguous",
      groupIds: ["grupo-nessa-carlos", "grupo-carol-igor"]
    });
    expect(resolveInvitationGroup("Nome Inexistente")).toEqual({ state: "not-found" });
  });

  it("builds the frontend-only confirmation payload", () => {
    const payload = buildConfirmationPayload(
      {
        id: "grupo-amanda-cris",
        primaryName: "Amanda",
        guests: ["Amanda", "Cris"]
      },
      "Amanda",
      { Amanda: true, Cris: false }
    );

    expect(payload.invitationGroupId).toBe("grupo-amanda-cris");
    expect(payload.confirmations).toEqual([
      { name: "Amanda", attending: true },
      { name: "Cris", attending: false }
    ]);
  });
});
