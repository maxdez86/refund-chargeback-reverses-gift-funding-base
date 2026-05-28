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
import { GSI1_NAME, TTL_ATTRIBUTE } from "../table";
import { getEnv } from "../../../lib/env";
import { deriveRsvpCounts, toAdminExportRows, toGuestProfile, toHouseholdInvitation } from "../mappers";

export class WeddingRepository {
  constructor(
    private readonly documentClient: DynamoDBDocumentClient = dynamoDbDocumentClient,
    private readonly tableName = getEnv().weddingTableName
  ) {}

  async getInvitationByCode(invitationCode: string): Promise<HouseholdInvitation | null> {
    const result = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: invitationKeys(invitationCode)
      })
    );

    return result.Item ? toHouseholdInvitation(result.Item as Record<string, unknown>) : null;
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
          ...rsvpKeys(request.householdId),
          entityType: "RsvpResponse",
          invitationCode: request.invitationCode,
          householdId: request.householdId,
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
        FilterExpression: "entityType = :invitationType OR entityType = :rsvpType",
        ExpressionAttributeValues: {
          ":invitationType": "Invitation",
          ":rsvpType": "RsvpResponse"
        }
      })
    );

    const invitations = (result.Items ?? []).filter(
      (item) => item.entityType === "Invitation"
    ) as Record<string, unknown>[];
    const rsvps = (result.Items ?? []).filter(
      (item) => item.entityType === "RsvpResponse"
    ) as Record<string, unknown>[];
    const rsvpByHouseholdId = new Map(
      rsvps.map((item) => [String(item.householdId ?? ""), item])
    );

    return invitations.flatMap((item) =>
      toAdminExportRows({
        ...item,
        rsvpGuestResponses:
          rsvpByHouseholdId.get(String(item.householdId ?? ""))?.guestResponses ?? []
      })
    );
  }
}
