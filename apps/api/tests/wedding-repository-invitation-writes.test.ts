import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  QueryCommand,
  TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WeddingRepository } from "../src/services/dynamodb/repositories/wedding-repository";

const cancellation = () =>
  new TransactionCanceledException({
    $metadata: {},
    message: "cancelled",
    CancellationReasons: [{ Code: "ConditionalCheckFailed" }]
  });

const repositoryWith = (send: ReturnType<typeof vi.fn>) =>
  new WeddingRepository({ send } as never, "table-test");

/** Every command the double received, in the order it was sent. */
const sent = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map(([command]) => command);

beforeEach(() => {
  process.env.WEDDING_TABLE_NAME = "brimax-wedding-test";
});

describe("createInvitation", () => {
  const input = {
    invitationCode: "AB2345",
    householdName: "Amanda e Chris",
    guests: [
      { guestName: "Amanda", slot: 1 },
      { guestName: "Chris", slot: 2 }
    ],
    phoneNumber: "5511999998888",
    phoneNumberUpdatedAt: "2026-08-20T12:00:00.000Z"
  };

  it("writes the invitation, its guests and the phone lookup in one transaction", async () => {
    const send = vi.fn().mockResolvedValue({});

    const result = await repositoryWith(send).createInvitation(input);

    expect(send).toHaveBeenCalledTimes(1);
    const command = sent(send)[0] as TransactWriteCommand;
    expect(command).toBeInstanceOf(TransactWriteCommand);
    const items = command.input.TransactItems!;
    expect(items).toHaveLength(4);
    expect(items[0]!.Put!.Item).toMatchObject({
      SK: "INVITATION",
      phoneNumberSource: "operator",
      phoneNumberUpdatedAt: "2026-08-20T12:00:00.000Z"
    });
    // The invitation and guest puts carry the uniqueness guard; the lookup deliberately does not,
    // because a re-used phone number is normal and must not fail the whole creation.
    expect(items.slice(0, 3).map((item) => item.Put!.ConditionExpression)).toEqual([
      "attribute_not_exists(PK)",
      "attribute_not_exists(PK)",
      "attribute_not_exists(PK)"
    ]);
    expect(items[3]!.Put!.Item).toMatchObject({
      PK: "WHATSAPP_PHONE#5511999998888",
      SK: "INVITATION#AB2345",
      entityType: "WhatsappInvitationPhoneLookup"
    });
    expect(items[3]!.Put!.ConditionExpression).toBeUndefined();
    expect(result.guests.map((guest) => guest.guestId)).toEqual([
      "AB2345--guest-01",
      "AB2345--guest-02"
    ]);
  });

  it("writes no lookup item when the invitation has no phone number", async () => {
    const send = vi.fn().mockResolvedValue({});

    await repositoryWith(send).createInvitation({
      invitationCode: "AB2345",
      householdName: "Amanda e Chris",
      guests: [{ guestName: "Amanda", slot: 1 }]
    });

    const items = (sent(send)[0] as TransactWriteCommand).input.TransactItems!;
    expect(items).toHaveLength(2);
    expect(items.some((item) => String(item.Put!.Item!.PK).startsWith("WHATSAPP_PHONE#"))).toBe(false);
  });

  it("turns a lost uniqueness race into a 409", async () => {
    const send = vi.fn().mockRejectedValue(cancellation());

    await expect(repositoryWith(send).createInvitation(input)).rejects.toMatchObject({
      statusCode: 409,
      message: "Invitation code already in use."
    });
  });

  it("rethrows a failure that is not a conditional check", async () => {
    const send = vi.fn().mockRejectedValue(new Error("throttled"));

    await expect(repositoryWith(send).createInvitation(input)).rejects.toThrow("throttled");
  });
});

describe("listInvitationCodes", () => {
  it("scans all pages and returns only invitation codes", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({
        Items: [
          { entityType: "Invitation", invitationCode: "AB2345" },
          { entityType: "InvitationGuest", invitationCode: "CD2345" }
        ],
        LastEvaluatedKey: { PK: "cursor" }
      })
      .mockResolvedValueOnce({ Items: [{ entityType: "Invitation", invitationCode: "EF2345" }] });

    await expect(repositoryWith(send).listInvitationCodes()).resolves.toEqual(["AB2345", "EF2345"]);
    expect(send).toHaveBeenCalledTimes(2);
    expect((sent(send)[0] as ScanCommand).input).toMatchObject({
      ConsistentRead: true,
      FilterExpression: "entityType = :invitationType",
      ProjectionExpression: "entityType, invitationCode"
    });
  });
});

