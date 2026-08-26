import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient
} from "@aws-sdk/lib-dynamodb";
import type {
  CreateGuestMessageRequest,
  GuestMessage,
  AdminDashboardInvitation,
  AdminGuestExportRow,
  GuestProfile,
  HouseholdInvitation,
  RsvpSubmissionRequest,
  RsvpStatus,
  WhatsappFlowStage,
  WhatsappFlowStatus,
  WhatsappMessageStatus,
  WhatsappTimestampSource
} from "@brimax/contracts";
import { dynamoDbDocumentClient } from "../client";
import {
  guestMessageFeedKey,
  guestMessageLookupKey,
  invitationKeys,
  phoneLookupIndex,
  rsvpKeys,
  webhookKeys,
  whatsappCommandKeys,
  whatsappConversationCommandIndex,
  whatsappConversationIndexPrefix,
  whatsappConversationMessageIndex,
  whatsappUnassignedMessageIndex,
  whatsappUnassignedMessageIndexPrefix,
  whatsappMessageKeys,
  whatsappInvitationPhoneLookupKeys
} from "../key-builder";
import {
  WhatsappCommandInputSchema,
  WhatsappCommandItemSchema,
  WhatsappMessageInputSchema,
  WhatsappMessageItemSchema,
  WhatsappWebhookMarkerSchema,
  parseStoredWhatsappItem,
  type WhatsappCommandInput,
  type WhatsappCommandItem,
  type WhatsappMessageInput,
  type WhatsappMessageItem
} from "../whatsapp-items";
import { RsvpResponseItemSchema, type RsvpResponseItem } from "../rsvp-items";
import { GSI1_NAME, TABLE_PRIMARY_KEY, TABLE_SORT_KEY, TTL_ATTRIBUTE } from "../table";
import { getEnv } from "../../../lib/env";
import { AppError } from "../../../lib/errors";
import {
  deriveRsvpCounts,
  toAdminDashboardInvitation,
  toAdminExportRows,
  toGuestProfile,
  toHouseholdInvitation,
  toWhatsappRsvpStatus
} from "../mappers";
import { createTracedAwsClient } from "../../../lib/xray";

type ItemRecord = Record<string, unknown>;

/** Default dedupe window, unchanged for the existing Asaas caller. */
export const WEBHOOK_EVENT_TTL_SECONDS = 86_400;
/**
 * Meta retries webhook deliveries with backoff for roughly a week, so a 24-hour marker can
 * expire while a retry is still in flight and let the event be processed a second time. Step 11
 * passes this from the WhatsApp call site.
 */
export const WHATSAPP_WEBHOOK_EVENT_TTL_SECONDS = 30 * 86_400;

/**
 * Typed value maps for the dynamic `SET` updates. Naming the allowed attributes is what turns a
 * misspelled field — which DynamoDB would happily write and nothing would ever read — into a
 * compile error.
 */
export type WhatsappCommandUpdate = Partial<Omit<WhatsappCommandInput, "commandId">>;
export type WhatsappFlowUpdate = Partial<{
  whatsappFlowStatus: WhatsappFlowStatus;
  whatsappFlowStage: WhatsappFlowStage;
  whatsappLastOutboundMessageId: string;
  whatsappLastInboundMessageId: string;
  whatsappFlowUpdatedAt: string;
  whatsappFlowCompletedAt: string;
  whatsappFallbackSentAt: string;
  whatsappFailureReason: string;
  whatsappAttendance: { guestId: string; status: "attending" | "declined"; recordedAt: string }[];
}>;

export type WhatsappAcceptedSendFinalizationInput = {
  commandId: string;
  invitationCode: string;
  message: WhatsappMessageInput;
  effect: "opener" | "preserve" | "complete_on_send";
  expectedFlowStatus?: WhatsappFlowStatus;
  now: string;
  fallback: boolean;
};

export type WhatsappAcceptedSendFinalizationResult =
  | { outcome: "applied" | "replayed" }
  | { outcome: "reconciliation_required"; reason: string };

export type RsvpOperationIdentity = {
  websiteOperationId: string;
  websitePayloadDigest: string;
  websiteIdempotencyKeyDigest?: string;
};

type RsvpReservationInput = {
  request: RsvpSubmissionRequest;
  status: RsvpStatus;
  operation: RsvpOperationIdentity;
  updatedAt: string;
  expectedWebsiteOperationId?: string;
  expectedLegacyRsvp?: boolean;
};

type WhatsappBranchReservationInput = {
  invitationCode: string;
  expectedStatus: WhatsappFlowStatus;
  status: WhatsappFlowStatus;
  lastInboundMessageId: string;
  updatedAt: string;
  attendance?: { guestId: string; status: "attending" | "declined"; recordedAt: string }[];
  declinedRsvp?: {
    submittedBy: string;
    guestResponses: RsvpSubmissionRequest["guestResponses"];
  };
  command: WhatsappCommandInput;
};

/**
 * A condition to AND onto an update. Placeholders must use the `#c`/`:c` prefixes so they cannot
 * collide with the `#n{i}`/`:v{i}` pairs that `buildSetExpression` generates.
 */
export type UpdateCondition = {
  expression: string;
  names?: Record<string, string>;
  values?: Record<string, unknown>;
};

export const WHATSAPP_WORKER_MAX_ATTEMPTS = 5;
export const WHATSAPP_QUEUE_VISIBILITY_TIMEOUT_MS = 120_000;
export const WHATSAPP_RECLAIM_MARGIN_MS = 30_000;

type WhatsappConversationEntry = WhatsappMessageItem | WhatsappCommandItem;

export type WhatsappStatusApplicationResult = "applied" | "already_applied" | "ignored" | "missing";

export type WhatsappStatusApplicationInput = {
  status: Exclude<WhatsappMessageStatus, "received">;
  statusUpdatedAt: string;
  statusTimestampSource: WhatsappTimestampSource;
  updatedAt: string;
  providerErrorCode?: number | string;
  providerErrorTitle?: string;
  providerErrorCategory?: string;
};

const WHATSAPP_STATUS_RANK: Record<WhatsappMessageStatus, number> = {
  received: -1,
  sent: 0,
  failed: 1,
  delivered: 2,
  read: 3
};

