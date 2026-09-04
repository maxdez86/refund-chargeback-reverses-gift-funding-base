import { describe, expect, it } from "vitest";
import {
  buildGuestId,
  buildInvitationGuestRecord,
  buildInvitationItems,
  buildInvitationRecord,
  nextGuestSlot
} from "../src/domain/invitation-provisioning";

describe("buildGuestId", () => {
  it("pads the slot to two digits so guest sort keys stay in slot order past nine", () => {
    expect(buildGuestId("SW2748", 3)).toBe("SW2748--guest-03");
    expect(buildGuestId("SW2748", 9)).toBe("SW2748--guest-09");
    expect(buildGuestId("SW2748", 12)).toBe("SW2748--guest-12");
  });
});

describe("nextGuestSlot", () => {
  it("never reuses the gap a removed guest left", () => {
    // Slot 3 and 4 are gone; reusing either would rebuild an id a stored RSVP answer may still
    // reference, so the next guest goes above the highest slot ever used.
    expect(nextGuestSlot([1, 2, 5])).toBe(6);
  });

  it("starts at one for an invitation with no guests", () => {
    expect(nextGuestSlot([])).toBe(1);
  });

  it("ignores rows with no usable sortOrder instead of coercing them", () => {
    expect(nextGuestSlot([undefined, 2])).toBe(3);
    expect(nextGuestSlot([undefined])).toBe(1);
    expect(nextGuestSlot([0, -4, 1.5, 2])).toBe(3);
  });
});

describe("buildInvitationRecord", () => {
  it("omits every phone attribute when no number is known", () => {
    const record = buildInvitationRecord({ invitationCode: "SW2748", householdName: "Casa Silva" });

    expect(record).toEqual({
      PK: "INVITATION#SW2748",
      SK: "INVITATION",
      entityType: "Invitation",
      invitationCode: "SW2748",
      householdName: "Casa Silva"
    });
    expect("phoneNumber" in record).toBe(false);
    expect("phoneNumberSource" in record).toBe(false);
  });

  it("records the operator source and timestamp when the admin path supplies them", () => {
    expect(
      buildInvitationRecord({
        invitationCode: "SW2748",
        householdName: "Casa Silva",
        phoneNumber: "5511999998888",
        phoneNumberSource: "operator",
        phoneNumberUpdatedAt: "2026-08-20T12:00:00.000Z"
      })
    ).toMatchObject({
      phoneNumber: "5511999998888",
      phoneNumberSource: "operator",
      phoneNumberUpdatedAt: "2026-08-20T12:00:00.000Z"
    });
  });
});

describe("buildInvitationGuestRecord", () => {
  it("seeds a new guest as pending with no plus-ones", () => {
    expect(buildInvitationGuestRecord("SW2748", { guestName: "Amanda", slot: 1 })).toEqual({
      PK: "INVITATION#SW2748",
      SK: "GUEST#SW2748--guest-01",
      entityType: "InvitationGuest",
      invitationCode: "SW2748",
      guestId: "SW2748--guest-01",
      guestName: "Amanda",
      sortOrder: 1,
      allowedPlusOnes: 0,
      rsvpStatus: "pending",
      isChild: false
    });
  });
});

describe("buildInvitationItems", () => {
  it("returns the invitation first and never seeds an RSVP item", () => {
    const items = buildInvitationItems({
      invitationCode: "SW2748",
      householdName: "Casa Silva",
      guests: [
        { guestName: "Amanda", slot: 1 },
        { guestName: "Bruno", slot: 2, isChild: true }
      ]
    });

    expect(items).toHaveLength(3);
    expect(items[0]!.entityType).toBe("Invitation");
    expect(items.slice(1).map((item) => item.SK)).toEqual([
      "GUEST#SW2748--guest-01",
      "GUEST#SW2748--guest-02"
    ]);
    expect(items.some((item) => item.SK === "RSVP#CURRENT")).toBe(false);
  });
});
