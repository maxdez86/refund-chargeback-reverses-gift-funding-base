import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
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
  AdminGuestExportRow,
  GuestProfile,
  HouseholdInvitation,
  RsvpSubmissionRequest,
  WhatsappFlowStage,
  WhatsappFlowStatus
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
import { GSI1_NAME, TABLE_PRIMARY_KEY, TABLE_SORT_KEY, TTL_ATTRIBUTE } from "../table";
import { getEnv } from "../../../lib/env";
import { AppError } from "../../../lib/errors";
import {
  deriveRsvpCounts,
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
export type WhatsappMessageUpdate = Partial<Omit<WhatsappMessageInput, "messageId">>;
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
        ProjectionExpression:
          "invitationCode, phoneNumber, phoneNumberUpdatedAt, phoneNumberSource, whatsappFlowStatus, whatsappFlowStage, whatsappLastOutboundMessageId, whatsappLastInboundMessageId, whatsappFlowUpdatedAt, whatsappFlowCompletedAt, whatsappFallbackSentAt, whatsappFailureReason, entityType"
      })
    );
    const invitation = (result.Items ?? []).find((item) => item.entityType === "Invitation") as
      | ItemRecord
      | undefined;
    return invitation ? toWhatsappRsvpStatus(invitation) : null;
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

  async reserveWhatsappCommand(input: WhatsappCommandInput, expectedStatus: WhatsappFlowStatus | undefined) {
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
          UpdateExpression: "SET #s = :sendQueued, #stage = :stage, #updated = :updated",
          ExpressionAttributeNames: {
            "#s": "whatsappFlowStatus",
            "#stage": "whatsappFlowStage",
            "#updated": "whatsappFlowUpdatedAt"
          },
          ExpressionAttributeValues: {
            ":sendQueued": "send_queued",
            ":stage": command.stage,
            ":updated": command.createdAt,
            ":expected": expectedStatus
          },
          ConditionExpression: expectedStatus === "idle"
            ? "attribute_exists(PK) AND (attribute_not_exists(#s) OR #s = :expected)"
            : "attribute_exists(PK) AND #s = :expected"
        }
      });
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
          "#retryCount = if_not_exists(#retryCount, :zero) + :one",
        ExpressionAttributeNames: {
          "#status": "status",
          "#startedAt": "startedAt",
          "#lastAttemptAt": "lastAttemptAt",
          "#lastAttemptReceiveCount": "lastAttemptReceiveCount",
          "#updatedAt": "updatedAt",
          "#retryCount": "retryCount"
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
          ":maxAttempts": WHATSAPP_WORKER_MAX_ATTEMPTS
        },
        ConditionExpression:
          "((#status = :queued OR #status = :queueUnavailable) AND " +
          "(attribute_not_exists(#retryCount) OR #retryCount < :maxAttempts)) OR " +
          "(#status = :sending AND #startedAt < :reclaimBefore AND " +
          "(attribute_not_exists(#retryCount) OR #retryCount < :maxAttempts))"
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
   * Conditional so a replayed webhook cannot silently replace an existing record. A duplicate
   * `wamid` is a dedupe signal, not an error.
   */
  async putWhatsappMessage(input: WhatsappMessageInput): Promise<{ created: boolean }> {
    const message = WhatsappMessageInputSchema.parse(input);
    try {
      await this.documentClient.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          ...message,
          ...whatsappMessageKeys(message.messageId),
          ...whatsappConversationMessageIndex(
            message.invitationCode,
            message.createdAt,
            message.messageId
          ),
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

  async getWhatsappMessage(messageId: string): Promise<WhatsappMessageItem | undefined> {
    const result = await this.documentClient.send(new GetCommand({
      TableName: this.tableName,
      Key: whatsappMessageKeys(messageId),
      ConsistentRead: true
    }));
    if (!result.Item) return undefined;
    return parseStoredWhatsappItem(WhatsappMessageItemSchema, result.Item, "WhatsApp message");
  }

  /**
   * Guarded by `attribute_exists(PK)`: an unguarded UpdateItem on a missing key would CREATE a
   * stub holding only the status, which then blocks the real conditional put of the message
   * record. A status webhook that outruns the send returns `{ applied: false }` instead.
   */
  async updateWhatsappMessage(
    messageId: string,
    values: WhatsappMessageUpdate
  ): Promise<{ applied: boolean }> {
    const expression = buildSetExpression(values);
    if (!expression) return { applied: false };
    try {
      await this.documentClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: whatsappMessageKeys(messageId),
        ...expression,
        ConditionExpression: "attribute_exists(PK)"
      }));
      return { applied: true };
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return { applied: false };
      }
      throw error;
    }
  }

  /**
   * Chronological command + message timeline for one invitation, over the overloaded GSI1. The
   * message and command partitions are keyed by provider ID for point lookup, so this index
   * entry is the only way to list a conversation without a table scan.
   */
  async listWhatsappConversation(
    invitationCode: string,
    options: { limit?: number; cursor?: string | null } = {}
  ) {
    const index = whatsappConversationIndexPrefix(invitationCode);
    const result = await this.documentClient.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: { ":gsi1pk": index.GSI1PK, ":prefix": index.GSI1SK },
      ExclusiveStartKey: decodeCursor(options.cursor, "WhatsApp conversation"),
      Limit: options.limit ?? 50
    }));

    const entries = ((result.Items ?? []) as ItemRecord[]).map((item): WhatsappConversationEntry =>
      item.entityType === "WhatsappCommand"
        ? parseStoredWhatsappItem(WhatsappCommandItemSchema, item, "WhatsApp command")
        : parseStoredWhatsappItem(WhatsappMessageItemSchema, item, "WhatsApp message")
    );

    return {
      entries,
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
    outcome: { status: "processed" | "failed"; failureReason?: string; rejectionReason?: string }
  ) {
    const updatedAt = new Date().toISOString();
    const expression = buildSetExpression({
      processingStatus: outcome.status,
      processedAt: updatedAt,
      updatedAt,
      failureReason: outcome.failureReason,
      processingOutcome: outcome.rejectionReason ? "rejected" : "processed",
      rejectionReason: outcome.rejectionReason
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
