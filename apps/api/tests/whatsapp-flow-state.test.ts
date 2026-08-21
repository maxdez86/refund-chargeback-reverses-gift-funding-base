import { describe, expect, it } from "vitest";
import { PublicHouseholdInvitationSchema, WHATSAPP_FLOW_STATUS_MEANINGS, WhatsappFlowStatusSchema } from "@brimax/contracts";
import {
  TERMINAL_FLOW_STATUSES,
  canTransition,
  isFlowCompleted,
  isTerminalFlowStatus
} from "../src/domain/whatsapp-flow-state";

describe("WhatsApp flow state", () => {
  it("documents every declared status", () => {
    for (const status of WhatsappFlowStatusSchema.options) {
      expect(WHATSAPP_FLOW_STATUS_MEANINGS[status]).toEqual(expect.any(String));
    }
  });

  it("uses the completion marker as the single completion test", () => {
    expect(isFlowCompleted({ whatsappFlowCompletedAt: undefined })).toBe(false);
    expect(isFlowCompleted({ whatsappFlowCompletedAt: "2026-08-17T12:00:00.000Z" })).toBe(true);
    expect(isFlowCompleted({ whatsappFlowCompletedAt: null })).toBe(false);
  });

  it("allows the active lifecycle and rejects terminal reopening", () => {
    expect(canTransition("idle", "send_queued")).toBe(true);
    expect(canTransition("send_queued", "message_sent")).toBe(false);
    expect(canTransition("sending", "message_sent")).toBe(true);
    expect(canTransition("message_sent", "response_received")).toBe(true);
    expect(canTransition("attendance_declined", "completed")).toBe(true);
    expect(canTransition("attendance_declined", "message_sent")).toBe(false);
    expect(canTransition("website_followup_pending", "failed")).toBe(true);
    expect(canTransition("website_update_required", "send_queued")).toBe(false);
    expect(canTransition("completed", "response_received")).toBe(false);
    expect(TERMINAL_FLOW_STATUSES.every(isTerminalFlowStatus)).toBe(true);
  });

  it("strips operational flow state from the public invitation contract", () => {
    const publicInvitation = PublicHouseholdInvitationSchema.parse({
      invitationCode: "SW2748",
      householdName: "Eugênia Ribeiro",
      phoneNumber: "5511963656517",
      whatsappFlowStatus: "message_sent",
      guests: [{ guestId: "g1", guestName: "Eugênia", allowedPlusOnes: 0, rsvpStatus: "pending" }]
    });
    expect(publicInvitation).not.toHaveProperty("phoneNumber");
    expect(publicInvitation).not.toHaveProperty("whatsappFlowStatus");
  });
});
