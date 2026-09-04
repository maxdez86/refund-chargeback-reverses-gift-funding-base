import { guestKeys, invitationKeys } from "../services/dynamodb/key-builder";

/** One guest as an operator or an import file supplies them, before the item is built. */
export type NewInvitationGuestInput = {
  guestName: string;
  slot: number;
  isChild?: boolean;
};

export type InvitationRecord = {
  PK: string;
  SK: string;
  entityType: "Invitation";
  invitationCode: string;
  householdName: string;
  phoneNumber?: string;
  phoneNumberSource?: "operator";
  phoneNumberUpdatedAt?: string;
};

export type InvitationGuestRecord = {
  PK: string;
  SK: string;
  entityType: "InvitationGuest";
  invitationCode: string;
  guestId: string;
  guestName: string;
  sortOrder: number;
  allowedPlusOnes: 0;
  rsvpStatus: "pending";
  isChild: boolean;
};

export type NewInvitationInput = {
  invitationCode: string;
  householdName: string;
  phoneNumber?: string;
  phoneNumberSource?: "operator";
  phoneNumberUpdatedAt?: string;
  guests: readonly NewInvitationGuestInput[];
};

/**
 * The guest-id convention for the whole table: the invitation code, then the guest's slot padded to
 * two digits. The padding is what keeps `GUEST#<id>` sort keys in slot order past nine, so it is a
 * storage guarantee rather than cosmetics.
 */
export function buildGuestId(invitationCode: string, slot: number): string {
  return `${invitationCode}--guest-${String(slot).padStart(2, "0")}`;
}

/**
 * The next slot for a guest joining an existing invitation.
 *
 * Deliberately `max + 1` rather than `length + 1` or the lowest free gap: `buildGuestId` derives the
 * id from the slot, so reusing the gap a removed guest left would resurrect that guest's id and
 * could collide with a `guestResponses` entry still keyed by it. Rows missing `sortOrder` are
 * ignored rather than coerced, so a legacy item can never produce `NaN`.
 */
export function nextGuestSlot(existingSortOrders: readonly (number | undefined)[]): number {
  const highest = existingSortOrders.reduce<number>((max, value) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return max;
    return value > max ? value : max;
  }, 0);

  return highest + 1;
}

/**
 * The stored `Invitation` item.
 *
 * The three phone attributes are spread only when supplied, so the offline import path — which
 * knows a number but not a source — writes exactly the item it wrote before this builder existed.
 */
export function buildInvitationRecord(input: Omit<NewInvitationInput, "guests">): InvitationRecord {
  return {
    ...invitationKeys(input.invitationCode),
    entityType: "Invitation",
    invitationCode: input.invitationCode,
    householdName: input.householdName,
    ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
    ...(input.phoneNumberSource ? { phoneNumberSource: input.phoneNumberSource } : {}),
    ...(input.phoneNumberUpdatedAt ? { phoneNumberUpdatedAt: input.phoneNumberUpdatedAt } : {})
  };
}

/** One stored `InvitationGuest` item. A new guest always starts pending with no plus-ones. */
export function buildInvitationGuestRecord(
  invitationCode: string,
  guest: NewInvitationGuestInput
): InvitationGuestRecord {
  const guestId = buildGuestId(invitationCode, guest.slot);

  return {
    ...guestKeys(invitationCode, guestId),
    entityType: "InvitationGuest",
    invitationCode,
    guestId,
    guestName: guest.guestName,
    sortOrder: guest.slot,
    allowedPlusOnes: 0,
    rsvpStatus: "pending",
    isChild: guest.isChild ?? false
  };
}

/**
 * Every item one new invitation owns, invitation first.
 *
 * No `RSVP#CURRENT` item is seeded: the RSVP row is created by the first answer, or by the admin
 * edit path's unconditional update, and an empty one would claim the household had been asked.
 */
export function buildInvitationItems(
  invitation: NewInvitationInput
): [InvitationRecord, ...InvitationGuestRecord[]] {
  return [
    buildInvitationRecord(invitation),
    ...invitation.guests.map((guest) => buildInvitationGuestRecord(invitation.invitationCode, guest))
  ];
}
