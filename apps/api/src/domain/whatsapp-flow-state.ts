import type { WhatsappFlowStatus } from "@brimax/contracts";

export const TERMINAL_FLOW_STATUSES = [
  "website_update_required",
  "completed",
  "failed",
  "reconciliation_required"
] as const satisfies readonly WhatsappFlowStatus[];

const transitions: Record<WhatsappFlowStatus, readonly WhatsappFlowStatus[]> = {
  idle: ["send_queued"],
  send_queued: ["sending", "website_followup_pending", "failed", "reconciliation_required"],
  sending: ["message_sent", "website_followup_pending", "failed", "reconciliation_required"],
  message_sent: [
    "response_received", "attendance_confirmed_whatsapp", "attendance_declined",
    "website_followup_pending", "undecided", "failed", "reconciliation_required"
  ],
  response_received: [
    "attendance_confirmed_whatsapp",
    "attendance_declined",
    "website_followup_pending",
    "undecided",
    "failed",
    "reconciliation_required"
  ],
  attendance_confirmed_whatsapp: ["completed", "failed", "reconciliation_required"],
  attendance_declined: ["completed", "failed", "reconciliation_required"],
  website_followup_pending: ["completed", "failed", "reconciliation_required"],
  website_update_required: [],
  undecided: ["completed", "failed", "reconciliation_required"],
  completed: [],
  failed: [],
  reconciliation_required: []
};

export function canTransition(from: WhatsappFlowStatus | undefined, to: WhatsappFlowStatus): boolean {
  return transitions[from ?? "idle"].includes(to);
}

export function assertTransition(from: WhatsappFlowStatus | undefined, to: WhatsappFlowStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid WhatsApp flow transition: ${from ?? "idle"} -> ${to}`);
  }
}

export function isTerminalFlowStatus(status: WhatsappFlowStatus): boolean {
  return (TERMINAL_FLOW_STATUSES as readonly string[]).includes(status);
}

/** Completion is represented by the durable marker, not by the business outcome status. */
export function isFlowCompleted(input: { whatsappFlowCompletedAt?: string | null }): boolean {
  return typeof input.whatsappFlowCompletedAt === "string" && input.whatsappFlowCompletedAt.length > 0;
}

export function transitionCondition(expected: WhatsappFlowStatus | undefined) {
  if (expected === "idle") {
    return {
      expression: "attribute_not_exists(#c0) OR #c0 = :c0",
      names: { "#c0": "whatsappFlowStatus" },
      values: { ":c0": expected }
    };
  }
  return {
    expression: expected ? "#c0 = :c0" : "attribute_not_exists(#c0)",
    names: { "#c0": "whatsappFlowStatus" },
    values: expected ? { ":c0": expected } : {}
  };
}
