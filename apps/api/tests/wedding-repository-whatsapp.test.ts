import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { toHouseholdInvitation, toWhatsappRsvpStatus } from "../src/services/dynamodb/mappers";
import { WeddingRepository } from "../src/services/dynamodb/repositories/wedding-repository";

const WAMID = "wamid.HBgNNTUxMTk2MzY1NjUxNxUCABIYFjNBMEE3RjhCQzc5RDk4RkY4QjNBMQA=";
const NOW = "2026-08-17T12:00:00.000Z";

function conditionalFailure() {
  return new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} });
}

function repositoryWith(send: ReturnType<typeof vi.fn>) {
  return new WeddingRepository({ send } as never, "table-test");
}

const commandInput = {
  commandId: "cmd-1",
  invitationCode: "SW2748",
  templateId: "wedding_rsvp_reconfirmation",
  templateVersion: 3,
  stage: "reconfirmation",
  status: "queued",
  createdAt: NOW
} as const;

const messageInput = {
  messageId: WAMID,
  invitationCode: "SW2748",
  direction: "outbound",
  status: "sent",
  createdAt: NOW
} as const;

const storedMessage = {
  ...messageInput,
  PK: `WHATSAPP_MESSAGE#${WAMID}`,
  SK: "MESSAGE",
  entityType: "WhatsappMessage"
};

describe("WeddingRepository WhatsApp invitation phone", () => {
  it("updates only invitation phone attributes with an existence guard", async () => {
    const commands: UpdateCommand[] = [];
    const client = {
      send: async (command: UpdateCommand) => {
        commands.push(command);
        return {};
      }
    };
    const testRepository = new WeddingRepository(client as never, "table-test");

    await testRepository.updateInvitationWhatsappPhone("SW2748", "5511963656517");

    expect(commands).toHaveLength(1);
    expect(commands[0].input.Key).toEqual({ PK: "INVITATION#SW2748", SK: "INVITATION" });
    expect(commands[0].input.UpdateExpression).toBe(
      "SET phoneNumber = :phone, phoneNumberUpdatedAt = :updatedAt, phoneNumberSource = :source"
    );
    expect(commands[0].input.ConditionExpression).toBe("attribute_exists(PK)");
    expect(commands[0].input.ExpressionAttributeValues).toEqual({
      ":phone": "5511963656517",
      ":updatedAt": expect.any(String),
      ":source": "operator"
    });
    expect(JSON.stringify(commands[0].input)).not.toContain("GSI1PK");
    expect(JSON.stringify(commands[0].input)).not.toContain("GSI1SK");
  });

  it("maps a missing invitation to a 404 AppError", async () => {
    const client = {
      send: async () => {
        throw new ConditionalCheckFailedException({ message: "The conditional request failed" });
      }
    };
    const repository = new WeddingRepository(client as never, "table-test");

    await expect(repository.updateInvitationWhatsappPhone("MISSING1", "5511963656517")).rejects.toMatchObject({
      name: "AppError",
      statusCode: 404,
      message: "Invitation not found."
    });
  });

  it("maps operator status metadata without adding it to guest invitations", () => {
    const invitation = {
      invitationCode: "SW2748",
      householdName: "Eugênia Ribeiro",
      phoneNumber: "5511963656517",
      phoneNumberUpdatedAt: "2026-08-17T12:00:00.000Z",
      phoneNumberSource: "operator",
      whatsappFlowStatus: "idle"
    };

    expect(toWhatsappRsvpStatus(invitation)).toEqual({
      invitationCode: "SW2748",
      phoneNumber: "5511963656517",
      phoneNumberUpdatedAt: "2026-08-17T12:00:00.000Z",
      phoneNumberSource: "operator",
      status: "idle"
    });
    const guestInvitation = toHouseholdInvitation({ invitation, guests: [] });
    expect(guestInvitation).toEqual({
      invitationCode: "SW2748",
      householdName: "Eugênia Ribeiro",
      phoneNumber: "5511963656517",
      whatsappFlowStatus: "idle",
      whatsappFlowStage: undefined,
      guests: []
    });
    expect(guestInvitation).not.toHaveProperty("phoneNumberUpdatedAt");
    expect(guestInvitation).not.toHaveProperty("phoneNumberSource");
    expect(toHouseholdInvitation({ invitation: {}, guests: [] })).toEqual({
      invitationCode: "",
      householdName: "",
      phoneNumber: undefined,
      guests: []
    });
  });
});