describe("deleteInvitationCascade", () => {
  const partition = [
    { PK: "INVITATION#AB2345", SK: "INVITATION", entityType: "Invitation", phoneNumber: "5511999998888" },
    { PK: "INVITATION#AB2345", SK: "GUEST#AB2345--guest-01", entityType: "InvitationGuest" },
    { PK: "INVITATION#AB2345", SK: "GUEST#AB2345--guest-02", entityType: "InvitationGuest" },
    { PK: "INVITATION#AB2345", SK: "RSVP#CURRENT", entityType: "RsvpResponse" }
  ];
  const conversation = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      PK: `WHATSAPP_MESSAGE#msg-${index}`,
      SK: "MESSAGE"
    }));

  /** A send double that answers the two queries in order, then accepts every write. */
  const cascadeSend = (options: { partition?: unknown[]; conversationPages?: unknown[][] } = {}) => {
    const pages = options.conversationPages ?? [[]];
    let queryCount = 0;
    return vi.fn().mockImplementation(async (command: unknown) => {
      if (command instanceof QueryCommand) {
        queryCount += 1;
        if (queryCount === 1) return { Items: options.partition ?? partition };
        const page = pages[queryCount - 2] ?? [];
        const hasMore = queryCount - 1 < pages.length;
        return { Items: page, ...(hasMore ? { LastEvaluatedKey: { PK: "cursor" } } : {}) };
      }
      return {};
    });
  };

  it("404s before issuing a single delete when the invitation is gone", async () => {
    const send = cascadeSend({ partition: [] });

    await expect(repositoryWith(send).deleteInvitationCascade("AB2345")).rejects.toMatchObject({
      statusCode: 404
    });
    expect(sent(send).some((command) => !(command instanceof QueryCommand))).toBe(false);
  });

  it("reads the partition consistently and pages the conversation index by base-table key", async () => {
    const send = cascadeSend({ conversationPages: [conversation(2), conversation(1)] });

    const result = await repositoryWith(send).deleteInvitationCascade("AB2345");

    const queries = sent(send).filter((command): command is QueryCommand => command instanceof QueryCommand);
    expect(queries[0]!.input).toMatchObject({
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": "INVITATION#AB2345" },
      ConsistentRead: true
    });
    expect(queries[1]!.input).toMatchObject({
      IndexName: "gsi1",
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: { ":pk": "INVITATION#AB2345", ":prefix": "WHATSAPP#" },
      ProjectionExpression: "PK, SK"
    });
    // The second page is fetched from the cursor the first one returned.
    expect(queries[2]!.input.ExclusiveStartKey).toEqual({ PK: "cursor" });
    expect(result).toEqual({ guests: 2, rsvp: 1, whatsappItems: 3, phoneLookups: 1 });
  });

  it("deletes the invitation item last, so a partial failure stays recoverable", async () => {
    const send = cascadeSend({ conversationPages: [conversation(3)] });

    await repositoryWith(send).deleteInvitationCascade("AB2345");

    const writes = sent(send).filter((command) => !(command instanceof QueryCommand));
    const batches = writes.filter((command) => command instanceof BatchWriteCommand);
    const deletes = writes.filter((command): command is DeleteCommand => command instanceof DeleteCommand);

    // The anchor the cascade is discovered from goes last, and only it is conditional.
    const last = writes.at(-1) as DeleteCommand;
    expect(last.input.Key).toEqual({ PK: "INVITATION#AB2345", SK: "INVITATION" });
    expect(last.input.ConditionExpression).toBe("attribute_exists(PK)");

    // Phone lookup before the RSVP, and both after the conversation batch.
    expect(deletes[0]!.input.Key).toEqual({
      PK: "WHATSAPP_PHONE#5511999998888",
      SK: "INVITATION#AB2345"
    });
    expect(deletes[1]!.input.Key).toEqual({ PK: "INVITATION#AB2345", SK: "RSVP#CURRENT" });
    expect(writes.indexOf(batches[0]!)).toBeLessThan(writes.indexOf(deletes[0]!));
    // Guest rows are batched after the lookup and the RSVP, and before the invitation.
    expect(writes.indexOf(batches[1]!)).toBeGreaterThan(writes.indexOf(deletes[1]!));
    expect(writes.indexOf(batches[1]!)).toBeLessThan(writes.length - 1);
  });

  it("chunks conversation deletes into batches of twenty-five", async () => {
    const send = cascadeSend({ conversationPages: [conversation(60)] });

    await repositoryWith(send).deleteInvitationCascade("AB2345");

    const conversationBatches = sent(send)
      .filter((command): command is BatchWriteCommand => command instanceof BatchWriteCommand)
      .filter((command) =>
        (command.input.RequestItems!["table-test"] ?? []).some((request) =>
          String(request.DeleteRequest!.Key!.PK).startsWith("WHATSAPP_MESSAGE#")
        )
      );

    expect(conversationBatches.map((command) => command.input.RequestItems!["table-test"]!.length)).toEqual([
      25, 25, 10
    ]);
  });

  it("retries what DynamoDB leaves unprocessed", async () => {
    const send = cascadeSend({ conversationPages: [conversation(2)] });
    let firstBatch = true;
    const wrapped = vi.fn().mockImplementation(async (command: unknown) => {
      if (command instanceof BatchWriteCommand && firstBatch) {
        firstBatch = false;
        return {
          UnprocessedItems: {
            "table-test": [{ DeleteRequest: { Key: { PK: "WHATSAPP_MESSAGE#msg-1", SK: "MESSAGE" } } }]
          }
        };
      }
      return send(command);
    });

    await repositoryWith(wrapped).deleteInvitationCascade("AB2345");

    const retried = wrapped.mock.calls
      .map(([command]) => command)
      .filter((command): command is BatchWriteCommand => command instanceof BatchWriteCommand);
    // Two calls for one chunk: the original, then the single item that came back unprocessed.
    expect(retried[1]!.input.RequestItems!["table-test"]).toHaveLength(1);
  });

  it("throws rather than silently dropping rows it never manages to delete", async () => {
    const send = vi.fn().mockImplementation(async (command: unknown) => {
      if (command instanceof QueryCommand) {
        return command.input.IndexName ? { Items: conversation(1) } : { Items: partition };
      }
      if (command instanceof BatchWriteCommand) {
        return {
          UnprocessedItems: {
            "table-test": [{ DeleteRequest: { Key: { PK: "WHATSAPP_MESSAGE#msg-0", SK: "MESSAGE" } } }]
          }
        };
      }
      return {};
    });

    await expect(repositoryWith(send).deleteInvitationCascade("AB2345")).rejects.toThrow(
      /after 5 batch attempts/
    );
  });

  it("skips the lookup delete for an invitation with no phone number", async () => {
    const send = cascadeSend({
      partition: [{ PK: "INVITATION#AB2345", SK: "INVITATION", entityType: "Invitation" }]
    });

    const result = await repositoryWith(send).deleteInvitationCascade("AB2345");

    expect(result).toEqual({ guests: 0, rsvp: 0, whatsappItems: 0, phoneLookups: 0 });
    const deletes = sent(send).filter((command): command is DeleteCommand => command instanceof DeleteCommand);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.input.Key).toEqual({ PK: "INVITATION#AB2345", SK: "INVITATION" });
  });
});

