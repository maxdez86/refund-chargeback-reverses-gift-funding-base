import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  type DynamoDBDocumentClient
} from "@aws-sdk/lib-dynamodb";
import type {
  AdminGuestExportRow,
  GuestProfile,
  HouseholdInvitation,
  RsvpSubmissionRequest
} from "@brimax/contracts";
import { dynamoDbDocumentClient } from "../client";
import {
  invitationKeys,
  phoneLookupIndex,
  rsvpKeys,
  webhookKeys
} from "../key-builder";
import { GSI1_NAME, TABLE_PRIMARY_KEY, TTL_ATTRIBUTE } from "../table";
import { getEnv } from "../../../lib/env";
import { deriveRsvpCounts, toAdminExportRows, toGuestProfile, toHouseholdInvitation } from "../mappers";

type ItemRecord = Record<string, unknown>;

export class WeddingRepository {
  constructor(
    private readonly documentClient: DynamoDBDocumentClient = dynamoDbDocumentClient,
    private readonly tableName = getEnv().weddingTableName
  ) {}

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
          status,
          updatedAt
        }
      })
    );

    return updatedAt;
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