describe("WeddingRepository WhatsApp command records", () => {
  it("creates a command conditionally, with keys the caller cannot override", async () => {
    const send = vi.fn().mockResolvedValue({});

    await repositoryWith(send).createWhatsappCommand({
      ...commandInput,
      // Hostile extras: the schema strips unknown keys and the key builder is spread last.
      PK: "ATTACKER#1",
      SK: "OWNED",
      entityType: "Invitation"
    } as never);

    const command = send.mock.calls[0][0] as PutCommand;
    expect(command.input.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(command.input.Item).toMatchObject({
      PK: "WHATSAPP_COMMAND#cmd-1",
      SK: "COMMAND",
      entityType: "WhatsappCommand",
      GSI1PK: "INVITATION#SW2748",
      GSI1SK: `WHATSAPP#${NOW}#COMMAND#cmd-1`,
      retryCount: 0,
      reconciliationStatus: "none"
    });
  });

  it("lets a duplicate commandId surface ConditionalCheckFailedException by name", async () => {
    // Step 08 detects a replayed Idempotency-Key by catching this error, so it must not be
    // swallowed or remapped here.
    const send = vi.fn().mockRejectedValue(conditionalFailure());

    await expect(repositoryWith(send).createWhatsappCommand(commandInput)).rejects.toMatchObject({
      name: "ConditionalCheckFailedException"
    });
  });

  it("reads a command consistently and parses it", async () => {
    const send = vi.fn().mockResolvedValue({
      Item: { ...commandInput, PK: "WHATSAPP_COMMAND#cmd-1", SK: "COMMAND", entityType: "WhatsappCommand", retryCount: 0, reconciliationStatus: "none" }
    });

    const result = await repositoryWith(send).getWhatsappCommand("cmd-1");

    const command = send.mock.calls[0][0] as GetCommand;
    expect(command.input.Key).toEqual({ PK: "WHATSAPP_COMMAND#cmd-1", SK: "COMMAND" });
    expect(command.input.ConsistentRead).toBe(true);
    expect(result?.templateId).toBe("wedding_rsvp_reconfirmation");
  });

  it("returns undefined for a missing command", async () => {
    const send = vi.fn().mockResolvedValue({});
    await expect(repositoryWith(send).getWhatsappCommand("nope")).resolves.toBeUndefined();
  });

  it("raises a named error instead of returning a malformed stored command", async () => {
    // A record missing invitationCode used to flow on as the string "undefined" and silently
    // become a lookup miss.
    const send = vi.fn().mockResolvedValue({
      Item: { PK: "WHATSAPP_COMMAND#cmd-1", SK: "COMMAND", entityType: "WhatsappCommand", commandId: "cmd-1" }
    });

    await expect(repositoryWith(send).getWhatsappCommand("cmd-1")).rejects.toMatchObject({
      name: "WhatsappItemCorruptError",
      statusCode: 500
    });
  });

  it("builds a dynamic SET update and skips undefined values", async () => {
    const send = vi.fn().mockResolvedValue({});

    await repositoryWith(send).updateWhatsappCommand("cmd-1", {
      status: "sent",
      sentAt: NOW,
      failureReason: undefined
    });

    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(command.input.Key).toEqual({ PK: "WHATSAPP_COMMAND#cmd-1", SK: "COMMAND" });
    expect(command.input.UpdateExpression).toBe("SET #n0 = :v0, #n1 = :v1");
    expect(command.input.ExpressionAttributeNames).toEqual({ "#n0": "status", "#n1": "sentAt" });
    expect(command.input.ExpressionAttributeValues).toEqual({ ":v0": "sent", ":v1": NOW });
  });

  it("sends nothing when every command value is undefined", async () => {
    const send = vi.fn().mockResolvedValue({});
    await repositoryWith(send).updateWhatsappCommand("cmd-1", { status: undefined });
    expect(send).not.toHaveBeenCalled();
  });

  it("claims a command with a conditional status guard", async () => {
    const send = vi.fn().mockResolvedValue({});
    await repositoryWith(send).updateWhatsappCommand(
      "cmd-1",
      { status: "sending", startedAt: NOW },
      {
        expression: "#c0 = :c0",
        names: { "#c0": "status" },
        values: { ":c0": "queued" }
      }
    );
    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(command.input.ConditionExpression).toBe("#c0 = :c0");
    expect(command.input.ExpressionAttributeValues).toMatchObject({ ":c0": "queued" });
  });

  it("atomically claims and reclaims a worker command with attempt metadata", async () => {
    const send = vi.fn().mockResolvedValue({});
    await repositoryWith(send).claimWhatsappCommand("cmd-1", {
      now: NOW,
      receiveCount: 2,
      reclaimBefore: "2026-08-17T11:57:30.000Z"
    });

    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(command.input.UpdateExpression).toContain("#retryCount = if_not_exists(#retryCount, :zero) + :one");
    expect(command.input.ConditionExpression).toContain("#status = :sending");
    expect(command.input.ConditionExpression).toContain("#startedAt < :reclaimBefore");
    expect(command.input.ExpressionAttributeNames).toMatchObject({
      "#status": "status",
      "#lastAttemptAt": "lastAttemptAt",
      "#lastAttemptReceiveCount": "lastAttemptReceiveCount"
    });
    expect(command.input.ExpressionAttributeValues).toMatchObject({
      ":receiveCount": 2,
      ":reclaimBefore": "2026-08-17T11:57:30.000Z",
      ":maxAttempts": 5
    });
  });
});

describe("WeddingRepository WhatsApp message records", () => {
  it("writes a message conditionally with the conversation index attached", async () => {
    const send = vi.fn().mockResolvedValue({});

    const result = await repositoryWith(send).putWhatsappMessage({
      ...messageInput,
      PK: "ATTACKER#1",
      entityType: "Invitation"
    } as never);

    const command = send.mock.calls[0][0] as PutCommand;
    expect(result).toEqual({ created: true });
    expect(command.input.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(command.input.Item).toMatchObject({
      PK: `WHATSAPP_MESSAGE#${WAMID}`,
      SK: "MESSAGE",
      entityType: "WhatsappMessage",
      GSI1PK: "INVITATION#SW2748",
      GSI1SK: `WHATSAPP#${NOW}#MESSAGE#${WAMID}`
    });
  });

  it("reports a replayed wamid as a duplicate instead of overwriting", async () => {
    const send = vi.fn().mockRejectedValue(conditionalFailure());

    await expect(repositoryWith(send).putWhatsappMessage(messageInput)).resolves.toEqual({
      created: false
    });
  });

  it("guards a status update so it cannot conjure a phantom message record", async () => {
    // An unguarded UpdateItem on a missing key CREATES the item. A status webhook that outruns
    // the send would leave a stub holding only the status, which then blocks the real
    // conditional put of the message record.
    const send = vi.fn().mockResolvedValue({});

    const result = await repositoryWith(send).updateWhatsappMessage(WAMID, {
      status: "delivered",
      statusUpdatedAt: NOW
    });

    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(result).toEqual({ applied: true });
    expect(command.input.ConditionExpression).toBe("attribute_exists(PK)");
    expect(command.input.Key).toEqual({ PK: `WHATSAPP_MESSAGE#${WAMID}`, SK: "MESSAGE" });
    expect(command.input.UpdateExpression).toBe("SET #n0 = :v0, #n1 = :v1");
  });

  it("reports a status update for an unknown message as not applied", async () => {
    const send = vi.fn().mockRejectedValue(conditionalFailure());

    await expect(
      repositoryWith(send).updateWhatsappMessage(WAMID, { status: "delivered" })
    ).resolves.toEqual({ applied: false });
  });

  it("sends nothing when every message value is undefined", async () => {
    const send = vi.fn().mockResolvedValue({});

    const result = await repositoryWith(send).updateWhatsappMessage(WAMID, { status: undefined });

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ applied: false });
  });

  it("reads a message consistently and returns undefined for a miss", async () => {
    const hit = vi.fn().mockResolvedValue({ Item: storedMessage });
    const result = await repositoryWith(hit).getWhatsappMessage(WAMID);
    const command = hit.mock.calls[0][0] as GetCommand;
    expect(command.input.ConsistentRead).toBe(true);
    expect(result?.invitationCode).toBe("SW2748");

    const miss = vi.fn().mockResolvedValue({});
    await expect(repositoryWith(miss).getWhatsappMessage(WAMID)).resolves.toBeUndefined();
  });
});

