import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import {
  buildImportTransaction,
  importNewInvitations,
  validateNewInvitations
} from "../../../scripts/lib/import-new-invitations";

const invitation = {
  invitationCode: "JQ9472",
  householdName: "Cristiane Lima e Aristides Cruz",
  guests: [
    { guestName: "Cristiane Lima", slot: 1 },
    { guestName: "Aristides Cruz", slot: 2 }
  ]
};

describe("import-new-invitations", () => {
  it("validates duplicate and invalid invitation data before DynamoDB writes", () => {
    expect(() =>
      validateNewInvitations([
        {
          invitationCode: "BAD111",
          householdName: "Teste",
          guests: [{ guestName: "Pessoa", slot: 1 }]
        }
      ])
    ).toThrow(/Invalid invitation code/);

    expect(() => validateNewInvitations([invitation, invitation])).toThrow(/Duplicate invitation code/);

    expect(() =>
      validateNewInvitations([
        {
          invitationCode: "AB2345",
          householdName: "Teste",
          guests: [{ guestName: " ", slot: 1 }]
        }
      ])
    ).toThrow(/blank guest name/);

    expect(() =>
      validateNewInvitations([
        {
          invitationCode: "CD6789",
          householdName: "Teste",
          guests: [
            { guestName: "Pessoa A", slot: 1 },
            { guestName: "Pessoa B", slot: 1 }
          ]
        }
      ])
    ).toThrow(/duplicate guest slot/);
  });

  it("builds a conditional transaction for the invitation and guest rows", () => {
    const transaction = buildImportTransaction("table-test", invitation);

    expect(transaction.TransactItems).toHaveLength(3);
    expect(transaction.TransactItems?.every((item) => item.Put?.TableName === "table-test")).toBe(true);
    expect(
      transaction.TransactItems?.every(
        (item) =>
          item.Put?.ConditionExpression === "attribute_not_exists(PK) AND attribute_not_exists(SK)"
      )
    ).toBe(true);

    expect(transaction.TransactItems?.[0]?.Put?.Item).toEqual(
      expect.objectContaining({
        PK: "INVITATION#JQ9472",
        SK: "INVITATION",
        entityType: "Invitation",
        invitationCode: "JQ9472",
        householdName: "Cristiane Lima e Aristides Cruz"
      })
    );
    expect(transaction.TransactItems?.[1]?.Put?.Item).toEqual(
      expect.objectContaining({
        PK: "INVITATION#JQ9472",
        SK: "GUEST#JQ9472--guest-01",
        guestId: "JQ9472--guest-01",
        guestName: "Cristiane Lima",
        sortOrder: 1,
        allowedPlusOnes: 0,
        rsvpStatus: "pending",
        isChild: false
      })
    );
    expect(transaction.TransactItems?.[2]?.Put?.Item).toEqual(
      expect.objectContaining({
        SK: "GUEST#JQ9472--guest-02",
        guestId: "JQ9472--guest-02",
        guestName: "Aristides Cruz",
        sortOrder: 2
      })
    );
  });

  it("dry-runs without sending a transaction", async () => {
    const send = vi.fn().mockResolvedValue({ Item: undefined });
    const logger = { log: vi.fn() };

    const result = await importNewInvitations(
      { send } as never,
      [invitation],
      "table-test",
      { mode: "dry-run", logger }
    );

    expect(result).toEqual({ inserted: 0, wouldInsert: 1, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(logger.log).toHaveBeenCalledWith("would insert JQ9472: 3 rows");
  });

  it("skips an existing invitation without writing guests", async () => {
    const send = vi.fn().mockResolvedValue({
      Item: {
        PK: "INVITATION#JQ9472",
        SK: "INVITATION"
      }
    });
    const logger = { log: vi.fn() };

    const result = await importNewInvitations(
      { send } as never,
      [invitation],
      "table-test",
      { mode: "apply", logger }
    );

    expect(result).toEqual({ inserted: 0, wouldInsert: 0, skipped: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(logger.log).toHaveBeenCalledWith("skipped JQ9472: invitation already exists");
  });

  it("applies a new invitation with one transaction", async () => {
    const send = vi.fn().mockResolvedValueOnce({ Item: undefined }).mockResolvedValueOnce({});

    const result = await importNewInvitations(
      { send } as never,
      [invitation],
      "table-test",
      { mode: "apply", logger: { log: vi.fn() } }
    );

    expect(result).toEqual({ inserted: 1, wouldInsert: 0, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[1][0]).toBeInstanceOf(TransactWriteCommand);
  });
});
