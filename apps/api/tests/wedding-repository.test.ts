import { GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WeddingRepository } from "../src/services/dynamodb/repositories/wedding-repository";

describe("WeddingRepository", () => {
  beforeEach(() => {
    process.env.WEDDING_TABLE_NAME = "brimax-wedding-test";
  });

  describe("getInvitationByCode", () => {
    it("returns the household with embedded guests when the item exists", async () => {
      const send = vi.fn().mockResolvedValue({
        Item: {
          PK: "INVITATION#ABCD2345",
          SK: "INVITATION",
          entityType: "Invitation",
          invitationCode: "ABCD2345",
          householdId: "grupo-amanda-cris",
          householdName: "Amanda e Chris",
          guests: [
            {
              guestId: "grupo-amanda-cris--amanda",
              guestName: "Amanda",
              allowedPlusOnes: 0,
              rsvpStatus: "pending",
              isChildSixOrYounger: true
            },
            {
              guestId: "grupo-amanda-cris--chris",
              guestName: "Chris",
              allowedPlusOnes: 0,
              rsvpStatus: "attending"
            }
          ]
        }
      });
      const repository = new WeddingRepository({ send } as never, "table-test");

      const result = await repository.getInvitationByCode("ABCD2345");

      const command = send.mock.calls[0][0] as GetCommand;
      expect(command.input.Key).toEqual({
        PK: "INVITATION#ABCD2345",
        SK: "INVITATION"
      });
      expect(command.input.TableName).toBe("table-test");
      expect(result).toEqual({
        invitationCode: "ABCD2345",
        householdId: "grupo-amanda-cris",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "grupo-amanda-cris--amanda",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending",
            isChildSixOrYounger: true
          },
          {
            guestId: "grupo-amanda-cris--chris",
            guestName: "Chris",
            allowedPlusOnes: 0,
            rsvpStatus: "attending"
          }
        ]
      });
    });

    it("returns null when nothing matches", async () => {
      const send = vi.fn().mockResolvedValue({});
      const repository = new WeddingRepository({ send } as never, "table-test");

      const result = await repository.getInvitationByCode("MISSING1");

      expect(result).toBeNull();
    });
  });

  describe("upsertRsvp", () => {
    it("writes the rsvp item with the derived status", async () => {
      const send = vi.fn().mockResolvedValue({});
      const repository = new WeddingRepository({ send } as never, "table-test");

      await repository.upsertRsvp(
        {
          invitationCode: "ABCD2345",
          householdId: "grupo-amanda-cris",
          submittedBy: "grupo-amanda-cris--amanda",
          guestResponses: [
            {
              guestId: "grupo-amanda-cris--amanda",
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
          PK: "HOUSEHOLD#grupo-amanda-cris",
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
    it("flattens embedded guests into one export row per guest", async () => {
      const send = vi.fn().mockResolvedValue({
        Items: [
          {
            entityType: "Invitation",
            invitationCode: "ABCD2345",
            householdId: "grupo-amanda-cris",
            householdName: "Amanda e Chris",
            guests: [
              {
                guestId: "g1",
                guestName: "Amanda",
                allowedPlusOnes: 0,
                rsvpStatus: "pending",
                isChildSixOrYounger: true
              },
              {
                guestId: "g2",
                guestName: "Chris",
                allowedPlusOnes: 0,
                rsvpStatus: "attending"
              }
            ]
          },
          {
            entityType: "RsvpResponse",
            householdId: "grupo-amanda-cris",
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
      expect(command.input.FilterExpression).toBe("entityType = :invitationType OR entityType = :rsvpType");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        householdId: "grupo-amanda-cris",
        guestId: "g1",
        invitationCode: "ABCD2345",
        guestName: "Amanda",
        phoneNumber: undefined,
        rsvpStatus: "pending",
        allowedPlusOnes: 0,
        attending: true,
        isChildSixOrYoungerSeed: true,
        isChildSixOrYoungerConfirmed: true
      });
      expect(rows[1].guestName).toBe("Chris");
      expect(rows[1].rsvpStatus).toBe("attending");
      expect(rows[1].attending).toBe(false);
    });
  });
});