describe("WeddingRepository WhatsApp flow updates", () => {
  it("guards the invitation update with attribute_exists(PK)", async () => {
    const send = vi.fn().mockResolvedValue({});

    await repositoryWith(send).updateWhatsappFlow("SW2748", {
      whatsappFlowStatus: "message_sent",
      whatsappFlowUpdatedAt: NOW
    });

    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(command.input.Key).toEqual({ PK: "INVITATION#SW2748", SK: "INVITATION" });
    expect(command.input.ConditionExpression).toBe("attribute_exists(PK)");
    expect(command.input.UpdateExpression).toBe("SET #n0 = :v0, #n1 = :v1");
    // The flow write must never touch the guest phone lookup entry.
    expect(JSON.stringify(command.input)).not.toContain("GSI1PK");
  });

  it("ANDs a caller condition onto the existence guard without placeholder collisions", async () => {
    const send = vi.fn().mockResolvedValue({});

    await repositoryWith(send).updateWhatsappFlow(
      "SW2748",
      { whatsappFlowStatus: "response_received" },
      {
        expression: "#c0 <> :c0",
        names: { "#c0": "whatsappFlowStatus" },
        values: { ":c0": "completed" }
      }
    );

    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(command.input.ConditionExpression).toBe("attribute_exists(PK) AND (#c0 <> :c0)");
    expect(command.input.ExpressionAttributeNames).toEqual({
      "#n0": "whatsappFlowStatus",
      "#c0": "whatsappFlowStatus"
    });
    expect(command.input.ExpressionAttributeValues).toEqual({
      ":v0": "response_received",
      ":c0": "completed"
    });
  });

  it("sends nothing when every flow value is undefined", async () => {
    const send = vi.fn().mockResolvedValue({});
    await repositoryWith(send).updateWhatsappFlow("SW2748", { whatsappFlowStatus: undefined });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("WeddingRepository WhatsApp conversation listing", () => {
  it("queries gsi1 for the invitation timeline and parses both record kinds", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        {
          ...commandInput,
          PK: "WHATSAPP_COMMAND#cmd-1",
          SK: "COMMAND",
          entityType: "WhatsappCommand",
          retryCount: 0,
          reconciliationStatus: "none"
        },
        storedMessage
      ],
      LastEvaluatedKey: { PK: "WHATSAPP_MESSAGE#x", SK: "MESSAGE" }
    });

    const result = await repositoryWith(send).listWhatsappConversation("SW2748", { limit: 25 });

    const command = send.mock.calls[0][0] as QueryCommand;
    expect(command.input.IndexName).toBe("gsi1");
    expect(command.input.KeyConditionExpression).toBe(
      "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)"
    );
    expect(command.input.ExpressionAttributeValues).toEqual({
      ":gsi1pk": "INVITATION#SW2748",
      ":prefix": "WHATSAPP#"
    });
    expect(command.input.Limit).toBe(25);
    expect(result.entries.map((entry) => entry.entityType)).toEqual([
      "WhatsappCommand",
      "WhatsappMessage"
    ]);
    expect(result.nextCursor).toBeTypeOf("string");
  });

  it("round-trips the pagination cursor", async () => {
    const lastKey = { PK: "WHATSAPP_MESSAGE#x", SK: "MESSAGE" };
    const first = vi.fn().mockResolvedValue({ Items: [], LastEvaluatedKey: lastKey });
    const { nextCursor } = await repositoryWith(first).listWhatsappConversation("SW2748");

    const second = vi.fn().mockResolvedValue({ Items: [] });
    await repositoryWith(second).listWhatsappConversation("SW2748", { cursor: nextCursor });

    expect((second.mock.calls[0][0] as QueryCommand).input.ExclusiveStartKey).toEqual(lastKey);
  });

  it("rejects a malformed cursor with a 400", async () => {
    const send = vi.fn().mockResolvedValue({ Items: [] });

    await expect(
      repositoryWith(send).listWhatsappConversation("SW2748", { cursor: "!!!not-base64-json" })
    ).rejects.toMatchObject({ name: "AppError", statusCode: 400 });
  });
});
