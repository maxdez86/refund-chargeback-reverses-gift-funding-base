import { DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import {
  PRODUCTION_INVITATIONS,
  seedInvitations,
  validateSeedInvitations
} from "../../../scripts/seed-dev";

describe("seed-dev", () => {
  it("uses only the production rows with guest names", () => {
    expect(PRODUCTION_INVITATIONS).toHaveLength(88);
    expect(PRODUCTION_INVITATIONS.every((invitation) => invitation.guests.length > 0)).toBe(true);
  });

  it("rejects duplicate or invalid invitation codes", () => {
    expect(() =>
      validateSeedInvitations([
        {
          invitationCode: "BAD111",
          householdName: "Teste",
          guests: [{ guestName: "Pessoa", slot: 1 }]
        }
      ])
    ).toThrow(/Invalid invitation code/);

    expect(() =>
      validateSeedInvitations([
        {
          invitationCode: "AB2345",
          householdName: "Teste A",
          guests: [{ guestName: "Pessoa A", slot: 1 }]
        },
        {
          invitationCode: "AB2345",
          householdName: "Teste B",
          guests: [{ guestName: "Pessoa B", slot: 1 }]
        }
      ])
    ).toThrow(/Duplicate invitation code/);
  });

  it("deletes the existing invitation partition before writing the new invitation and guests", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Items: [
          { PK: "INVITATION#AB2345", SK: "INVITATION" },
          { PK: "INVITATION#AB2345", SK: "RSVP#CURRENT" }
        ]
      })
      .mockResolvedValue({});
    const client = { send } as never;

    await seedInvitations(
      client,
      [
        {
          invitationCode: "AB2345",
          householdName: "Amanda e Chris",
          guests: [
            { guestName: "Amanda", slot: 1, isChild: true },
            { guestName: "Chris", slot: 2 }
          ]
        }
      ],
      "table-test"
    );

    expect(send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[1][0]).toBeInstanceOf(DeleteCommand);
    expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteCommand);
    expect(send.mock.calls[3][0]).toBeInstanceOf(PutCommand);
    expect(send.mock.calls[4][0]).toBeInstanceOf(PutCommand);
    expect(send.mock.calls[5][0]).toBeInstanceOf(PutCommand);

    const invitationPut = send.mock.calls[3][0] as PutCommand;
    expect(invitationPut.input.Item).toEqual(
      expect.objectContaining({
        PK: "INVITATION#AB2345",
        SK: "INVITATION",
        entityType: "Invitation",
        invitationCode: "AB2345",
        householdName: "Amanda e Chris"
      })
    );

    const guestPut = send.mock.calls[4][0] as PutCommand;
    expect(guestPut.input.Item).toEqual(
      expect.objectContaining({
        PK: "INVITATION#AB2345",
        SK: "GUEST#AB2345--guest-01",
        entityType: "InvitationGuest",
        guestId: "AB2345--guest-01",
        guestName: "Amanda",
        sortOrder: 1,
        rsvpStatus: "pending",
        isChild: true
      })
    );

    const adultGuestPut = send.mock.calls[5][0] as PutCommand;
    expect(adultGuestPut.input.Item).toEqual(
      expect.objectContaining({
        guestId: "AB2345--guest-02",
        guestName: "Chris",
        isChild: false
      })
    );
  });
});
