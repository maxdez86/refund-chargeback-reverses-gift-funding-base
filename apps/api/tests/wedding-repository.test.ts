import { PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WeddingRepository } from "../src/services/dynamodb/repositories/wedding-repository";

describe("WeddingRepository", () => {
  beforeEach(() => {
    process.env.WEDDING_TABLE_NAME = "brimax-wedding-test";
  });

  describe("getInvitationByCode", () => {
    it("returns the invitation with guest items when the partition exists", async () => {
      const send = vi.fn().mockResolvedValue({
        Items: [
          {
            PK: "INVITATION#ABCD2345",
            SK: "INVITATION",
            entityType: "Invitation",
            invitationCode: "ABCD2345",
            householdName: "Amanda e Chris"
          },
          {
            PK: "INVITATION#ABCD2345",
            SK: "GUEST#ABCD2345--guest-01",
            entityType: "InvitationGuest",
            invitationCode: "ABCD2345",
            guestId: "ABCD2345--guest-01",
            guestName: "Amanda",
            sortOrder: 1,
            allowedPlusOnes: 0,
            rsvpStatus: "pending",
            isChild: true
          },
          {
            PK: "INVITATION#ABCD2345",
            SK: "GUEST#ABCD2345--guest-02",
            entityType: "InvitationGuest",
            invitationCode: "ABCD2345",
            guestId: "ABCD2345--guest-02",
            guestName: "Chris",
            sortOrder: 2,
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      });
      const repository = new WeddingRepository({ send } as never, "table-test");

      const result = await repository.getInvitationByCode("ABCD2345");

      const command = send.mock.calls[0][0] as QueryCommand;
      expect(command.input.ExpressionAttributeValues).toEqual({
        ":pk": "INVITATION#ABCD2345"
      });
      expect(command.input.TableName).toBe("table-test");
      expect(result).toEqual({
        invitationCode: "ABCD2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "ABCD2345--guest-01",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending",
            isChild: true
          },
          {
            guestId: "ABCD2345--guest-02",
            guestName: "Chris",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      });
    });

    it("overlays the current RSVP data onto the invitation guests", async () => {
      const send = vi.fn().mockResolvedValue({
        Items: [
          {
            PK: "INVITATION#ABCD2345",
            SK: "INVITATION",
            entityType: "Invitation",
            invitationCode: "ABCD2345",
            householdName: "Amanda e Chris"
          },
          {
            PK: "INVITATION#ABCD2345",
            SK: "GUEST#ABCD2345--guest-01",
            entityType: "InvitationGuest",
            invitationCode: "ABCD2345",
            guestId: "ABCD2345--guest-01",
            guestName: "Amanda",
            sortOrder: 1,
            allowedPlusOnes: 0,
            rsvpStatus: "pending",
            isChild: true
          },
          {
            PK: "INVITATION#ABCD2345",
            SK: "GUEST#ABCD2345--guest-02",
            entityType: "InvitationGuest",
            invitationCode: "ABCD2345",
            guestId: "ABCD2345--guest-02",
            guestName: "Chris",
            sortOrder: 2,
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          },
          {
            PK: "INVITATION#ABCD2345",
            SK: "RSVP#CURRENT",
            entityType: "RsvpResponse",
            invitationCode: "ABCD2345",
            guestResponses: [
              {
                guestId: "ABCD2345--guest-01",
                status: "attending",
                isChildSixOrYounger: true
              },
              {
                guestId: "ABCD2345--guest-02",
                status: "declined",
                isChildSixOrYounger: false
              }
            ]
          }
        ]
      });
      const repository = new WeddingRepository({ send } as never, "table-test");

      const result = await repository.getInvitationByCode("ABCD2345");

      expect(result?.guests).toEqual([
        {
          guestId: "ABCD2345--guest-01",
          guestName: "Amanda",
          allowedPlusOnes: 0,
          rsvpStatus: "attending",
          isChild: true,
          isChildSixOrYounger: true
        },
        {
          guestId: "ABCD2345--guest-02",
          guestName: "Chris",
          allowedPlusOnes: 0,
          rsvpStatus: "declined",
          isChildSixOrYounger: false
        }
      ]);
    });

    it("returns null when the invitation metadata item is missing", async () => {
      const send = vi.fn().mockResolvedValue({ Items: [] });
      const repository = new WeddingRepository({ send } as never, "table-test");

      const result = await repository.getInvitationByCode("MISSING1");

      expect(result).toBeNull();
    });
  });

  describe("upsertRsvp", () => {
    it("writes the rsvp item keyed by invitation code", async () => {
      const send = vi.fn().mockResolvedValue({});
      const repository = new WeddingRepository({ send } as never, "table-test");

      await repository.upsertRsvp(
        {
          invitationCode: "ABCD2345",
          submittedBy: "ABCD2345--guest-01",
          guestResponses: [
            {
              guestId: "ABCD2345--guest-01",
              status: "attending",
              isChildSixOrYounger: true
            }
          ],
          attendingGuestCount: 1
        },
        "attending"
      );

      const command = send.mock.calls[0][0] as PutCommand;
      expect(command.input.Item).toEqual(
        expect.objectContaining({
          PK: "INVITATION#ABCD2345",
          SK: "RSVP#CURRENT",
          entityType: "RsvpResponse",
          invitationCode: "ABCD2345",
          status: "attending",
          attendingGuestCount: 1,
          paidAttendingGuestCount: 0,
          childSixOrYoungerAttendingCount: 1
        })
      );
    });
  });

  describe("exportGuests", () => {
    it("flattens guest items and overlays RSVP state per invitation code", async () => {
      const send = vi.fn().mockResolvedValue({
        Items: [
          {
            entityType: "Invitation",
            invitationCode: "ABCD2345",
            householdName: "Amanda e Chris"
          },
          {
            entityType: "InvitationGuest",
            invitationCode: "ABCD2345",
            guestId: "g1",
            guestName: "Amanda",
            sortOrder: 1,
            allowedPlusOnes: 0,
            rsvpStatus: "pending",
            isChild: true
          },
          {
            entityType: "InvitationGuest",
            invitationCode: "ABCD2345",
            guestId: "g2",
            guestName: "Chris",
            sortOrder: 2,
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          },
          {
            entityType: "RsvpResponse",
            invitationCode: "ABCD2345",
            guestResponses: [
              {
                guestId: "g1",
                status: "attending",
                isChildSixOrYounger: true
              },
              {
                guestId: "g2",
                status: "declined",
                isChildSixOrYounger: false
              }
            ]
          }
        ]
      });
      const repository = new WeddingRepository({ send } as never, "table-test");

      const rows = await repository.exportGuests();

      const command = send.mock.calls[0][0] as ScanCommand;
      expect(command.input.FilterExpression).toBe(
        "entityType = :invitationType OR entityType = :guestType OR entityType = :rsvpType"
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        householdName: "Amanda e Chris",
        guestId: "g1",
        invitationCode: "ABCD2345",
        guestName: "Amanda",
        phoneNumber: undefined,
        rsvpStatus: "attending",
        allowedPlusOnes: 0,
        attending: true,
        isChildSeed: true,
        isChildSixOrYoungerConfirmed: true
      });
      expect(rows[1]).toEqual(
        expect.objectContaining({
          householdName: "Amanda e Chris",
          guestName: "Chris",
          rsvpStatus: "declined",
          attending: false
        })
      );
    });
  });
});
