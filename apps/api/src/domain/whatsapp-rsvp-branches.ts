import type { HouseholdInvitation, WhatsappFlowStatus, WhatsappRsvpAction, WhatsappRsvpTemplatePurpose } from "@brimax/contracts";
import { actionForButtonId } from "../services/whatsapp/template-manifest";
import { canTransition, isTerminalFlowStatus } from "./whatsapp-flow-state";
import {
  selectWhatsappAttendanceFollowupTemplate,
  selectWhatsappDeclinedFollowupTemplate,
  selectWhatsappUndecidedFollowupTemplate
} from "./whatsapp-rsvp-template-selection";

export type WhatsappBranchDecision =
  | { kind: "fallback"; action?: undefined }
  | { kind: "branch"; action: WhatsappRsvpAction; status: WhatsappFlowStatus; templateId?: WhatsappRsvpTemplatePurpose; conflict?: string }
  | { kind: "rejected"; reason: "terminal_flow" | "invalid_transition" | "consistency_conflict" };

export function decideWhatsappRsvpBranch(
  invitation: HouseholdInvitation,
  buttonId: string | undefined,
  currentStatus: WhatsappFlowStatus
): WhatsappBranchDecision {
  const action = buttonId === undefined ? undefined : actionForButtonId(buttonId);
  if (!action) return { kind: "fallback" };

  if (isTerminalFlowStatus(currentStatus)) return { kind: "rejected", reason: "terminal_flow" };

  const confirmed = invitation.guests.some((guest) => guest.rsvpStatus === "attending");
  const decision: Extract<WhatsappBranchDecision, { kind: "branch" }> = action === "confirm_all"
    ? { kind: "branch", action, status: "attendance_confirmed_whatsapp", templateId: selectWhatsappAttendanceFollowupTemplate(invitation) }
    : action === "attend_all"
      ? { kind: "branch", action, status: "attendance_confirmed_whatsapp", templateId: selectWhatsappAttendanceFollowupTemplate(invitation) }
      : action === "decline"
        ? { kind: "branch", action, status: "attendance_declined", templateId: selectWhatsappDeclinedFollowupTemplate(invitation) }
        : { kind: "branch", action, status: "undecided", templateId: selectWhatsappUndecidedFollowupTemplate(invitation) };

  if (!canTransition(currentStatus, decision.status)) {
    return { kind: "rejected", reason: "invalid_transition" };
  }
  if ((decision.action === "confirm_all" && !confirmed) || (decision.action !== "confirm_all" && confirmed)) {
    return { kind: "rejected", reason: "consistency_conflict" };
  }
  return decision;
}