function shouldApplyWhatsappStatus(
  current: WhatsappMessageItem,
  incoming: WhatsappStatusApplicationInput
) {
  if (current.direction !== "outbound") return false;
  const currentRank = WHATSAPP_STATUS_RANK[current.status];
  const incomingRank = WHATSAPP_STATUS_RANK[incoming.status];
  if (incomingRank < currentRank) return false;
  if (!current.statusUpdatedAt) return true;
  if (incoming.statusUpdatedAt > current.statusUpdatedAt) return true;
  return incoming.statusUpdatedAt === current.statusUpdatedAt && incomingRank > currentRank;
}

type GuestMessageFeedItem = ItemRecord & {
  entityType: "GuestMessage";
  authorName: string;
  createdAt: string;
  message: string;
  messageId: string;
};

type GuestMessageLookupItem = ItemRecord & {
  entityType: "GuestMessageLookup";
  feedPK: string;
  feedSK: string;
  messageId: string;
};

function rsvpItem(input: RsvpReservationInput): RsvpResponseItem {
  const counts = deriveRsvpCounts(input.request);
  return RsvpResponseItemSchema.parse({
    ...rsvpKeys(input.request.invitationCode),
    entityType: "RsvpResponse",
    invitationCode: input.request.invitationCode,
    submittedBy: input.request.submittedBy,
    guestResponses: input.request.guestResponses,
    attendingGuestCount: counts.attendingGuestCount,
    paidAttendingGuestCount: counts.paidAttendingGuestCount,
    childSixOrYoungerAttendingCount: counts.childSixOrYoungerAttendingCount,
    note: input.request.note,
    status: input.status,
    updatedAt: input.updatedAt,
    ...input.operation
  });
}

