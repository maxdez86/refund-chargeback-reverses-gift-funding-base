import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
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

const storedCommand = {
  ...commandInput,
  status: "sending",
  effect: "opener",
  retryCount: 1,
  reconciliationStatus: "none",
  PK: "WHATSAPP_COMMAND#cmd-1",
  SK: "COMMAND",
  entityType: "WhatsappCommand"
};

const invitationItem = {
  PK: "INVITATION#SW2748",
  SK: "INVITATION",
  entityType: "Invitation",
  invitationCode: "SW2748",
  householdName: "Household",
  whatsappFlowStatus: "message_sent",
  whatsappLastOutboundMessageId: WAMID
};

const websiteOperation = {
  websiteOperationId: "website-op-1",
  websitePayloadDigest: "a".repeat(64),
  websiteIdempotencyKeyDigest: "b".repeat(64)
} as const;

const websiteRequest = {
  invitationCode: "SW2748",
  submittedBy: "Household",
  guestResponses: [{ guestId: "g1", status: "attending", isChildSixOrYounger: false }],
  attendingGuestCount: 1
} as const;

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

describe("WeddingRepository WhatsApp RSVP reservations", () => {
  it("atomically reserves a branch and creates its follow-up command", async () => {
    const send = vi.fn().mockResolvedValue({});
    await repositoryWith(send).reserveWhatsappBranch({
      invitationCode: "SW2748",
      expectedStatus: "message_sent",
      status: "attendance_confirmed_whatsapp",
      lastInboundMessageId: "wamid.inbound-1",
      updatedAt: NOW,
      attendance: [{ guestId: "g1", status: "attending", recordedAt: NOW }],
      command: {
        commandId: "branch-cmd-1",
        invitationCode: "SW2748",
        templateId: "wedding_rsvp_attending_followup_single",
        templateVersion: 1,
        stage: "followup",
        status: "queued",
        effect: "complete_on_send",
        expectedFlowStatus: "attendance_confirmed_whatsapp",
        createdAt: NOW
      }
    });

    expect(send).toHaveBeenCalledOnce();
    const transaction = send.mock.calls[0][0] as TransactWriteCommand;
    const items = transaction.input.TransactItems ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.Update?.Key).toEqual({ PK: "INVITATION#SW2748", SK: "INVITATION" });
    expect(items[0]?.Update?.ConditionExpression).toBe(
      "attribute_exists(PK) AND #status = :expected"
    );
    expect(items[0]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":status": "attendance_confirmed_whatsapp",
      ":expected": "message_sent",
      ":inbound": "wamid.inbound-1"
    });
    expect(items[1]?.Put?.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(items[1]?.Put?.Item).toMatchObject({
      PK: "WHATSAPP_COMMAND#branch-cmd-1",
      SK: "COMMAND",
      GSI1PK: "INVITATION#SW2748",
      entityType: "WhatsappCommand",
      templateId: "wedding_rsvp_attending_followup_single"
    });
  });

  it("atomically stores a WhatsApp single-decline RSVP with its branch reservation", async () => {
    const send = vi.fn().mockResolvedValue({});
    await repositoryWith(send).reserveWhatsappBranch({
      invitationCode: "SV2543",
      expectedStatus: "message_sent",
      status: "attendance_declined",
      lastInboundMessageId: "wamid.decline-1",
      updatedAt: NOW,
      declinedRsvp: {
        submittedBy: "whatsapp:wamid.decline-1",
        guestResponses: [{ guestId: "SV2543--guest-01", status: "declined", isChildSixOrYounger: false }]
      },
      command: {
        commandId: "branch-decline-1",
        invitationCode: "SV2543",
        templateId: "wedding_rsvp_declined_followup_single",
        templateVersion: 1,
        stage: "followup",
        status: "queued",
        effect: "complete_on_send",
        expectedFlowStatus: "attendance_declined",
        createdAt: NOW
      }
    });

    const transaction = send.mock.calls[0][0] as TransactWriteCommand;
    const items = transaction.input.TransactItems ?? [];
    expect(items).toHaveLength(3);
    expect(items[0]?.Put).toMatchObject({
      ConditionExpression: "attribute_not_exists(PK)",
      Item: {
        PK: "INVITATION#SV2543",
        SK: "RSVP#CURRENT",
        entityType: "RsvpResponse",
        invitationCode: "SV2543",
        submittedBy: "whatsapp:wamid.decline-1",
        guestResponses: [{ guestId: "SV2543--guest-01", status: "declined", isChildSixOrYounger: false }],
        status: "declined",
        attendingGuestCount: 0,
        paidAttendingGuestCount: 0,
        childSixOrYoungerAttendingCount: 0,
        updatedAt: NOW
      }
    });
    expect(items[1]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":status": "attendance_declined",
      ":expected": "message_sent"
    });
    expect(items[2]?.Put?.Item).toMatchObject({
      PK: "WHATSAPP_COMMAND#branch-decline-1",
      templateId: "wedding_rsvp_declined_followup_single"
    });
  });

  it("atomically stores every family guest as declined without website metadata", async () => {
    const send = vi.fn().mockResolvedValue({});
    await repositoryWith(send).reserveWhatsappBranch({
      invitationCode: "SW2748",
      expectedStatus: "message_sent",
      status: "attendance_declined",
      lastInboundMessageId: "wamid.family-decline-1",
      updatedAt: NOW,
      declinedRsvp: {
        submittedBy: "whatsapp:wamid.family-decline-1",
        guestResponses: [
          { guestId: "g1", status: "declined", isChildSixOrYounger: true },
          { guestId: "g2", status: "declined", isChildSixOrYounger: false },
          { guestId: "g3", status: "declined", isChildSixOrYounger: false }
        ]
      },
      command: {
        commandId: "branch-family-decline-1",
        invitationCode: "SW2748",
        templateId: "wedding_rsvp_declined_followup",
        templateVersion: 1,
        stage: "followup",
        status: "queued",
        effect: "complete_on_send",
        expectedFlowStatus: "attendance_declined",
        createdAt: NOW
      }
    });

    const transaction = send.mock.calls[0][0] as TransactWriteCommand;
    const items = transaction.input.TransactItems ?? [];
    expect(items).toHaveLength(3);
    expect(items[0]?.Put?.Item).toMatchObject({
      PK: "INVITATION#SW2748",
      SK: "RSVP#CURRENT",
      entityType: "RsvpResponse",
      submittedBy: "whatsapp:wamid.family-decline-1",
      guestResponses: [
        { guestId: "g1", status: "declined", isChildSixOrYounger: true },
        { guestId: "g2", status: "declined", isChildSixOrYounger: false },
        { guestId: "g3", status: "declined", isChildSixOrYounger: false }
      ],
      status: "declined",
      attendingGuestCount: 0,
      paidAttendingGuestCount: 0,
      childSixOrYoungerAttendingCount: 0
    });
    expect(items[0]?.Put?.Item).not.toHaveProperty("websiteOperationId");
    expect(items[0]?.Put?.Item).not.toHaveProperty("websitePayloadDigest");
    expect(items[1]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":status": "attendance_declined",
      ":expected": "message_sent"
    });
    expect(items[2]?.Put?.Item).toMatchObject({
      PK: "WHATSAPP_COMMAND#branch-family-decline-1",
      templateId: "wedding_rsvp_declined_followup"
    });
  });

  it("atomically stores the RSVP, marks the website follow-up pending, and queues one command", async () => {
    const send = vi.fn().mockResolvedValue({});
    await expect(repositoryWith(send).reserveWebsiteRsvp({
      request: websiteRequest,
      status: "attending",
      operation: websiteOperation,
      expectedWebsiteOperationId: websiteOperation.websiteOperationId,
      updatedAt: NOW,
      expectedStatus: "message_sent",
      command: {
        commandId: "website-op-1",
        invitationCode: "SW2748",
        templateId: "wedding_rsvp_attending_followup_website_single",
        templateVersion: 1,
        stage: "followup",
        status: "queued",
        effect: "complete_on_send",
        expectedFlowStatus: "website_followup_pending",
        createdAt: NOW
      }
    })).resolves.toBe(NOW);

    const transaction = send.mock.calls[0][0] as TransactWriteCommand;
    const items = transaction.input.TransactItems ?? [];
    expect(items).toHaveLength(3);
    expect(items[0]?.Put?.Item).toMatchObject({
      PK: "INVITATION#SW2748",
      SK: "RSVP#CURRENT",
      entityType: "RsvpResponse",
      websiteOperationId: "website-op-1",
      attendingGuestCount: 1
    });
    expect(items[0]?.Put?.ConditionExpression).toContain("#operation = :expectedOperation");
    expect(items[0]?.Put?.ExpressionAttributeValues).toEqual({ ":expectedOperation": "website-op-1" });
    expect(items[1]?.Update?.ConditionExpression).toBe(
      "attribute_exists(PK) AND #status = :expected"
    );
    expect(items[1]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":pending": "website_followup_pending",
      ":expected": "message_sent"
    });
    expect(items[2]?.Put?.ConditionExpression).toBe("attribute_not_exists(PK)");
  });

  it("sends one transaction and leaves local state to DynamoDB when reservation fails", async () => {
    const failure = new TransactionCanceledException({ message: "conditional race", $metadata: {} });
    const send = vi.fn().mockRejectedValue(failure);

    await expect(repositoryWith(send).reserveWhatsappBranch({
      invitationCode: "SW2748",
      expectedStatus: "message_sent",
      status: "attendance_declined",
      lastInboundMessageId: "wamid.inbound-2",
      updatedAt: NOW,
      command: {
        commandId: "branch-cmd-2",
        invitationCode: "SW2748",
        templateId: "wedding_rsvp_declined_followup_single",
        templateVersion: 1,
        stage: "followup",
        status: "queued",
        effect: "complete_on_send",
        expectedFlowStatus: "attendance_declined",
        createdAt: NOW
      }
    })).rejects.toBe(failure);
    expect(send).toHaveBeenCalledOnce();
  });

  it("writes RSVP-only records with an idempotent operation condition", async () => {
    const send = vi.fn().mockResolvedValue({});
    await repositoryWith(send).writeRsvpOnly({
      request: websiteRequest,
      status: "attending",
      operation: websiteOperation,
      expectedWebsiteOperationId: websiteOperation.websiteOperationId,
      updatedAt: NOW
    });

    const command = send.mock.calls[0][0] as PutCommand;
    expect(command.input.Item).toMatchObject({ PK: "INVITATION#SW2748", SK: "RSVP#CURRENT" });
    expect(command.input.ConditionExpression).toContain("#operation = :expectedOperation");
    expect(command.input.ExpressionAttributeValues).toEqual({
      ":expectedOperation": "website-op-1"
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
    expect(command.input.UpdateExpression).toContain("#sendAttemptDisposition = :notStarted");
    expect(command.input.ConditionExpression).toContain("#status = :sending");
    expect(command.input.ConditionExpression).toContain("#startedAt < :reclaimBefore");
    expect(command.input.ConditionExpression).toContain("#sendAttemptDisposition = :safeToRetry");
    expect(command.input.ConditionExpression).toContain("#sendAttemptDisposition = :notStarted");
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

  it("marks only the exact claimed attempt in flight", async () => {
    const send = vi.fn().mockResolvedValue({});
    await repositoryWith(send).markWhatsappCommandAttemptInFlight("cmd-1", NOW);

    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(command.input.UpdateExpression).toContain("#disposition = :inFlight");
    expect(command.input.ConditionExpression).toBe(
      "#status = :sending AND #disposition = :notStarted AND #lastAttemptAt = :attemptAt"
    );
    expect(command.input.ExpressionAttributeValues).toMatchObject({
      ":notStarted": "not_started",
      ":inFlight": "in_flight",
      ":attemptAt": NOW
    });
  });
});

describe("WeddingRepository WhatsApp message records", () => {
  it.each([
    ["opener", undefined, "message_sent"],
    ["complete_on_send", "attendance_declined", "completed"],
    ["preserve", undefined, undefined]
  ] as const)("finalizes an accepted %s send in one transaction", async (effect, expectedFlowStatus, invitationStatus) => {
    const expectedForCommand = expectedFlowStatus ?? (effect === "opener" ? "send_queued" : undefined);
    const expectedForWorker = expectedFlowStatus ?? (effect === "opener" ? "sending" : undefined);
    const commandForTest = { ...storedCommand, effect, expectedFlowStatus: expectedForCommand };
    const send = vi.fn().mockImplementation(async (request: GetCommand | TransactWriteCommand) => {
      if (request instanceof GetCommand) return { Item: commandForTest };
      return {};
    });
    const result = await repositoryWith(send).finalizeAcceptedWhatsappSend({
      commandId: "cmd-1",
      invitationCode: "SW2748",
      effect,
      expectedFlowStatus: expectedForWorker,
      fallback: false,
      now: NOW,
      message: { ...messageInput, commandId: "cmd-1" }
    });

    expect(result).toEqual({ outcome: "applied" });
    const transaction = send.mock.calls.at(-1)?.[0] as TransactWriteCommand;
    const items = transaction.input.TransactItems ?? [];
    expect(items).toHaveLength(invitationStatus ? 3 : 2);
    expect(items[0]?.Put?.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(items[1]?.Update?.ConditionExpression).toContain("#status = :sending");
    if (invitationStatus) {
      expect(items[2]?.Update?.ConditionExpression).toContain(
        invitationStatus === "completed" ? "#status = :expected" : "#status = :sending"
      );
      expect(items[2]?.Update?.ExpressionAttributeValues).toMatchObject(
        invitationStatus === "completed"
          ? { ":completed": "completed", ":expected": expectedFlowStatus }
          : { ":messageSent": "message_sent" }
      );
    }
  });

  it("finalizes a fallback without changing flow status or completion metadata", async () => {
    const send = vi.fn().mockImplementation(async (request: GetCommand | TransactWriteCommand) => {
      if (request instanceof GetCommand) return { Item: { ...storedCommand, effect: "preserve" } };
      return {};
    });
    await repositoryWith(send).finalizeAcceptedWhatsappSend({
      commandId: "cmd-1",
      invitationCode: "SW2748",
      effect: "preserve",
      fallback: true,
      now: NOW,
      message: { ...messageInput, commandId: "cmd-1" }
    });

    const transaction = send.mock.calls.at(-1)?.[0] as TransactWriteCommand;
    const flowUpdate = transaction.input.TransactItems?.[2]?.Update;
    expect(flowUpdate?.UpdateExpression).toBe("SET #fallback = :fallback");
    expect(flowUpdate?.ConditionExpression).toContain("attribute_not_exists(#fallback)");
  });

  it("recognizes a complete finalization replay", async () => {
    const completeCommand = {
      ...storedCommand,
      status: "sent",
      effect: "complete_on_send",
      expectedFlowStatus: "attendance_declined",
      providerMessageId: WAMID,
      sentAt: NOW
    };
    const completeInvitation = {
      ...invitationItem,
      whatsappFlowStatus: "completed",
      whatsappFlowCompletedAt: NOW
    };
    const send = vi.fn().mockImplementation(async (request: GetCommand | QueryCommand | TransactWriteCommand) => {
      if (request instanceof TransactWriteCommand) throw new TransactionCanceledException({ message: "condition", $metadata: {} });
      if (request instanceof QueryCommand) return { Items: [completeInvitation] };
      if (request.input.Key?.PK?.startsWith("WHATSAPP_MESSAGE#")) return { Item: { ...storedMessage, commandId: "cmd-1" } };
      return { Item: completeCommand };
    });

    await expect(repositoryWith(send).finalizeAcceptedWhatsappSend({
      commandId: "cmd-1",
      invitationCode: "SW2748",
      effect: "complete_on_send",
      expectedFlowStatus: "attendance_declined",
      fallback: false,
      now: NOW,
      message: { ...messageInput, commandId: "cmd-1" }
    })).resolves.toEqual({ outcome: "replayed" });
  });

  it("requires reconciliation for a partial or mismatched finalization", async () => {
    const send = vi.fn().mockImplementation(async (request: GetCommand | QueryCommand | TransactWriteCommand) => {
      if (request instanceof TransactWriteCommand) throw new TransactionCanceledException({ message: "condition", $metadata: {} });
      if (request instanceof QueryCommand) return { Items: [invitationItem] };
      if (request.input.Key?.PK?.startsWith("WHATSAPP_MESSAGE#")) return {};
      return { Item: storedCommand };
    });

    await expect(repositoryWith(send).finalizeAcceptedWhatsappSend({
      commandId: "cmd-1",
      invitationCode: "SW2748",
      effect: "opener",
      fallback: false,
      now: NOW,
      message: { ...messageInput, commandId: "cmd-1" }
    })).resolves.toMatchObject({ outcome: "reconciliation_required" });
  });

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

  it("indexes unassigned messages outside every invitation conversation", async () => {
    const send = vi.fn().mockResolvedValue({});

    await repositoryWith(send).putWhatsappMessage({
      messageId: "wamid.unassigned",
      direction: "inbound",
      messageType: "text",
      correlationStatus: "ambiguous_sender",
      status: "received",
      senderPhone: "5511963656517",
      body: "private retained text",
      createdAt: NOW,
      persistedAt: NOW,
      timestampSource: "provider"
    });

    const command = send.mock.calls[0][0] as PutCommand;
    expect(command.input.Item).toMatchObject({
      PK: "WHATSAPP_MESSAGE#wamid.unassigned",
      GSI1PK: "WHATSAPP#UNASSIGNED",
      GSI1SK: `WHATSAPP#${NOW}#MESSAGE#wamid.unassigned`,
      correlationStatus: "ambiguous_sender"
    });
    expect(command.input.Item).not.toHaveProperty("invitationCode");
  });

  it("applies a status with an optimistic guard so it cannot conjure a phantom record", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ Item: storedMessage })
      .mockResolvedValueOnce({});

    const result = await repositoryWith(send).applyWhatsappMessageStatus(WAMID, {
      status: "delivered",
      statusUpdatedAt: NOW,
      statusTimestampSource: "provider",
      updatedAt: NOW
    });

    const command = send.mock.calls[1][0] as UpdateCommand;
    expect(result).toBe("applied");
    expect(command.input.ConditionExpression).toContain("attribute_exists(PK)");
    expect(command.input.ConditionExpression).toContain("#status = :expectedStatus");
    expect(command.input.ConditionExpression).toContain("attribute_not_exists(#statusUpdatedAt)");
    expect(command.input.Key).toEqual({ PK: `WHATSAPP_MESSAGE#${WAMID}`, SK: "MESSAGE" });
    expect(command.input.UpdateExpression).toContain("#status = :status");
  });

  it("reports a status update for an unknown message as missing", async () => {
    const send = vi.fn().mockResolvedValue({});

    await expect(
      repositoryWith(send).applyWhatsappMessageStatus(WAMID, {
        status: "delivered",
        statusUpdatedAt: NOW,
        statusTimestampSource: "provider",
        updatedAt: NOW
      })
    ).resolves.toBe("missing");
    expect(send).toHaveBeenCalledOnce();
  });

  it("reports identical persisted status evidence as already applied", async () => {
    const send = vi.fn().mockResolvedValue({
      Item: { ...storedMessage, status: "failed", statusUpdatedAt: NOW }
    });

    await expect(repositoryWith(send).applyWhatsappMessageStatus(WAMID, {
      status: "failed",
      statusUpdatedAt: NOW,
      statusTimestampSource: "provider",
      updatedAt: "2026-08-17T12:01:00.000Z",
      providerErrorCategory: "provider"
    })).resolves.toBe("already_applied");
    expect(send).toHaveBeenCalledOnce();
  });

  it("ignores a sent status that would regress a delivered message", async () => {
    const send = vi.fn().mockResolvedValue({
      Item: { ...storedMessage, status: "delivered", statusUpdatedAt: NOW }
    });

    const result = await repositoryWith(send).applyWhatsappMessageStatus(WAMID, {
      status: "sent",
      statusUpdatedAt: "2026-08-17T12:01:00.000Z",
      statusTimestampSource: "provider",
      updatedAt: "2026-08-17T12:01:01.000Z"
    });

    expect(send).toHaveBeenCalledOnce();
    expect(result).toBe("ignored");
  });

  it.each([
    ["delivered", "read", "2026-08-17T11:59:59.000Z"],
    ["read", "failed", "2026-08-17T12:01:00.000Z"],
    ["delivered", "failed", "2026-08-17T12:01:00.000Z"]
  ] as const)("ignores %s -> %s when chronology or evidence would regress", async (currentStatus, incomingStatus, incomingAt) => {
    const send = vi.fn().mockResolvedValue({
      Item: { ...storedMessage, status: currentStatus, statusUpdatedAt: NOW }
    });

    await expect(repositoryWith(send).applyWhatsappMessageStatus(WAMID, {
      status: incomingStatus,
      statusUpdatedAt: incomingAt,
      statusTimestampSource: "provider",
      updatedAt: "2026-08-17T12:02:00.000Z"
    })).resolves.toBe("ignored");
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    ["sent", "delivered", NOW],
    ["sent", "failed", "2026-08-17T12:01:00.000Z"],
    ["failed", "delivered", "2026-08-17T12:01:00.000Z"],
    ["delivered", "read", "2026-08-17T12:01:00.000Z"]
  ] as const)("applies progressive status %s -> %s", async (currentStatus, incomingStatus, incomingAt) => {
    const send = vi.fn()
      .mockResolvedValueOnce({
        Item: {
          ...storedMessage,
          status: currentStatus,
          statusUpdatedAt: NOW,
          providerErrorCategory: currentStatus === "failed" ? "provider" : undefined
        }
      })
      .mockResolvedValueOnce({});

    await expect(repositoryWith(send).applyWhatsappMessageStatus(WAMID, {
      status: incomingStatus,
      statusUpdatedAt: incomingAt,
      statusTimestampSource: "provider",
      updatedAt: "2026-08-17T12:02:00.000Z",
      providerErrorCategory: incomingStatus === "failed" ? "provider" : undefined
    })).resolves.toBe("applied");
    const update = send.mock.calls[1][0] as UpdateCommand;
    if (currentStatus === "failed") {
      expect(update.input.UpdateExpression).toContain("REMOVE #providerErrorCode");
    }
  });

  it("uses status evidence for legacy records without statusUpdatedAt", async () => {
    const ignored = vi.fn().mockResolvedValue({
      Item: { ...storedMessage, status: "read" }
    });
    await expect(repositoryWith(ignored).applyWhatsappMessageStatus(WAMID, {
      status: "sent",
      statusUpdatedAt: NOW,
      statusTimestampSource: "provider",
      updatedAt: NOW
    })).resolves.toBe("ignored");

    const applied = vi.fn()
      .mockResolvedValueOnce({ Item: { ...storedMessage, status: "sent" } })
      .mockResolvedValueOnce({});
    await expect(repositoryWith(applied).applyWhatsappMessageStatus(WAMID, {
      status: "delivered",
      statusUpdatedAt: NOW,
      statusTimestampSource: "provider",
      updatedAt: NOW
    })).resolves.toBe("applied");
  });

  it("re-reads after a concurrent status update before applying stronger evidence", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ Item: { ...storedMessage, status: "sent", statusUpdatedAt: NOW } })
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: { ...storedMessage, status: "delivered", statusUpdatedAt: NOW } })
      .mockResolvedValueOnce({});

    await expect(repositoryWith(send).applyWhatsappMessageStatus(WAMID, {
      status: "read",
      statusUpdatedAt: "2026-08-17T12:01:00.000Z",
      statusTimestampSource: "provider",
      updatedAt: "2026-08-17T12:01:01.000Z"
    })).resolves.toBe("applied");
    expect(send).toHaveBeenCalledTimes(4);
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

  it("queries unassigned messages without mixing them into invitation timelines", async () => {
    const unassigned = {
      messageId: "wamid.unassigned",
      direction: "inbound",
      messageType: "text",
      correlationStatus: "unmatched_sender",
      status: "received",
      senderPhone: "5511963656517",
      body: "private retained text",
      createdAt: NOW,
      persistedAt: NOW,
      timestampSource: "provider",
      PK: "WHATSAPP_MESSAGE#wamid.unassigned",
      SK: "MESSAGE",
      GSI1PK: "WHATSAPP#UNASSIGNED",
      GSI1SK: `WHATSAPP#${NOW}#MESSAGE#wamid.unassigned`,
      entityType: "WhatsappMessage"
    };
    const send = vi.fn().mockResolvedValue({ Items: [unassigned] });

    const result = await repositoryWith(send).listUnassignedWhatsappMessages({ limit: 10 });

    const command = send.mock.calls[0][0] as QueryCommand;
    expect(command.input.ExpressionAttributeValues).toEqual({
      ":gsi1pk": "WHATSAPP#UNASSIGNED",
      ":prefix": "WHATSAPP#"
    });
    expect(result.entries[0]).toMatchObject({
      messageId: "wamid.unassigned",
      correlationStatus: "unmatched_sender"
    });
  });
});