describe("addInvitationGuests", () => {
  const partition = [
    { PK: "INVITATION#AB2345", SK: "INVITATION", entityType: "Invitation" },
    { PK: "INVITATION#AB2345", SK: "GUEST#AB2345--guest-01", entityType: "InvitationGuest", sortOrder: 1 },
    { PK: "INVITATION#AB2345", SK: "GUEST#AB2345--guest-02", entityType: "InvitationGuest", sortOrder: 2 },
    { PK: "INVITATION#AB2345", SK: "GUEST#AB2345--guest-05", entityType: "InvitationGuest", sortOrder: 5 }
  ];

  const addSend = (items = partition) =>
    vi.fn().mockImplementation(async (command: unknown) =>
      command instanceof QueryCommand ? { Items: items } : {}
    );

  it("assigns slots above the highest one ever used and guards the invitation", async () => {
    const send = addSend();

    const guests = await repositoryWith(send).addInvitationGuests({
      invitationCode: "AB2345",
      guests: [{ guestName: "Duda" }, { guestName: "Eva", isChild: true }]
    });

    // Slots 3 and 4 are free but never reused: the id they would rebuild may still be referenced
    // by a stored RSVP answer.
    expect(guests.map((guest) => [guest.guestId, guest.sortOrder])).toEqual([
      ["AB2345--guest-06", 6],
      ["AB2345--guest-07", 7]
    ]);

    const items = (sent(send).at(-1) as TransactWriteCommand).input.TransactItems!;
    expect(items[0]!.ConditionCheck).toMatchObject({
      Key: { PK: "INVITATION#AB2345", SK: "INVITATION" },
      ConditionExpression: "attribute_exists(PK)"
    });
    expect(items.slice(1).map((item) => item.Put!.ConditionExpression)).toEqual([
      "attribute_not_exists(PK)",
      "attribute_not_exists(PK)"
    ]);
  });

  it("404s for an invitation that does not exist", async () => {
    const send = addSend([]);

    await expect(
      repositoryWith(send).addInvitationGuests({
        invitationCode: "AB2345",
        guests: [{ guestName: "Duda" }]
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("turns a lost race with a concurrent delete or add into a 409", async () => {
    const send = vi.fn().mockImplementation(async (command: unknown) => {
      if (command instanceof QueryCommand) return { Items: partition };
      throw cancellation();
    });

    await expect(
      repositoryWith(send).addInvitationGuests({
        invitationCode: "AB2345",
        guests: [{ guestName: "Duda" }]
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("removeInvitationGuest", () => {
  const input = {
    invitationCode: "AB2345",
    guestId: "AB2345--guest-01",
    guestResponses: [],
    status: "pending" as const,
    counts: {
      attendingGuestCount: 0,
      paidAttendingGuestCount: 0,
      childSixOrYoungerAttendingCount: 0
    },
    updatedAt: "2026-08-20T12:00:00.000Z",
    fallbackSubmittedBy: "AB2345--guest-02"
  };

  it("deletes the guest and rewrites the aggregate in one transaction", async () => {
    const send = vi.fn().mockResolvedValue({});

    await repositoryWith(send).removeInvitationGuest(input);

    expect(send).toHaveBeenCalledTimes(1);
    const items = (sent(send)[0] as TransactWriteCommand).input.TransactItems!;
    expect(items).toHaveLength(2);
    expect(items[0]!.Delete).toMatchObject({
      Key: { PK: "INVITATION#AB2345", SK: "GUEST#AB2345--guest-01" },
      ConditionExpression: "attribute_exists(PK)"
    });
    // The RSVP row is rewritten even with no answers left: the aggregate has to describe the
    // guests who remain.
    expect(items[1]!.Update!.Key).toEqual({ PK: "INVITATION#AB2345", SK: "RSVP#CURRENT" });
    expect(items[1]!.Update!.ExpressionAttributeValues![":guestResponses"]).toEqual([]);
  });

  it("shares the aggregate expression with the admin guest edit, character for character", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = repositoryWith(send);

    await repository.removeInvitationGuest(input);
    await repository.applyAdminGuestEdit(input);

    const removal = (sent(send)[0] as TransactWriteCommand).input.TransactItems![1]!.Update!;
    const edit = sent(send)[1] as { input: { UpdateExpression: string } };
    expect(removal.UpdateExpression).toBe(edit.input.UpdateExpression);
  });

  it("turns a missing guest item into a 404", async () => {
    const send = vi.fn().mockRejectedValue(cancellation());

    await expect(repositoryWith(send).removeInvitationGuest(input)).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it("maps a bare conditional check failure to a 404 as well", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(new ConditionalCheckFailedException({ $metadata: {}, message: "nope" }));

    await expect(repositoryWith(send).removeInvitationGuest(input)).rejects.toMatchObject({
      statusCode: 404
    });
  });
});