function rsvpOperationCondition(input: Pick<RsvpReservationInput, "expectedWebsiteOperationId" | "expectedLegacyRsvp">) {
  if (input.expectedWebsiteOperationId) {
    return {
      ConditionExpression: "#operation = :expectedOperation",
      ExpressionAttributeNames: { "#operation": "websiteOperationId" },
      ExpressionAttributeValues: { ":expectedOperation": input.expectedWebsiteOperationId }
    };
  }
  if (input.expectedLegacyRsvp) {
    return {
      ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(#operation)",
      ExpressionAttributeNames: { "#operation": "websiteOperationId" },
    };
  }
  return {
    ConditionExpression: "attribute_not_exists(PK)"
  };
}

export class WeddingRepository {
  private readonly documentClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(
    documentClient: DynamoDBDocumentClient = dynamoDbDocumentClient,
    tableName = getEnv().weddingTableName
  ) {
    this.documentClient = createTracedAwsClient(documentClient, {
      annotations: {
        repository: "wedding_repository",
        table_role: "wedding"
      },
      subsegmentPrefix: "wedding_repository"
    });
    this.tableName = tableName;
  }

  async getInvitationByCode(invitationCode: string): Promise<HouseholdInvitation | null> {
    const result = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        ConsistentRead: true,
        KeyConditionExpression: `${TABLE_PRIMARY_KEY} = :pk`,
        ExpressionAttributeValues: {
          ":pk": invitationKeys(invitationCode).PK
        }
      })
    );

    const items = (result.Items ?? []) as ItemRecord[];
    const invitation = items.find((item) => item.entityType === "Invitation");
    if (!invitation) {
      return null;
    }

    return toHouseholdInvitation({
      invitation,
      guests: items.filter((item) => item.entityType === "InvitationGuest") as ItemRecord[],
      rsvp: items.find((item) => item.entityType === "RsvpResponse")
    });
  }

  async listAdminDashboardInvitations(): Promise<AdminDashboardInvitation[]> {
    const items: ItemRecord[] = [];
    let exclusiveStartKey: ItemRecord | undefined;

    do {
      const result = await this.documentClient.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression:
            "entityType = :invitationType OR entityType = :guestType OR entityType = :rsvpType OR entityType = :messageType",
          ExpressionAttributeValues: {
            ":invitationType": "Invitation",
            ":guestType": "InvitationGuest",
            ":rsvpType": "RsvpResponse",
            ":messageType": "WhatsappMessage"
          },
          // The trailing seven attributes feed the per-invitation WhatsApp conversation summary and
          // nothing else. None of them is a DynamoDB reserved word, so none needs its own alias; the
          // existing `#status` alias already covers the message item's own `status` attribute.
          ProjectionExpression:
            "PK, SK, entityType, invitationCode, householdName, phoneNumber, phoneNumberSource, phoneNumberUpdatedAt, whatsappFlowStatus, whatsappFlowStage, whatsappFlowUpdatedAt, whatsappFlowCompletedAt, whatsappFallbackSentAt, whatsappLastInboundMessageId, whatsappLastInboundAt, whatsappLastOutboundMessageId, whatsappFailureReason, whatsappAttendance, guestId, guestName, sortOrder, allowedPlusOnes, rsvpStatus, isChild, dietaryNotes, submittedBy, guestResponses, attendingGuestCount, paidAttendingGuestCount, childSixOrYoungerAttendingCount, #note, #status, updatedAt, messageId, direction, messageType, templateId, buttonId, body, correlationStatus, createdAt",
          ExpressionAttributeNames: {
            "#note": "note",
            "#status": "status"
          },
          ExclusiveStartKey: exclusiveStartKey
        })
      );

      items.push(...((result.Items ?? []) as ItemRecord[]));
      exclusiveStartKey = result.LastEvaluatedKey as ItemRecord | undefined;
    } while (exclusiveStartKey);

    const groups = new Map<
      string,
      { invitation?: ItemRecord; guests: ItemRecord[]; rsvp?: ItemRecord; messages: ItemRecord[] }
    >();

    for (const item of items) {
      const invitationCode = typeof item.invitationCode === "string" ? item.invitationCode : "";
      if (!invitationCode) continue;

      const group = groups.get(invitationCode) ?? { guests: [], messages: [] };
      if (item.entityType === "Invitation") group.invitation = item;
      else if (item.entityType === "InvitationGuest") group.guests.push(item);
      else if (item.entityType === "RsvpResponse") group.rsvp = item;
      else if (item.entityType === "WhatsappMessage") group.messages.push(item);
      groups.set(invitationCode, group);
    }

    let skippedMessageRecords = 0;
    const invitations = [...groups.entries()]
      .filter((entry): entry is [
        string,
        { invitation: ItemRecord; guests: ItemRecord[]; rsvp?: ItemRecord; messages: ItemRecord[] }
      ] => Boolean(entry[1].invitation))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, group]) =>
        toAdminDashboardInvitation(group, {
          onSkippedMessage: () => {
            skippedMessageRecords += 1;
          }
        })
      );

    // One aggregated line per request, never per record and never with a message body.
    if (skippedMessageRecords > 0) {
      console.warn(
        JSON.stringify({
          metric: "ADMIN_DASHBOARD_WHATSAPP_MESSAGE_RECORD_SKIPPED",
          skippedMessageRecords
        })
      );
    }

    return invitations;
  }

  async getRsvpResponse(invitationCode: string): Promise<RsvpResponseItem | null> {
    const result = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: rsvpKeys(invitationCode),
      ConsistentRead: true
    }));
    if (!result.Item) return null;
    return RsvpResponseItemSchema.parse(result.Item);
  }

  async reserveWhatsappBranch(input: WhatsappBranchReservationInput) {
    const command = WhatsappCommandInputSchema.parse(input.command);
    const commandItem = {
      ...command,
      ...whatsappCommandKeys(command.commandId),
      ...whatsappConversationCommandIndex(
        command.invitationCode,
        command.createdAt,
        command.commandId
      ),
      entityType: "WhatsappCommand"
    };
    const names: Record<string, string> = {
      "#status": "whatsappFlowStatus",
      "#inbound": "whatsappLastInboundMessageId",
      "#updated": "whatsappFlowUpdatedAt"
    };
    const values: Record<string, unknown> = {
      ":status": input.status,
      ":inbound": input.lastInboundMessageId,
      ":updated": input.updatedAt,
      ":expected": input.expectedStatus
    };
    let updateExpression = "SET #status = :status, #inbound = :inbound, #updated = :updated";
    if (input.attendance) {
      names["#attendance"] = "whatsappAttendance";
      values[":attendance"] = input.attendance;
      updateExpression += ", #attendance = :attendance";
    }

    const transactionItems: ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] = [];
    if (input.declinedRsvp) {
      const guestResponses = input.declinedRsvp.guestResponses;
      transactionItems.push({
        Put: {
          TableName: this.tableName,
          Item: RsvpResponseItemSchema.parse({
            ...rsvpKeys(input.invitationCode),
            entityType: "RsvpResponse",
            invitationCode: input.invitationCode,
            submittedBy: input.declinedRsvp.submittedBy,
            guestResponses,
            attendingGuestCount: 0,
            paidAttendingGuestCount: 0,
            childSixOrYoungerAttendingCount: 0,
            status: "declined",
            updatedAt: input.updatedAt
          }),
          ConditionExpression: "attribute_not_exists(PK)"
        }
      });
    }
    transactionItems.push(
      {
        Update: {
          TableName: this.tableName,
          Key: invitationKeys(input.invitationCode),
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ConditionExpression: "attribute_exists(PK) AND #status = :expected"
        }
      },
      {
        Put: {
          TableName: this.tableName,
          Item: commandItem,
          ConditionExpression: "attribute_not_exists(PK)"
        }
      }
    );
    await this.documentClient.send(new TransactWriteCommand({ TransactItems: transactionItems }));
  }

  async reserveWebsiteRsvp(
    input: RsvpReservationInput & { expectedStatus: WhatsappFlowStatus; command: WhatsappCommandInput }
  ) {
    const item = rsvpItem(input);
    const command = WhatsappCommandInputSchema.parse(input.command);
    const commandItem = {
      ...command,
      ...whatsappCommandKeys(command.commandId),
      ...whatsappConversationCommandIndex(
        command.invitationCode,
        command.createdAt,
        command.commandId
      ),
      entityType: "WhatsappCommand"
    };
    await this.documentClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: this.tableName,
            Item: item,
            ...rsvpOperationCondition(input)
          }
        },
        {
          Update: {
            TableName: this.tableName,
            Key: invitationKeys(input.request.invitationCode),
            UpdateExpression: "SET #status = :pending, #updated = :updated",
            ExpressionAttributeNames: {
              "#status": "whatsappFlowStatus",
              "#updated": "whatsappFlowUpdatedAt"
            },
            ExpressionAttributeValues: {
              ":pending": "website_followup_pending",
              ":updated": input.updatedAt,
              ":expected": input.expectedStatus
            },
            ConditionExpression: "attribute_exists(PK) AND #status = :expected"
          }
        },
        {
          Put: {
            TableName: this.tableName,
            Item: commandItem,
            ConditionExpression: "attribute_not_exists(PK)"
          }
        }
      ]
    }));
    return input.updatedAt;
  }

  async writeRsvpOnly(input: RsvpReservationInput) {
    const item = rsvpItem(input);
    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
      ...rsvpOperationCondition(input)
    }));
    return input.updatedAt;
  }

  async updateInvitationWhatsappPhone(invitationCode: string, phoneNumber: string) {
    const updatedAt = new Date().toISOString();
    try {
      await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: invitationKeys(invitationCode),
        UpdateExpression: "SET phoneNumber = :phone, phoneNumberUpdatedAt = :updatedAt, phoneNumberSource = :source",
        ExpressionAttributeValues: { ":phone": phoneNumber, ":updatedAt": updatedAt, ":source": "operator" },
        ConditionExpression: "attribute_exists(PK)"
      }));
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new AppError("Invitation not found.", 404);
      }
      throw error;
    }
    return updatedAt;
  }

  async putWhatsappInvitationPhoneLookup(phoneNumber: string, invitationCode: string) {
    const key = whatsappInvitationPhoneLookupKeys(phoneNumber, invitationCode);
    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: { ...key, entityType: "WhatsappInvitationPhoneLookup", phoneNumber, invitationCode },
      ConditionExpression: "attribute_not_exists(PK)"
    })).catch((error) => {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    });
  }

  async getInvitationsByWhatsappPhone(phoneNumber: string) {
    const result = await this.documentClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: `${TABLE_PRIMARY_KEY} = :pk AND begins_with(${TABLE_SORT_KEY}, :prefix)`,
      ExpressionAttributeValues: {
        ":pk": `WHATSAPP_PHONE#${phoneNumber}`,
        ":prefix": "INVITATION#"
      }
    }));
    return (result.Items ?? []).flatMap((item) => {
      const value = item as ItemRecord;
      return typeof value.invitationCode === "string" ? [value.invitationCode] : [];
    });
  }

  async getInvitationWhatsappStatus(invitationCode: string) {
    const result = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: `${TABLE_PRIMARY_KEY} = :pk`,
        ExpressionAttributeValues: { ":pk": invitationKeys(invitationCode).PK },
        ConsistentRead: true,
        ProjectionExpression:
          "invitationCode, householdName, phoneNumber, phoneNumberUpdatedAt, phoneNumberSource, whatsappFlowStatus, whatsappFlowStage, whatsappLastOutboundMessageId, whatsappLastInboundMessageId, whatsappLastInboundAt, whatsappFlowUpdatedAt, whatsappFlowCompletedAt, whatsappFallbackSentAt, whatsappFailureReason, whatsappAttendance, entityType, guestId, guestName, sortOrder, allowedPlusOnes, rsvpStatus, isChild, dietaryNotes, guestResponses"
      })
    );
    const items = (result.Items ?? []) as ItemRecord[];
    const invitation = items.find((item) => item.entityType === "Invitation") as
      | ItemRecord
      | undefined;
    if (!invitation) return null;
    const householdInvitation = toHouseholdInvitation({
      invitation,
      guests: items.filter((item) => item.entityType === "InvitationGuest"),
      rsvp: items.find((item) => item.entityType === "RsvpResponse")
    });
    return toWhatsappRsvpStatus(invitation, householdInvitation);
  }

  async createWhatsappCommand(input: WhatsappCommandInput) {
    // Parse first (the schema strips unknown keys), then spread the key builder output last, so
    // a caller-supplied PK/SK/entityType can never reach the item and the key segment is a
    // validated non-empty string rather than a stringified `undefined`.
    const command = WhatsappCommandInputSchema.parse(input);
    await this.documentClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        ...command,
        ...whatsappCommandKeys(command.commandId),
        ...whatsappConversationCommandIndex(
          command.invitationCode,
          command.createdAt,
          command.commandId
        ),
        entityType: "WhatsappCommand"
      },
      // Callers catch ConditionalCheckFailedException by name to detect a replayed
      // Idempotency-Key, so it propagates unchanged.
      ConditionExpression: "attribute_not_exists(PK)"
    }));
    return command;
  }

  async reserveWhatsappCommand(
    input: WhatsappCommandInput,
    expectedStatus: WhatsappFlowStatus | undefined,
    completedRestart?: { completedAt: string; rsvpUpdatedAt: string | null }
  ) {
    const command = WhatsappCommandInputSchema.parse(input);
    const commandItem = {
      ...command,
      ...whatsappCommandKeys(command.commandId),
      ...whatsappConversationCommandIndex(command.invitationCode, command.createdAt, command.commandId),
      entityType: "WhatsappCommand"
    };
    const transaction: ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] = [
      {
        Put: {
          TableName: this.tableName,
          Item: commandItem,
          ConditionExpression: "attribute_not_exists(PK)"
        }
      }
    ];
    if (expectedStatus !== undefined) {
      transaction.push({
        Update: {
          TableName: this.tableName,
          Key: invitationKeys(command.invitationCode),
          UpdateExpression:
            "SET #s = :sendQueued, #stage = :stage, #updated = :updated" +
            (completedRestart ? " REMOVE #completed, #failure, #fallback" : ""),
          ExpressionAttributeNames: {
            "#s": "whatsappFlowStatus",
            "#stage": "whatsappFlowStage",
            "#updated": "whatsappFlowUpdatedAt",
            ...(completedRestart ? {
              "#completed": "whatsappFlowCompletedAt",
              "#failure": "whatsappFailureReason",
              "#fallback": "whatsappFallbackSentAt"
            } : {})
          },
          ExpressionAttributeValues: {
            ":sendQueued": "send_queued",
            ":stage": command.stage,
            ":updated": command.createdAt,
            ":expected": expectedStatus,
            ...(completedRestart ? { ":completedAt": completedRestart.completedAt } : {})
          },
          ConditionExpression: completedRestart
            ? "attribute_exists(PK) AND #s = :expected AND #completed = :completedAt"
            : expectedStatus === "idle"
              ? "attribute_exists(PK) AND (attribute_not_exists(#s) OR #s = :expected)"
              : "attribute_exists(PK) AND #s = :expected"
        }
      });
      if (completedRestart) {
        transaction.push({
          ConditionCheck: {
            TableName: this.tableName,
            Key: rsvpKeys(command.invitationCode),
            ConditionExpression: completedRestart.rsvpUpdatedAt
              ? "attribute_exists(PK) AND #updated = :rsvpUpdatedAt"
              : "attribute_not_exists(PK)",
            ...(completedRestart.rsvpUpdatedAt ? {
              ExpressionAttributeNames: { "#updated": "updatedAt" },
              ExpressionAttributeValues: { ":rsvpUpdatedAt": completedRestart.rsvpUpdatedAt }
            } : {})
          }
        });
      }
    }
    await this.documentClient.send(new TransactWriteCommand({ TransactItems: transaction }));
  }

  async getWhatsappCommand(commandId: string): Promise<WhatsappCommandItem | undefined> {
    const result = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: whatsappCommandKeys(commandId),
      ConsistentRead: true
    }));
    if (!result.Item) return undefined;
    return parseStoredWhatsappItem(WhatsappCommandItemSchema, result.Item, "WhatsApp command");
  }

  async updateWhatsappCommand(commandId: string, values: WhatsappCommandUpdate, condition?: UpdateCondition) {
    const expression = buildSetExpression(values);
    if (!expression) return;
    await this.documentClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: whatsappCommandKeys(commandId),
      ...expression,
      ExpressionAttributeNames: { ...expression.ExpressionAttributeNames, ...condition?.names },
      ExpressionAttributeValues: { ...expression.ExpressionAttributeValues, ...condition?.values },
      ConditionExpression: condition?.expression
    }));
  }

  async claimWhatsappCommand(
    commandId: string,
    input: { now: string; receiveCount: number; reclaimBefore: string }
  ): Promise<boolean> {
    try {
      await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: whatsappCommandKeys(commandId),
        UpdateExpression:
          "SET #status = :sending, #startedAt = :now, #lastAttemptAt = :now, " +
          "#lastAttemptReceiveCount = :receiveCount, #updatedAt = :now, " +
          "#retryCount = if_not_exists(#retryCount, :zero) + :one, #sendAttemptDisposition = :notStarted",
        ExpressionAttributeNames: {
          "#status": "status",
          "#startedAt": "startedAt",
          "#lastAttemptAt": "lastAttemptAt",
          "#lastAttemptReceiveCount": "lastAttemptReceiveCount",
          "#updatedAt": "updatedAt",
          "#retryCount": "retryCount",
          "#sendAttemptDisposition": "sendAttemptDisposition"
        },
        ExpressionAttributeValues: {
          ":sending": "sending",
          ":queued": "queued",
          ":queueUnavailable": "queue_unavailable",
          ":now": input.now,
          ":receiveCount": input.receiveCount,
          ":reclaimBefore": input.reclaimBefore,
          ":zero": 0,
          ":one": 1,
          ":notStarted": "not_started",
          ":safeToRetry": "safe_to_retry",
          ":maxAttempts": WHATSAPP_WORKER_MAX_ATTEMPTS
        },
        ConditionExpression:
          "((#status = :queued OR #status = :queueUnavailable) AND " +
          "(attribute_not_exists(#retryCount) OR #retryCount < :maxAttempts)) OR " +
          "(#status = :sending AND (#sendAttemptDisposition = :safeToRetry OR #sendAttemptDisposition = :notStarted) AND #startedAt < :reclaimBefore AND " +
          "(attribute_not_exists(#retryCount) OR #retryCount < :maxAttempts))"
      }));
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  async markWhatsappCommandAttemptInFlight(commandId: string, attemptAt: string): Promise<boolean> {
    try {
      await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: whatsappCommandKeys(commandId),
        UpdateExpression: "SET #disposition = :inFlight, #updatedAt = :attemptAt",
        ExpressionAttributeNames: {
          "#status": "status",
          "#disposition": "sendAttemptDisposition",
          "#lastAttemptAt": "lastAttemptAt",
          "#updatedAt": "updatedAt"
        },
        ExpressionAttributeValues: {
          ":sending": "sending",
          ":notStarted": "not_started",
          ":inFlight": "in_flight",
          ":attemptAt": attemptAt
        },
        ConditionExpression:
          "#status = :sending AND #disposition = :notStarted AND #lastAttemptAt = :attemptAt"
      }));
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  async updateWhatsappFlow(
    invitationCode: string,
    values: WhatsappFlowUpdate,
    condition?: UpdateCondition
  ) {
    const expression = buildSetExpression(values);
    if (!expression) return;
    await this.documentClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: invitationKeys(invitationCode),
      UpdateExpression: expression.UpdateExpression,
      ExpressionAttributeNames: { ...expression.ExpressionAttributeNames, ...condition?.names },
      ExpressionAttributeValues: { ...expression.ExpressionAttributeValues, ...condition?.values },
      ConditionExpression: condition
        ? `attribute_exists(PK) AND (${condition.expression})`
        : "attribute_exists(PK)"
    }));
  }

  /**
   * Records the newest inbound message time, which the 24-hour free-text window is derived from.
   *
   * The condition makes the write monotonic: webhooks can be delivered out of order or replayed,
   * and an older provider timestamp must never pull the window backwards. A no-op condition
   * failure is the expected outcome in that case, not an error.
   */
  async touchWhatsappLastInboundAt(invitationCode: string, at: string): Promise<void> {
    try {
      await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: invitationKeys(invitationCode),
        UpdateExpression: "SET #a = :at",
        ExpressionAttributeNames: { "#a": "whatsappLastInboundAt" },
        ExpressionAttributeValues: { ":at": at },
        ConditionExpression: "attribute_exists(PK) AND (attribute_not_exists(#a) OR #a < :at)"
      }));
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return;
      throw error;
    }
  }

  /**
   * Conditional so a replayed webhook cannot silently replace an existing record. A duplicate
   * `wamid` is a dedupe signal, not an error.
   */
  async putWhatsappMessage(input: WhatsappMessageInput): Promise<{ created: boolean }> {
    const message = WhatsappMessageInputSchema.parse(input);
    const conversationIndex = message.correlationStatus === "matched" && message.invitationCode
      ? whatsappConversationMessageIndex(message.invitationCode, message.createdAt, message.messageId)
      : whatsappUnassignedMessageIndex(message.createdAt, message.messageId);
    try {
      await this.documentClient.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          ...message,
          ...whatsappMessageKeys(message.messageId),
          ...conversationIndex,
          entityType: "WhatsappMessage"
        },
        ConditionExpression: "attribute_not_exists(PK)"
      }));
      return { created: true };
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return { created: false };
      }
      throw error;
    }
  }

  /**
   * Finalizes a provider-accepted send without exposing transaction construction to callers.
   * The provider message ID is the message identity, so a retry can only succeed when the
   * command, message, and invitation already describe the same accepted send.
   */
  async finalizeAcceptedWhatsappSend(
    input: WhatsappAcceptedSendFinalizationInput
  ): Promise<WhatsappAcceptedSendFinalizationResult> {
    const message = WhatsappMessageInputSchema.parse(input.message);
    if (
      message.correlationStatus !== "matched" ||
      message.invitationCode !== input.invitationCode
    ) {
      return { outcome: "reconciliation_required", reason: "Accepted send message is not matched to its command invitation." };
    }
    const command = await this.getWhatsappCommand(input.commandId);
    if (!command || command.invitationCode !== input.invitationCode) {
      return { outcome: "reconciliation_required", reason: "Accepted send command is missing or mismatched." };
    }
    const legacyCommand = command as typeof command & { preserveFlowStatus?: boolean };
    const persistedEffect = command.effect ?? (legacyCommand.preserveFlowStatus === true ? "preserve" : "opener");
    const persistedExpectedFlowStatus = command.expectedFlowStatus ?? (persistedEffect === "opener" ? "sending" : undefined);
    if (persistedEffect !== input.effect ||
        (input.effect === "complete_on_send" && persistedExpectedFlowStatus !== input.expectedFlowStatus)) {
      return { outcome: "reconciliation_required", reason: "Accepted send effect or expected flow status does not match the command." };
    }

    const messageItem = {
      ...message,
      ...whatsappMessageKeys(message.messageId),
      ...whatsappConversationMessageIndex(message.invitationCode, message.createdAt, message.messageId),
      entityType: "WhatsappMessage"
    };
    const commandUpdate = {
      TableName: this.tableName,
      Key: whatsappCommandKeys(input.commandId),
      UpdateExpression:
        "SET #status = :sent, #providerMessageId = :providerMessageId, #sentAt = :sentAt, #updatedAt = :updatedAt, #reconciliationStatus = :none REMOVE #sendAttemptDisposition",
      ExpressionAttributeNames: {
        "#status": "status",
        "#providerMessageId": "providerMessageId",
        "#sentAt": "sentAt",
        "#updatedAt": "updatedAt",
        "#reconciliationStatus": "reconciliationStatus",
        "#sendAttemptDisposition": "sendAttemptDisposition"
      },
      ExpressionAttributeValues: {
        ":sent": "sent",
        ":providerMessageId": message.messageId,
        ":sentAt": input.now,
        ":updatedAt": input.now,
        ":none": "none",
        ":sending": "sending"
      },
      ConditionExpression: "attribute_exists(PK) AND #status = :sending"
    };

    const items: ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] = [
      {
        Put: {
          TableName: this.tableName,
          Item: messageItem,
          ConditionExpression: "attribute_not_exists(PK)"
        }
      },
      { Update: commandUpdate }
    ];

    if (input.effect === "opener") {
      items.push({
        Update: {
          TableName: this.tableName,
          Key: invitationKeys(input.invitationCode),
          UpdateExpression: "SET #status = :messageSent, #lastOutbound = :messageId, #updated = :updated",
          ExpressionAttributeNames: {
            "#status": "whatsappFlowStatus",
            "#lastOutbound": "whatsappLastOutboundMessageId",
            "#updated": "whatsappFlowUpdatedAt"
          },
          ExpressionAttributeValues: {
            ":messageSent": "message_sent",
            ":messageId": message.messageId,
            ":updated": input.now,
            ":sending": "sending"
          },
          ConditionExpression: "attribute_exists(PK) AND #status = :sending"
        }
      });
    } else if (input.effect === "complete_on_send") {
      if (!input.expectedFlowStatus) {
        throw new AppError("Complete-on-send finalization requires an expected flow status.", 500, "RECONCILIATION_REQUIRED");
      }
      items.push({
        Update: {
          TableName: this.tableName,
          Key: invitationKeys(input.invitationCode),
          UpdateExpression:
            "SET #status = :completed, #stage = :stage, #lastOutbound = :messageId, #updated = :updated, #completedAt = :updated",
          ExpressionAttributeNames: {
            "#status": "whatsappFlowStatus",
            "#stage": "whatsappFlowStage",
            "#lastOutbound": "whatsappLastOutboundMessageId",
            "#updated": "whatsappFlowUpdatedAt",
            "#completedAt": "whatsappFlowCompletedAt"
          },
          ExpressionAttributeValues: {
            ":completed": "completed",
            ":stage": message.stage,
            ":messageId": message.messageId,
            ":updated": input.now,
            ":expected": input.expectedFlowStatus
          },
          ConditionExpression: "attribute_exists(PK) AND #status = :expected"
        }
      });
    } else if (input.fallback) {
      items.push({
        Update: {
          TableName: this.tableName,
          Key: invitationKeys(input.invitationCode),
          UpdateExpression: "SET #fallback = :fallback",
          ExpressionAttributeNames: { "#fallback": "whatsappFallbackSentAt" },
          ExpressionAttributeValues: { ":fallback": input.now },
          ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(#fallback)"
        }
      });
    }

    try {
      await this.documentClient.send(new TransactWriteCommand({ TransactItems: items }));
      return { outcome: "applied" };
    } catch (error) {
      if (!(error instanceof TransactionCanceledException)) throw error;

      const [existingCommand, existingMessage, invitation] = await Promise.all([
        this.getWhatsappCommand(input.commandId),
        this.getWhatsappMessage(message.messageId),
        this.getInvitationByCode(input.invitationCode)
      ]);
      const commandMatches = existingCommand?.invitationCode === input.invitationCode &&
        existingCommand.status === "sent" && existingCommand.providerMessageId === message.messageId &&
        (existingCommand.effect ?? ((existingCommand as typeof existingCommand & { preserveFlowStatus?: boolean }).preserveFlowStatus === true ? "preserve" : "opener")) === input.effect &&
        (existingCommand.expectedFlowStatus ?? (input.effect === "opener" ? "sending" : undefined)) === input.expectedFlowStatus;
      const messageMatches = existingMessage?.invitationCode === input.invitationCode &&
        existingMessage.commandId === input.commandId && existingMessage.direction === "outbound" &&
        existingMessage.status === "sent";
      const invitationMatches = input.effect === "opener"
        ? invitation?.whatsappFlowStatus === "message_sent" && invitation.whatsappLastOutboundMessageId === message.messageId
        : input.effect === "complete_on_send"
          ? invitation?.whatsappFlowStatus === "completed" &&
            invitation.whatsappFlowCompletedAt === input.now &&
            invitation.whatsappLastOutboundMessageId === message.messageId
          : !input.fallback || Boolean(invitation?.whatsappFallbackSentAt);

      if (commandMatches && messageMatches && invitationMatches) return { outcome: "replayed" };
      return { outcome: "reconciliation_required", reason: "Accepted send finalization has partial or mismatched records." };
    }
  }

  async getWhatsappMessage(messageId: string): Promise<WhatsappMessageItem | undefined> {
    const result = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: whatsappMessageKeys(messageId),
      ConsistentRead: true
    }));
    if (!result.Item) return undefined;
    return parseStoredWhatsappItem(WhatsappMessageItemSchema, result.Item, "WhatsApp message");
  }

  /** Applies provider status evidence monotonically without creating phantom message records. */
  async applyWhatsappMessageStatus(
    messageId: string,
    input: WhatsappStatusApplicationInput
  ): Promise<WhatsappStatusApplicationResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.getWhatsappMessage(messageId);
      if (!current) return "missing";
      if (
        current.direction === "outbound" &&
        current.status === input.status &&
        current.statusUpdatedAt === input.statusUpdatedAt
      ) return "already_applied";
      if (!shouldApplyWhatsappStatus(current, input)) return "ignored";

      const names: Record<string, string> = {
        "#status": "status",
        "#statusUpdatedAt": "statusUpdatedAt",
        "#statusTimestampSource": "statusTimestampSource",
        "#updatedAt": "updatedAt"
      };
      const values: Record<string, unknown> = {
        ":status": input.status,
        ":statusUpdatedAt": input.statusUpdatedAt,
        ":statusTimestampSource": input.statusTimestampSource,
        ":updatedAt": input.updatedAt,
        ":expectedStatus": current.status
      };
      const setParts = [
        "#status = :status",
        "#statusUpdatedAt = :statusUpdatedAt",
        "#statusTimestampSource = :statusTimestampSource",
        "#updatedAt = :updatedAt"
      ];
      const removeParts: string[] = [];
      if (input.status === "failed") {
        for (const [field, value] of Object.entries({
          providerErrorCode: input.providerErrorCode,
          providerErrorTitle: input.providerErrorTitle,
          providerErrorCategory: input.providerErrorCategory
        })) {
          if (value === undefined) continue;
          const name = `#${field}`;
          const token = `:${field}`;
          names[name] = field;
          values[token] = value;
          setParts.push(`${name} = ${token}`);
        }
      } else {
        for (const field of ["providerErrorCode", "providerErrorTitle", "providerErrorCategory"]) {
          const name = `#${field}`;
          names[name] = field;
          removeParts.push(name);
        }
      }
      if (current.statusUpdatedAt) values[":expectedStatusUpdatedAt"] = current.statusUpdatedAt;

      try {
        await this.documentClient.send(new UpdateCommand({
          TableName: this.tableName,
          Key: whatsappMessageKeys(messageId),
          UpdateExpression: `SET ${setParts.join(", ")}${removeParts.length ? ` REMOVE ${removeParts.join(", ")}` : ""}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ConditionExpression:
            "attribute_exists(PK) AND #status = :expectedStatus AND " +
            (current.statusUpdatedAt
              ? "#statusUpdatedAt = :expectedStatusUpdatedAt"
              : "attribute_not_exists(#statusUpdatedAt)")
        }));
        return "applied";
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) throw error;
      }
    }
    throw new AppError(
      "WhatsApp message status changed concurrently too many times.",
      503,
      "WHATSAPP_STATUS_CONFLICT"
    );
  }

  /**
   * Chronological command + message timeline for one invitation, over the overloaded GSI1. The
   * message and command partitions are keyed by provider ID for point lookup, so this index
   * entry is the only way to list a conversation without a table scan.
   */
  async listWhatsappConversation(
    invitationCode: string,
    options: { limit?: number; cursor?: string | null; order?: "asc" | "desc" } = {}
  ) {
    const index = whatsappConversationIndexPrefix(invitationCode);
    const result = await this.documentClient.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: { ":gsi1pk": index.GSI1PK, ":prefix": index.GSI1SK },
      ExclusiveStartKey: decodeCursor(options.cursor, "WhatsApp conversation"),
      Limit: options.limit ?? 50,
      ScanIndexForward: (options.order ?? "asc") === "asc"
    }));

    const entries = ((result.Items ?? []) as ItemRecord[])
      .map((item): WhatsappConversationEntry =>
        item.entityType === "WhatsappCommand"
          ? parseStoredWhatsappItem(WhatsappCommandItemSchema, item, "WhatsApp command")
          : parseStoredWhatsappItem(WhatsappMessageItemSchema, item, "WhatsApp message")
      )
      .filter((entry) =>
        entry.invitationCode === invitationCode &&
        (entry.entityType === "WhatsappCommand" || entry.correlationStatus === "matched")
      );

    return {
      entries,
      nextCursor: encodeCursor(result.LastEvaluatedKey as ItemRecord | undefined)
    };
  }

  /** Internal operational view; unassigned content is never exposed by invitation APIs. */
  async listUnassignedWhatsappMessages(options: { limit?: number; cursor?: string | null } = {}) {
    const index = whatsappUnassignedMessageIndexPrefix();
    const result = await this.documentClient.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: { ":gsi1pk": index.GSI1PK, ":prefix": index.GSI1SK },
      ExclusiveStartKey: decodeCursor(options.cursor, "unassigned WhatsApp messages"),
      Limit: options.limit ?? 50
    }));

    return {
      entries: ((result.Items ?? []) as ItemRecord[]).map((item) =>
        parseStoredWhatsappItem(WhatsappMessageItemSchema, item, "WhatsApp message")
      ),
      nextCursor: encodeCursor(result.LastEvaluatedKey as ItemRecord | undefined)
    };
  }

  async getGuestProfilesByPhoneNumber(phoneNumber: string): Promise<GuestProfile[]> {
    const result = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI1_NAME,
        KeyConditionExpression: "GSI1PK = :gsi1pk and GSI1SK = :gsi1sk",
        ExpressionAttributeValues: {
          ":gsi1pk": phoneLookupIndex(phoneNumber).GSI1PK,
          ":gsi1sk": phoneLookupIndex(phoneNumber).GSI1SK
        }
      })
    );

    return (result.Items ?? []).map((item) => toGuestProfile(item as Record<string, unknown>));
  }

  async upsertRsvp(request: RsvpSubmissionRequest, status: GuestProfile["rsvpStatus"]) {
    const updatedAt = new Date().toISOString();
    const counts = deriveRsvpCounts(request);

    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...rsvpKeys(request.invitationCode),
          entityType: "RsvpResponse",
          invitationCode: request.invitationCode,
          submittedBy: request.submittedBy,
          guestResponses: request.guestResponses,
          attendingGuestCount: counts.attendingGuestCount,
          paidAttendingGuestCount: counts.paidAttendingGuestCount,
          childSixOrYoungerAttendingCount: counts.childSixOrYoungerAttendingCount,
          note: request.note,
          status,
          updatedAt
        }
      })
    );

    return updatedAt;
  }

  async listGuestMessages(cursor?: string | null, limit = 50) {
    const response = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: `${TABLE_PRIMARY_KEY} = :pk`,
        ExpressionAttributeValues: {
          ":pk": "GUEST_MESSAGES"
        },
        ExclusiveStartKey: decodeCursor(cursor, "guest messages"),
        Limit: limit,
        ScanIndexForward: false
      })
    );

    const messages = ((response.Items ?? []) as GuestMessageFeedItem[]).map((item) => ({
      messageId: item.messageId,
      authorName: item.authorName,
      message: item.message,
      createdAt: item.createdAt
    }));

    return {
      messages,
      nextCursor: encodeCursor(response.LastEvaluatedKey as ItemRecord | undefined)
    };
  }

  async createGuestMessage(input: CreateGuestMessageRequest): Promise<GuestMessage> {
    const createdAt = new Date().toISOString();
    const messageId = crypto.randomUUID();
    const feedKey = guestMessageFeedKey(createdAt, messageId);
    const lookupKey = guestMessageLookupKey(messageId);

    const message: GuestMessage = {
      messageId,
      authorName: input.authorName,
      message: input.message,
      createdAt
    };

    // The feed item and lookup item are independent puts (no read-modify-write
    // between them), so issue both concurrently to save a round trip.
    await Promise.all([
      this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...feedKey,
            entityType: "GuestMessage",
            ...message
          }
        })
      ),
      this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...lookupKey,
            entityType: "GuestMessageLookup",
            messageId,
            feedPK: feedKey.PK,
            feedSK: feedKey.SK
          }
        })
      )
    ]);

    return message;
  }

  async deleteGuestMessage(messageId: string) {
    const lookupResult = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: guestMessageLookupKey(messageId)
      })
    );

    const lookupItem = lookupResult.Item as GuestMessageLookupItem | undefined;
    if (!lookupItem) {
      throw new AppError("Guest message not found.", 404);
    }

    await this.documentClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: lookupItem.feedPK,
          SK: lookupItem.feedSK
        }
      })
    );

    await this.documentClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: guestMessageLookupKey(messageId)
      })
    );
  }

  /**
   * Claims an event for processing. The marker is written *before* the work happens, so it
   * records a lifecycle rather than only its own existence: without `processingStatus` a
   * redelivery after a mid-processing crash cannot tell "already handled" from "started and
   * died", and would discard the event forever. Pair with `markWebhookEventProcessed`.
   */
  async recordWebhookEventIfNew(
    provider: string,
    eventId: string,
    ttlInSeconds = WEBHOOK_EVENT_TTL_SECONDS,
    metadata: { eventType?: string; providerMessageId?: string; replayEvent?: string } = {}
  ) {
    const receivedAt = new Date().toISOString();
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...webhookKeys(provider, eventId),
            entityType: "WebhookEvent",
            provider,
            eventId,
            eventType: metadata.eventType,
            providerMessageId: metadata.providerMessageId,
            replayEvent: metadata.replayEvent,
            processingOutcome: "processed",
            processingStatus: "pending",
            attemptCount: 0,
            receivedAt,
            updatedAt: receivedAt,
            [TTL_ATTRIBUTE]: Math.floor(Date.now() / 1000) + ttlInSeconds
          },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );

      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }

      throw error;
    }
  }

  async getWebhookEvent(provider: string, eventId: string) {
    const result = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: webhookKeys(provider, eventId),
        ConsistentRead: true
      })
    );

    if (!result.Item) return undefined;
    return parseStoredWhatsappItem(WhatsappWebhookMarkerSchema, result.Item, "WhatsApp webhook marker");
  }

  async markWebhookEventProcessed(
    provider: string,
    eventId: string,
    outcome: {
      status: "processed" | "failed";
      failureReason?: string;
      rejectionReason?: string;
      retryDisposition?: "retryable" | "terminal";
    }
  ) {
    const updatedAt = new Date().toISOString();
    const expression = buildSetExpression({
      processingStatus: outcome.status,
      processedAt: updatedAt,
      updatedAt,
      failureReason: outcome.failureReason,
      processingOutcome: outcome.rejectionReason ? "rejected" : "processed",
      rejectionReason: outcome.rejectionReason,
      retryDisposition: outcome.retryDisposition
    });
    try {
      await this.documentClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: webhookKeys(provider, eventId),
          ...expression,
          ConditionExpression: "attribute_exists(PK)"
        })
      );

      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return false;
      }

      throw error;
    }
  }

  async claimWebhookEvent(provider: string, eventId: string, now: string, reclaimBefore: string) {
    try {
      await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: webhookKeys(provider, eventId),
        UpdateExpression: "SET processingStatus = :processing, processingStartedAt = :now, lastAttemptAt = :now, attemptCount = if_not_exists(attemptCount, :zero) + :one, updatedAt = :now",
        ExpressionAttributeValues: {
          ":processing": "processing", ":pending": "pending", ":failed": "failed", ":now": now,
          ":reclaimBefore": reclaimBefore, ":zero": 0, ":one": 1
        },
        ConditionExpression: "processingStatus = :pending OR processingStatus = :failed OR (processingStatus = :processing AND processingStartedAt < :reclaimBefore)"
      }));
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  async exportGuests(): Promise<AdminGuestExportRow[]> {
    const result = await this.documentClient.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression:
          "entityType = :invitationType OR entityType = :guestType OR entityType = :rsvpType",
        ExpressionAttributeValues: {
          ":invitationType": "Invitation",
          ":guestType": "InvitationGuest",
          ":rsvpType": "RsvpResponse"
        }
      })
    );

    const groups = new Map<
      string,
      { invitation?: ItemRecord; guests: ItemRecord[]; rsvp?: ItemRecord }
    >();

    for (const item of (result.Items ?? []) as ItemRecord[]) {
      const invitationCode = String(item.invitationCode ?? "");
      if (!invitationCode) {
        continue;
      }

      const group = groups.get(invitationCode) ?? { guests: [] };
      if (item.entityType === "Invitation") {
        group.invitation = item;
      } else if (item.entityType === "InvitationGuest") {
        group.guests.push(item);
      } else if (item.entityType === "RsvpResponse") {
        group.rsvp = item;
      }
      groups.set(invitationCode, group);
    }

    return [...groups.values()].flatMap((group) => {
      if (!group.invitation) {
        return [];
      }

      return toAdminExportRows({
        invitation: group.invitation,
        guests: group.guests,
        rsvp: group.rsvp
      });
    });
  }
}

function encodeCursor(lastEvaluatedKey?: ItemRecord) {
  if (!lastEvaluatedKey) {
    return null;
  }

  return Buffer.from(JSON.stringify(lastEvaluatedKey), "utf8").toString("base64");
}

function decodeCursor(cursor: string | null | undefined, label: string) {
  if (!cursor) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    return JSON.parse(decoded) as ItemRecord;
  } catch {
    throw new AppError(`Invalid ${label} cursor.`, 400);
  }
}

/**
 * Builds a dynamic `SET` update, dropping `undefined` values. Returns `null` when nothing is
 * left to set — an empty entry list would otherwise produce the malformed expression `"SET "`
 * and an empty attribute map, which DynamoDB rejects with a ValidationException.
 */
function buildSetExpression(values: Record<string, unknown>) {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return null;
  }

  return {
    UpdateExpression: `SET ${entries.map((_, index) => `#n${index} = :v${index}`).join(", ")}`,
    ExpressionAttributeNames: Object.fromEntries(
      entries.map(([key], index) => [`#n${index}`, key])
    ),
    ExpressionAttributeValues: Object.fromEntries(
      entries.map(([, value], index) => [`:v${index}`, value])
    )
  };
}
