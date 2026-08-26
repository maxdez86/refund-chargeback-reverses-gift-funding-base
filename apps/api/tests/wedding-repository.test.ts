import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WEBHOOK_EVENT_TTL_SECONDS,
  WHATSAPP_WEBHOOK_EVENT_TTL_SECONDS,
  WeddingRepository
} from "../src/services/dynamodb/repositories/wedding-repository";

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

  describe("atomic RSVP and WhatsApp reservations", () => {
    const request = {
      invitationCode: "ABCD2345",
      submittedBy: "guest-01",
      guestResponses: [{ guestId: "guest-01", status: "attending" as const, isChildSixOrYounger: false }],
      attendingGuestCount: 1
    };
    const operation = {
      websiteOperationId: "website-operation-1",
      websitePayloadDigest: "a".repeat(64),
      websiteIdempotencyKeyDigest: "b".repeat(64)
    };

    it("reserves a WhatsApp branch outcome and complete-on-send command in one transaction", async () => {
      const send = vi.fn().mockResolvedValue({});
      const repository = new WeddingRepository({ send } as never, "table-test");

      await repository.reserveWhatsappBranch({
        invitationCode: "ABCD2345",
        expectedStatus: "message_sent",
        status: "attendance_confirmed_whatsapp",
        lastInboundMessageId: "wamid.inbound",
        updatedAt: "2026-08-19T12:00:00.000Z",
        attendance: [{ guestId: "guest-01", status: "attending", recordedAt: "2026-08-19T12:00:00.000Z" }],
        command: {
          commandId: "branch-command",
          invitationCode: "ABCD2345",
          templateId: "wedding_rsvp_attending_followup_single",
          templateVersion: 1,
          status: "queued",
          stage: "followup",
          effect: "complete_on_send",
          expectedFlowStatus: "attendance_confirmed_whatsapp",
          createdAt: "2026-08-19T12:00:00.000Z"
        }
      });

      const transaction = send.mock.calls[0][0] as TransactWriteCommand;
      expect(transaction.input.TransactItems).toHaveLength(2);
      expect(transaction.input.TransactItems?.[0]?.Update).toMatchObject({
        Key: { PK: "INVITATION#ABCD2345", SK: "INVITATION" },
        ConditionExpression: "attribute_exists(PK) AND #status = :expected"
      });
      expect(transaction.input.TransactItems?.[0]?.Update?.ExpressionAttributeValues).toMatchObject({
        ":expected": "message_sent",
        ":status": "attendance_confirmed_whatsapp"
      });
      expect(transaction.input.TransactItems?.[1]?.Put).toMatchObject({
        Item: expect.objectContaining({
          PK: "WHATSAPP_COMMAND#branch-command",
          effect: "complete_on_send",
          expectedFlowStatus: "attendance_confirmed_whatsapp"
        }),
        ConditionExpression: "attribute_not_exists(PK)"
      });
    });

    it("stores website RSVP, pending flow, and follow-up command atomically", async () => {
      const send = vi.fn().mockResolvedValue({});
      const repository = new WeddingRepository({ send } as never, "table-test");

      await repository.reserveWebsiteRsvp({
        request,
        status: "attending",
        operation,
        expectedWebsiteOperationId: operation.websiteOperationId,
        updatedAt: "2026-08-19T12:00:00.000Z",
        expectedStatus: "message_sent",
        command: {
          commandId: "website-operation-1",
          invitationCode: "ABCD2345",
          templateId: "wedding_rsvp_attending_followup_website_single",
          templateVersion: 1,
          status: "queued",
          stage: "followup",
          effect: "complete_on_send",
          expectedFlowStatus: "website_followup_pending",
          createdAt: "2026-08-19T12:00:00.000Z"
        }
      });

      const transaction = send.mock.calls[0][0] as TransactWriteCommand;
      expect(transaction.input.TransactItems).toHaveLength(3);
      expect(transaction.input.TransactItems?.[0]?.Put).toMatchObject({
        Item: expect.objectContaining({
          PK: "INVITATION#ABCD2345",
          SK: "RSVP#CURRENT",
          websiteOperationId: "website-operation-1",
          websitePayloadDigest: "a".repeat(64)
        }),
        ConditionExpression: expect.stringContaining("#operation")
      });
      expect(transaction.input.TransactItems?.[1]?.Update).toMatchObject({
        ConditionExpression: "attribute_exists(PK) AND #status = :expected",
        ExpressionAttributeValues: expect.objectContaining({
          ":expected": "message_sent",
          ":pending": "website_followup_pending"
        })
      });
      expect(transaction.input.TransactItems?.[2]?.Put?.ConditionExpression).toBe("attribute_not_exists(PK)");
    });

    it("writes an RSVP-only item with an idempotency condition", async () => {
      const send = vi.fn().mockResolvedValue({});
      const repository = new WeddingRepository({ send } as never, "table-test");

      await repository.writeRsvpOnly({ request, status: "attending", operation, expectedWebsiteOperationId: operation.websiteOperationId, updatedAt: "2026-08-19T12:00:00.000Z" });

      const command = send.mock.calls[0][0] as PutCommand;
      expect(command.input.ConditionExpression).toContain("#operation");
      expect(command.input.Item).toEqual(expect.objectContaining({
        PK: "INVITATION#ABCD2345",
        SK: "RSVP#CURRENT",
        websiteIdempotencyKeyDigest: "b".repeat(64)
      }));
    });
  });

  describe("listAdminDashboardInvitations", () => {
    const invitation = (invitationCode: string, householdName: string) => ({
      PK: `INVITATION#${invitationCode}`,
      SK: "INVITATION",
      entityType: "Invitation",
      invitationCode,
      householdName
    });
    const guest = (invitationCode: string, guestId: string, guestName: string, sortOrder?: number) => ({
      PK: `INVITATION#${invitationCode}`,
      SK: `GUEST#${guestId}`,
      entityType: "InvitationGuest",
      invitationCode,
      guestId,
      guestName,
      sortOrder,
      allowedPlusOnes: 0,
      rsvpStatus: "pending"
    });

    it("maps a single page with current RSVP data", async () => {
      const send = vi.fn().mockResolvedValue({
        Items: [
          invitation("AB2345", "Amanda e Chris"),
          { ...guest("AB2345", "g2", "Chris", 2), isChild: false },
          { ...guest("AB2345", "g1", "Amanda", 1), isChild: true, dietaryNotes: "Sem lactose" },
          {
            PK: "INVITATION#AB2345",
            SK: "RSVP#CURRENT",
            entityType: "RsvpResponse",
            invitationCode: "AB2345",
            submittedBy: "g1",
            guestResponses: [
              { guestId: "g1", status: "attending", isChildSixOrYounger: true },
              { guestId: "g2", status: "declined", isChildSixOrYounger: false }
            ],
            attendingGuestCount: 1,
            paidAttendingGuestCount: 0,
            childSixOrYoungerAttendingCount: 1,
            note: "Música sugerida: Dreams",
            status: "attending",
            updatedAt: "2026-08-20T12:00:00.000Z"
          }
        ]
      });
      const repository = new WeddingRepository({ send } as never, "table-test");

      const result = await repository.listAdminDashboardInvitations();

      const command = send.mock.calls[0][0] as ScanCommand;
      expect(command.input.FilterExpression).toContain("entityType = :invitationType");
      expect(command.input.ProjectionExpression).toContain("guestResponses");
      expect(command.input.ProjectionExpression).not.toContain("websitePayloadDigest");
      expect(result).toEqual([{
        invitationCode: "AB2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "attending",
            isChild: true,
            isChildSixOrYounger: true,
            dietaryNotes: "Sem lactose"
          },
          {
            guestId: "g2",
            guestName: "Chris",
            allowedPlusOnes: 0,
            rsvpStatus: "declined",
            isChild: false,
            isChildSixOrYounger: false
          }
        ],
        rsvp: {
          status: "attending",
          updatedAt: "2026-08-20T12:00:00.000Z",
          submittedBy: "g1",
          attending: 1,
          paid: 0,
          childrenSixOrYounger: 1,
          note: "Música sugerida: Dreams"
        }
      }]);
    });

    const whatsappMessage = (
      invitationCode: string,
      messageId: string,
      overrides: Record<string, unknown> = {}
    ) => ({
      PK: `INVITATION#${invitationCode}`,
      SK: `WHATSAPP#MESSAGE#${messageId}`,
      entityType: "WhatsappMessage",
      invitationCode,
      messageId,
      direction: "inbound",
      messageType: "text",
      correlationStatus: "matched",
      status: "received",
      createdAt: "2026-08-20T12:00:00.000Z",
      ...overrides
    });

    it("filters and projects exactly the attributes the conversation summary needs", async () => {
      const send = vi.fn().mockResolvedValue({ Items: [] });
      const repository = new WeddingRepository({ send } as never, "table-test");

      await repository.listAdminDashboardInvitations();

      const command = send.mock.calls[0][0] as ScanCommand;
      expect(command.input.FilterExpression).toBe(
        "entityType = :invitationType OR entityType = :guestType OR entityType = :rsvpType OR entityType = :messageType"
      );
      expect(command.input.ExpressionAttributeValues).toEqual({
        ":invitationType": "Invitation",
        ":guestType": "InvitationGuest",
        ":rsvpType": "RsvpResponse",
        ":messageType": "WhatsappMessage"
      });
      for (const attribute of [
        "messageId", "direction", "messageType", "templateId", "buttonId", "body", "correlationStatus", "createdAt"
      ]) {
        expect(command.input.ProjectionExpression?.split(", ")).toContain(attribute);
      }
      // `status` stays behind the single existing alias; no second alias is introduced.
      expect(command.input.ExpressionAttributeNames).toEqual({ "#note": "note", "#status": "status" });
      expect(command.input.ProjectionExpression?.split(", ").filter((name) => name === "#status"))
        .toHaveLength(1);
      // Nothing a summary does not need leaks into the projection.
      for (const attribute of [
        "recipientPhone", "senderPhone", "replyContextMessageId",
        "providerErrorCode", "providerErrorTitle", "commandId", "templateVersion"
      ]) {
        expect(command.input.ProjectionExpression?.split(", ")).not.toContain(attribute);
      }
    });

    it("summarizes matched messages and omits the field when an invitation has none", async () => {
      const send = vi.fn().mockResolvedValue({
        Items: [
          invitation("AB2345", "Amanda e Chris"),
          guest("AB2345", "g1", "Amanda", 1),
          invitation("CD6789", "Família C"),
          guest("CD6789", "g3", "Carla", 1),
          whatsappMessage("AB2345", "m1", {
            direction: "outbound",
            messageType: "template",
            templateId: "wedding_invitation",
            status: "delivered",
            createdAt: "2026-08-20T12:00:00.000Z"
          }),
          whatsappMessage("AB2345", "m2", { createdAt: "2026-08-20T12:05:00.000Z", body: "Vamos sim!" }),
          whatsappMessage("AB2345", "m3", {
            createdAt: "2026-08-20T12:06:00.000Z",
            correlationStatus: "ambiguous_sender"
          }),
          {
            PK: "INVITATION#AB2345",
            SK: "WHATSAPP#COMMAND#cmd-1",
            entityType: "WhatsappCommand",
            invitationCode: "AB2345",
            commandId: "cmd-1",
            templateId: "wedding_invitation",
            status: "sent",
            createdAt: "2026-08-20T12:07:00.000Z"
          }
        ]
      });
      const repository = new WeddingRepository({ send } as never, "table-test");

      const result = await repository.listAdminDashboardInvitations();

      expect(result[0]?.whatsappConversation).toEqual({
        messageCount: 2,
        unreadCount: 1,
        lastMessageAt: "2026-08-20T12:05:00.000Z",
        lastMessageDirection: "inbound",
        lastMessageType: "text",
        lastMessagePreview: "Vamos sim!",
        lastOutboundMessageTemplateId: "wedding_invitation",
        lastInboundMessagePreview: "Vamos sim!"
      });
      expect(result[1]?.whatsappConversation).toBeUndefined();
      expect(JSON.stringify(result[1])).not.toContain("Vamos sim!");
    });

    it("accumulates message items across every scan page, including a message-only page", async () => {
      const lastEvaluatedKey = { PK: "PAGE#1", SK: "PAGE#1" };
      const send = vi.fn()
        .mockResolvedValueOnce({
          Items: [invitation("AB2345", "Amanda"), guest("AB2345", "g1", "Amanda", 1)],
          LastEvaluatedKey: lastEvaluatedKey
        })
        .mockResolvedValueOnce({
          Items: [
            whatsappMessage("AB2345", "m1", { direction: "outbound", createdAt: "2026-08-20T12:00:00.000Z" }),
            whatsappMessage("AB2345", "m2", { createdAt: "2026-08-20T12:01:00.000Z" })
          ],
          LastEvaluatedKey: { PK: "PAGE#2", SK: "PAGE#2" }
        })
        .mockResolvedValueOnce({
          Items: [whatsappMessage("AB2345", "m3", { createdAt: "2026-08-20T12:02:00.000Z", body: "Última" })]
        });
      const repository = new WeddingRepository({ send } as never, "table-test");

      const result = await repository.listAdminDashboardInvitations();

      expect(send).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(1);
      expect(result[0]?.whatsappConversation).toMatchObject({
        messageCount: 3,
        unreadCount: 2,
        lastMessageAt: "2026-08-20T12:02:00.000Z",
        lastMessagePreview: "Última"
      });
    });

    it("drops a message whose invitation is absent and logs skipped records once", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const send = vi.fn().mockResolvedValue({
        Items: [
          invitation("AB2345", "Amanda"),
          guest("AB2345", "g1", "Amanda", 1),
          whatsappMessage("ORPHAN1", "orphan-1", { body: "Sem convite" }),
          whatsappMessage("AB2345", "broken-1", { createdAt: undefined }),
          whatsappMessage("AB2345", "broken-2", { direction: undefined })
        ]
      });
      const repository = new WeddingRepository({ send } as never, "table-test");

      const result = await repository.listAdminDashboardInvitations();

      expect(result.map((item) => item.invitationCode)).toEqual(["AB2345"]);
      expect(result[0]?.whatsappConversation).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("Sem convite");
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(warn.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      expect(logged).toEqual({
        metric: "ADMIN_DASHBOARD_WHATSAPP_MESSAGE_RECORD_SKIPPED",
        skippedMessageRecords: 2
      });
      warn.mockRestore();
    });

    it("drains pages before grouping and sorts invitations and malformed guest orders", async () => {
      const lastEvaluatedKey = { PK: "PAGE#1", SK: "PAGE#1" };
      const send = vi.fn()
        .mockResolvedValueOnce({
          Items: [
            invitation("CD6789", "Família C"),
            guest("AB2345", "g2", "B guest"),
            guest("ORPHAN1", "orphan", "Orphan", 1)
          ],
          LastEvaluatedKey: lastEvaluatedKey
        })
        .mockResolvedValueOnce({
          Items: [
            invitation("AB2345", "Família A"),
            guest("AB2345", "g1", "A guest"),
            guest("CD6789", "g3", "C guest", 1)
          ]
        });
      const repository = new WeddingRepository({ send } as never, "table-test");

      const result = await repository.listAdminDashboardInvitations();

      expect(send).toHaveBeenCalledTimes(2);
      expect((send.mock.calls[0][0] as ScanCommand).input.ExclusiveStartKey).toBeUndefined();
      expect((send.mock.calls[1][0] as ScanCommand).input.ExclusiveStartKey).toBe(lastEvaluatedKey);
      expect(result.map((item) => item.invitationCode)).toEqual(["AB2345", "CD6789"]);
      expect(result[0]?.guests.map((item) => item.guestId)).toEqual(["g1", "g2"]);
      expect(result[0]?.rsvp).toEqual({
        status: "pending",
        updatedAt: null,
        submittedBy: null,
        attending: 0,
        paid: 0,
        childrenSixOrYounger: 0
      });
    });

    it("propagates DynamoDB and malformed persisted-record failures", async () => {
      const failure = new Error("DynamoDB unavailable");
      const failedRepository = new WeddingRepository(
        { send: vi.fn().mockRejectedValue(failure) } as never,
        "table-test"
      );
      await expect(failedRepository.listAdminDashboardInvitations()).rejects.toBe(failure);

      const malformedRepository = new WeddingRepository({
        send: vi.fn().mockResolvedValue({
          Items: [{
            ...invitation("AB2345", "Amanda"),
            whatsappFlowUpdatedAt: "not-a-timestamp"
          }, guest("AB2345", "g1", "Amanda", 1)]
        })
      } as never, "table-test");
      await expect(malformedRepository.listAdminDashboardInvitations()).rejects.toThrow();

      const malformedCategoryRepository = new WeddingRepository({
        send: vi.fn().mockResolvedValue({
          Items: [
            invitation("AB2345", "Amanda"),
            { ...guest("AB2345", "g1", "Amanda", 1), rsvpStatus: "future-status" }
          ]
        })
      } as never, "table-test");
      await expect(malformedCategoryRepository.listAdminDashboardInvitations()).rejects.toThrow();
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

describe("WeddingRepository webhook event markers", () => {
  beforeEach(() => {
    process.env.WEDDING_TABLE_NAME = "brimax-wedding-test";
  });

  it("claims an event as pending so a crashed run is distinguishable from a handled one", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new WeddingRepository({ send } as never, "table-test");

    await expect(
      repository.recordWebhookEventIfNew("whatsapp", "evt-1", WHATSAPP_WEBHOOK_EVENT_TTL_SECONDS, {
        eventType: "button_reply",
        providerMessageId: "wamid.ABC"
      })
    ).resolves.toBe(true);

    const command = send.mock.calls[0][0] as PutCommand;
    expect(command.input.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(command.input.Item).toMatchObject({
      PK: "WEBHOOK#whatsapp",
      SK: "EVENT#evt-1",
      entityType: "WebhookEvent",
      processingStatus: "pending",
      eventType: "button_reply",
      providerMessageId: "wamid.ABC"
    });
  });

  it("keeps the 24h default and the false-on-duplicate contract for the Asaas caller", async () => {
    const start = Math.floor(Date.now() / 1000);
    const send = vi.fn().mockResolvedValue({});
    const repository = new WeddingRepository({ send } as never, "table-test");

    await repository.recordWebhookEventIfNew("asaas", "evt-2");

    const ttl = (send.mock.calls[0][0] as PutCommand).input.Item?.ttl as number;
    expect(WEBHOOK_EVENT_TTL_SECONDS).toBe(86_400);
    expect(ttl).toBeGreaterThanOrEqual(start + WEBHOOK_EVENT_TTL_SECONDS);
    expect(ttl).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + WEBHOOK_EVENT_TTL_SECONDS);

    const duplicate = vi.fn().mockRejectedValue(
      new ConditionalCheckFailedException({ message: "failed", $metadata: {} })
    );
    const duplicateRepository = new WeddingRepository({ send: duplicate } as never, "table-test");
    await expect(duplicateRepository.recordWebhookEventIfNew("asaas", "evt-2")).resolves.toBe(false);
  });

  it("outlives Meta's retry window for WhatsApp events", () => {
    // A 24h marker can expire while a Meta retry is still in flight, letting the same event be
    // processed a second time and fire a duplicate follow-up send.
    expect(WHATSAPP_WEBHOOK_EVENT_TTL_SECONDS).toBeGreaterThan(7 * 86_400);
  });

  it("marks an event processed, guarded so it cannot create a marker", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new WeddingRepository({ send } as never, "table-test");

    await expect(
      repository.markWebhookEventProcessed("whatsapp", "evt-1", { status: "processed" })
    ).resolves.toBe(true);

    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(command.input.Key).toEqual({ PK: "WEBHOOK#whatsapp", SK: "EVENT#evt-1" });
    expect(command.input.ConditionExpression).toBe("attribute_exists(PK)");
    expect(Object.values(command.input.ExpressionAttributeNames ?? {})).toEqual([
      "processingStatus",
      "processedAt",
      "updatedAt",
      "processingOutcome"
    ]);
    expect(command.input.ExpressionAttributeValues?.[":v0"]).toBe("processed");
  });

  it("records a failure reason when processing failed", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new WeddingRepository({ send } as never, "table-test");

    await repository.markWebhookEventProcessed("whatsapp", "evt-1", {
      status: "failed",
      failureReason: "template no longer active"
    });

    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(Object.values(command.input.ExpressionAttributeNames ?? {})).toContain("failureReason");
    expect(command.input.ExpressionAttributeValues?.[":v3"]).toBe("template no longer active");
  });

  it("records a durable rejection reason without changing marker status", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new WeddingRepository({ send } as never, "table-test");

    await repository.markWebhookEventProcessed("whatsapp", "evt-1", {
      status: "processed", rejectionReason: "terminal_flow"
    });

    const command = send.mock.calls[0][0] as UpdateCommand;
    expect(Object.values(command.input.ExpressionAttributeNames ?? {})).toContain("rejectionReason");
    expect(Object.values(command.input.ExpressionAttributeValues ?? {})).toContain("rejected");
    expect(Object.values(command.input.ExpressionAttributeValues ?? {})).toContain("terminal_flow");
  });

  it("reads a marker back consistently", async () => {
    const send = vi.fn().mockResolvedValue({
      Item: { PK: "WEBHOOK#whatsapp", SK: "EVENT#evt-1", processingStatus: "pending" }
    });
    const repository = new WeddingRepository({ send } as never, "table-test");

    const result = await repository.getWebhookEvent("whatsapp", "evt-1");

    const command = send.mock.calls[0][0] as GetCommand;
    expect(command.input.ConsistentRead).toBe(true);
    expect(result?.processingStatus).toBe("pending");
  });
});
