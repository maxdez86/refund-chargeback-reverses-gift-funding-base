import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  type DynamoDBDocumentClient
} from "@aws-sdk/lib-dynamodb";
import type {
  CreateGuestMessageRequest,
  GuestMessage,
  AdminGuestExportRow,
  GuestProfile,
  HouseholdInvitation,
  RsvpSubmissionRequest
} from "@brimax/contracts";
import { dynamoDbDocumentClient } from "../client";
import {
  guestMessageFeedKey,
  guestMessageLookupKey,
  invitationKeys,
  phoneLookupIndex,
  rsvpKeys,
  webhookKeys
} from "../key-builder";
import { GSI1_NAME, TABLE_PRIMARY_KEY, TTL_ATTRIBUTE } from "../table";
import { getEnv } from "../../../lib/env";
import { AppError } from "../../../lib/errors";
import { deriveRsvpCounts, toAdminExportRows, toGuestProfile, toHouseholdInvitation } from "../mappers";
import { createTracedAwsClient } from "../../../lib/xray";

type ItemRecord = Record<string, unknown>;
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
        ExclusiveStartKey: decodeGuestMessagesCursor(cursor),
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
      nextCursor: encodeGuestMessagesCursor(response.LastEvaluatedKey as ItemRecord | undefined)
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

  async recordWebhookEventIfNew(provider: string, eventId: string, ttlInSeconds = 86_400) {
    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...webhookKeys(provider, eventId),
            entityType: "WebhookEvent",
            provider,
            eventId,
            receivedAt: new Date().toISOString(),
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

function encodeGuestMessagesCursor(lastEvaluatedKey?: ItemRecord) {
  if (!lastEvaluatedKey) {
    return null;
  }

  return Buffer.from(JSON.stringify(lastEvaluatedKey), "utf8").toString("base64");
}

function decodeGuestMessagesCursor(cursor?: string | null) {
  if (!cursor) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    return JSON.parse(decoded) as ItemRecord;
  } catch {
    throw new AppError("Invalid guest messages cursor.", 400);
  }
}
