import type { SQSEvent } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { WhatsappApiError } from "../src/services/whatsapp/client";
import { createWhatsappRsvpWorker } from "../src/functions/whatsapp-rsvp-worker/handler";
import { WHATSAPP_FALLBACK_TEMPLATE_ID, WHATSAPP_FALLBACK_TEXT } from "../src/domain/whatsapp-rsvp-service";
import { WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID } from "../src/domain/whatsapp-text-commands";

const invitation = {
  invitationCode: "SW2748", householdName: "Household", phoneNumber: "5511963656517",
  whatsappFlowStatus: "send_queued" as const,
  guests: [{ guestId: "g1", guestName: "Ana", allowedPlusOnes: 0, rsvpStatus: "pending" as const }]
};
const definition = {
  purpose: "wedding_rsvp_pending_reminder_group", name: "wedding_rsvp_pending_reminder_group", language: "pt_BR",
  version: 1, parameterFormat: "named" as const,
  components: [{ type: "body" as const, parameters: [{ key: "household_name", type: "text" as const }] }],
  createdAt: "2026-08-15T12:00:00.000Z"
};

function command(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "command-1", invitationCode: "SW2748", templateId: "wedding_rsvp_pending_reminder_group",
    templateVersion: 1, stage: "pending" as const, status: "queued" as const,
    retryCount: 0, startedAt: undefined, expectedFlowStatus: "send_queued", ...overrides
  };
}

function record(commandId = "command-1", messageId = "message-1", count = "1") {
  return { messageId, body: JSON.stringify({ commandId }), attributes: { ApproximateReceiveCount: count } } as never;
}

function setup(overrides: Record<string, unknown> = {}) {
  const state = { command: command(), invitation: { ...invitation }, ...overrides } as unknown as {
    command: ReturnType<typeof command>;
    invitation: typeof invitation;
  };
  const repository = {
    getWhatsappCommand: vi.fn().mockImplementation(async () => state.command),
    getInvitationByCode: vi.fn().mockImplementation(async () => state.invitation),
    claimWhatsappCommand: vi.fn().mockImplementation(async (_id, input) => {
      if (state.command.status === "sent" || state.command.status === "failed" || state.command.status === "reconciliation_required") return false;
      const old = state.command.status === "sending";
      if (old && (
        !["safe_to_retry", "not_started"].includes(String(state.command.sendAttemptDisposition)) ||
        !state.command.startedAt || state.command.startedAt >= input.reclaimBefore || state.command.retryCount >= 5
      )) return false;
      state.command = {
        ...state.command,
        status: "sending",
        sendAttemptDisposition: "not_started",
        startedAt: input.now,
        lastAttemptAt: input.now,
        retryCount: (state.command.retryCount ?? 0) + 1
      };
      return true;
    }),
    markWhatsappCommandAttemptInFlight: vi.fn().mockImplementation(async (_id, attemptAt) => {
      if (
        state.command.status !== "sending" ||
        state.command.sendAttemptDisposition !== "not_started" ||
        state.command.lastAttemptAt !== attemptAt
      ) return false;
      state.command = { ...state.command, sendAttemptDisposition: "in_flight" };
      return true;
    }),
    updateWhatsappCommand: vi.fn().mockImplementation(async (_id, values) => { state.command = { ...state.command, ...values }; }),
    updateWhatsappFlow: vi.fn().mockImplementation(async (_id, values, condition) => {
      const expected = condition?.values?.[":c0"] ?? condition?.values?.[":status"];
      if (typeof expected === "string" && state.invitation.whatsappFlowStatus !== expected) {
        throw new ConditionalCheckFailedException({ message: "stale flow", $metadata: {} });
      }
      state.invitation = { ...state.invitation, ...values };
    }),
    finalizeAcceptedWhatsappSend: vi.fn().mockImplementation(async (input) => {
      state.command = { ...state.command, status: "sent", providerMessageId: input.message.messageId, sentAt: input.now, updatedAt: input.now };
      if (input.effect === "opener") {
        state.invitation = { ...state.invitation, whatsappFlowStatus: "message_sent", whatsappLastOutboundMessageId: input.message.messageId, whatsappFlowUpdatedAt: input.now };
      } else if (input.effect === "complete_on_send") {
        state.invitation = { ...state.invitation, whatsappFlowStatus: "completed", whatsappFlowStage: input.message.stage, whatsappFlowCompletedAt: input.now, whatsappLastOutboundMessageId: input.message.messageId, whatsappFlowUpdatedAt: input.now };
      } else if (input.fallback) {
        state.invitation = { ...state.invitation, whatsappFallbackSentAt: input.now };
      }
      return { outcome: "applied" };
    })
  };
  const sender = { send: vi.fn().mockResolvedValue({ messageId: "wamid.1" }) };
  const textSender = {
    sendText: vi.fn().mockImplementation(async (_input, _context, onAccepted) =>
      onAccepted({ messageId: "wamid.text" })
    )
  };
  const templates = { getVersion: vi.fn().mockResolvedValue(definition) };
  const logs: Record<string, unknown>[] = [];
  const handler = createWhatsappRsvpWorker({
    repository: repository as never, sender: sender as never, textSender, templates,
    now: () => "2026-08-17T12:00:00.000Z", log: (entry) => logs.push(entry)
  });
  return { handler, repository, sender, textSender, templates, state, logs };
}

describe("WhatsApp RSVP worker", () => {
  it("sends a redelivered command exactly once", async () => {
    const { handler, sender } = setup();
    const event = { Records: [record()] } as unknown as SQSEvent;
    await handler(event);
    await handler(event);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("sends the purpose stored on the command even when invitation state changes", async () => {
    const { handler, sender } = setup({
      command: command({
        templateId: "wedding_rsvp_reconfirmation_single",
        stage: "reconfirmation"
      }),
      invitation: {
        ...invitation,
        guests: [
          { guestId: "g1", guestName: "Ana", allowedPlusOnes: 0, rsvpStatus: "attending" as const },
          { guestId: "g2", guestName: "Bruno", allowedPlusOnes: 0, rsvpStatus: "pending" as const }
        ]
      }
    });
    await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "wedding_rsvp_reconfirmation_single" }),
      expect.anything(),
      definition
    );
  });

  it.each([
    ["wedding_rsvp_reconfirmation_single", "reconfirmation"],
    ["wedding_rsvp_pending_reminder_group", "pending"]
  ] as const)("sends the persisted %s purpose without completing an opener", async (templateId, stage) => {
    const { handler, sender, state } = setup({ command: command({ templateId, stage }) });

    await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ purpose: templateId }), expect.anything(), definition);
    expect(state.invitation.whatsappFlowStatus).toBe("message_sent");
    expect(state.invitation.whatsappFlowCompletedAt).toBeUndefined();
  });

  it("completes a matching complete-on-send follow-up only after provider success", async () => {
    const { handler, sender, state } = setup({
      command: command({
        effect: "complete_on_send",
        expectedFlowStatus: "attendance_declined",
        stage: "followup",
        templateId: "wedding_rsvp_declined_followup_single"
      }),
      invitation: { ...invitation, whatsappFlowStatus: "attendance_declined" as const }
    });

    await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(state.invitation.whatsappFlowStatus).toBe("completed");
    expect(state.invitation.whatsappFlowStage).toBe("followup");
    expect(state.invitation.whatsappFlowCompletedAt).toBe("2026-08-17T12:00:00.000Z");
  });

  it("does not send a complete-on-send command after its expected status is stale", async () => {
    const { handler, sender, state } = setup({
      command: command({ effect: "complete_on_send", expectedFlowStatus: "attendance_declined" }),
      invitation: { ...invitation, whatsappFlowStatus: "completed" as const }
    });

    await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(sender.send).not.toHaveBeenCalled();
    expect(state.command.status).toBe("reconciliation_required");
    expect(state.invitation.whatsappFlowStatus).toBe("completed");
  });

  it("does not let an opener overwrite a website-winning flow", async () => {
    const { handler, sender, state } = setup({
      command: command({ effect: "opener", expectedFlowStatus: "send_queued" }),
      invitation: { ...invitation, whatsappFlowStatus: "website_followup_pending" as const }
    });

    await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(sender.send).not.toHaveBeenCalled();
    expect(state.invitation.whatsappFlowStatus).toBe("website_followup_pending");
    expect(state.command.status).toBe("reconciliation_required");
  });

  it.each(["sent", "sending", "reconciliation_required"])("skips a command already %s", async (status) => {
    const { handler, sender } = setup({ command: command({ status, startedAt: "2026-08-17T11:59:00.000Z" }) });
    await handler({ Records: [record()] } as unknown as SQSEvent);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("reclaims stale sending commands and increments the attempt", async () => {
    const { handler, sender, state } = setup({ command: command({ status: "sending", sendAttemptDisposition: "safe_to_retry", retryCount: 1, startedAt: "2026-08-17T11:55:00.000Z" }) });
    await handler({ Records: [record()] } as unknown as SQSEvent);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(state.command.retryCount).toBe(2);
  });

  it("reclaims a stale not-started attempt because Meta was never called", async () => {
    const { handler, sender, state } = setup({
      command: command({
        status: "sending",
        sendAttemptDisposition: "not_started",
        retryCount: 1,
        startedAt: "2026-08-17T11:55:00.000Z"
      }),
      invitation: { ...invitation, whatsappFlowStatus: "sending" as const }
    });

    await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(sender.send).toHaveBeenCalledOnce();
    expect(state.command.status).toBe("sent");
  });

  it("reclaims a sending command when its queue visibility has just expired", async () => {
    const { handler, sender, state } = setup({
      command: command({ status: "sending", sendAttemptDisposition: "safe_to_retry", retryCount: 1, startedAt: "2026-08-17T11:58:00.000Z" })
    });
    await handler({ Records: [record()] } as unknown as SQSEvent);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(state.command.status).toBe("sent");
  });

  it("retries a reclaimed opener already in sending state", async () => {
    const { handler, sender, state } = setup({
      command: command({ status: "sending", sendAttemptDisposition: "safe_to_retry", retryCount: 1, startedAt: "2026-08-17T11:55:00.000Z" }),
      invitation: { ...invitation, whatsappFlowStatus: "sending" as const }
    });
    await handler({ Records: [record()] } as unknown as SQSEvent);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(state.invitation.whatsappFlowStatus).toBe("message_sent");
  });

  it("reconciles a stale command after the attempt budget is exhausted", async () => {
    const { handler, sender, state, logs } = setup({
      command: command({ status: "sending", sendAttemptDisposition: "safe_to_retry", retryCount: 5, startedAt: "2026-08-17T11:55:00.000Z" }),
      invitation: { ...invitation, whatsappFlowStatus: "sending" as const }
    });
    await handler({ Records: [record()] } as unknown as SQSEvent);
    expect(sender.send).not.toHaveBeenCalled();
    expect(state.command.status).toBe("reconciliation_required");
    expect(logs.some((entry) => entry.metric === "WHATSAPP_RSVP_WORKER_RECONCILIATION_REQUIRED")).toBe(true);
  });

  it("reconciles a stale in-flight attempt instead of resending it", async () => {
    const { handler, sender, state } = setup({
      command: command({
        status: "sending",
        sendAttemptDisposition: "in_flight",
        retryCount: 1,
        startedAt: "2026-08-17T11:55:00.000Z"
      }),
      invitation: { ...invitation, whatsappFlowStatus: "sending" as const }
    });

    await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(sender.send).not.toHaveBeenCalled();
    expect(state.command.status).toBe("reconciliation_required");
  });

  it("returns only retryable records as batch failures", async () => {
    const { handler, sender } = setup();
    sender.send
      .mockRejectedValueOnce(new WhatsappApiError("rate limited", "rate_limited", 429, true, 130429))
      .mockResolvedValueOnce({ messageId: "wamid.2" });
    const result = await handler({ Records: [record("command-1", "bad"), record("command-1", "good")] } as unknown as SQSEvent);
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "bad" }] });
    // The second copy is the same command and is correctly suppressed by the claim guard.
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("isolates an unexpected record failure and continues the batch", async () => {
    const { handler, repository, sender, state } = setup();
    repository.getWhatsappCommand
      .mockRejectedValueOnce(new Error("DynamoDB unavailable"))
      .mockImplementation(async () => state.command);

    const result = await handler({
      Records: [record("command-bad", "bad"), record("command-1", "good")]
    } as unknown as SQSEvent);

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "bad" }] });
    expect(sender.send).toHaveBeenCalledOnce();
  });

  it("leaves a pre-provider template lookup failure safe to retry", async () => {
    const { handler, templates, sender, state } = setup();
    templates.getVersion.mockRejectedValue(new Error("DynamoDB unavailable"));

    const result = await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(sender.send).not.toHaveBeenCalled();
    expect(state.command).toMatchObject({
      status: "sending",
      sendAttemptDisposition: "not_started"
    });
  });

  it("marks the exact attempt in flight before invoking Meta", async () => {
    const { handler, repository, sender } = setup();

    await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(repository.markWhatsappCommandAttemptInFlight).toHaveBeenCalledWith(
      "command-1",
      "2026-08-17T12:00:00.000Z"
    );
    expect(repository.markWhatsappCommandAttemptInFlight.mock.invocationCallOrder[0]).toBeLessThan(
      sender.send.mock.invocationCallOrder[0]!
    );
  });

  it("does not call Meta after losing exact attempt ownership", async () => {
    const { handler, repository, sender } = setup();
    repository.markWhatsappCommandAttemptInFlight.mockResolvedValue(false);

    const result = await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(result).toEqual({ batchItemFailures: [] });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("fails a permanent provider rejection without redrive", async () => {
    const { handler, sender, state } = setup();
    sender.send.mockRejectedValue(new WhatsappApiError("invalid template", "invalid_request", 400, false, 132000));

    const result = await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(result).toEqual({ batchItemFailures: [] });
    expect(state.command.status).toBe("failed");
    expect(sender.send).toHaveBeenCalledOnce();
  });

  it("fails permanently without redrive for missing phone", async () => {
    const { handler, sender, state, repository } = setup({ invitation: { ...invitation, phoneNumber: undefined } });
    const result = await handler({ Records: [record()] } as unknown as SQSEvent);
    expect(result).toEqual({ batchItemFailures: [] });
    expect(sender.send).not.toHaveBeenCalled();
    expect(state.command.status).toBe("failed");
    expect(repository.updateWhatsappCommand).toHaveBeenCalledWith(
      "command-1",
      expect.objectContaining({ status: "failed" }),
      expect.objectContaining({ names: { "#c0": "status" }, values: { ":c0": "sending" } })
    );
  });

  it("reconciles ambiguous provider failures without redrive", async () => {
    const { handler, sender, state } = setup();
    sender.send.mockRejectedValue(new WhatsappApiError("unknown", "network", undefined, false));
    const result = await handler({ Records: [record()] } as unknown as SQSEvent);
    expect(result).toEqual({ batchItemFailures: [] });
    expect(state.command.status).toBe("reconciliation_required");
    expect(state.invitation.whatsappFlowStatus).toBe("reconciliation_required");
  });

  it("does not retry a provider-accepted send when local finalization fails", async () => {
    const { handler, sender, state, repository } = setup();
    repository.finalizeAcceptedWhatsappSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const result = await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(result).toEqual({ batchItemFailures: [] });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(state.command.status).toBe("reconciliation_required");
    expect(state.invitation.whatsappFlowStatus).toBe("reconciliation_required");
  });

  it("treats an idempotent finalization replay as a successful send", async () => {
    const { handler, sender, repository, logs } = setup();
    repository.finalizeAcceptedWhatsappSend.mockResolvedValueOnce({ outcome: "replayed" });

    await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(logs).toContainEqual(expect.objectContaining({
      metric: "WHATSAPP_RSVP_WORKER_OUTCOME",
      outcome: "finalization_replayed",
      effect: "opener"
    }));
  });

  it("does not log phone numbers or message content", async () => {
    const { handler, logs } = setup();
    await handler({ Records: [record()] } as unknown as SQSEvent);
    const serialized = JSON.stringify(logs);
    expect(serialized).toContain("SW2748");
    expect(serialized).not.toContain(invitation.phoneNumber);
    expect(serialized).not.toContain("Household");
  });

  it("sends fallback text through the outbound worker without changing RSVP flow metadata", async () => {
    const { handler, sender, textSender, state, repository } = setup({
      command: command({ templateId: WHATSAPP_FALLBACK_TEMPLATE_ID, stage: "fallback", preserveFlowStatus: true }),
      invitation: { ...invitation, whatsappFlowStatus: "message_sent" as const, whatsappLastOutboundMessageId: "wamid.rsvp" }
    });
    await handler({ Records: [record()] } as unknown as SQSEvent);
    expect(sender.send).not.toHaveBeenCalled();
    expect(textSender.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: { body: WHATSAPP_FALLBACK_TEXT } }),
      expect.anything(),
      expect.any(Function)
    );
    expect(repository.markWhatsappCommandAttemptInFlight.mock.invocationCallOrder[0]).toBeLessThan(
      textSender.sendText.mock.invocationCallOrder[0]!
    );
    expect(state.command.status).toBe("sent");
    expect(state.invitation.whatsappFlowStatus).toBe("message_sent");
    expect(state.invitation.whatsappLastOutboundMessageId).toBe("wamid.rsvp");
    expect(state.invitation.whatsappFallbackSentAt).toBe("2026-08-17T12:00:00.000Z");
    expect(repository.finalizeAcceptedWhatsappSend).toHaveBeenCalledWith(expect.objectContaining({
      effect: "preserve", fallback: true, now: "2026-08-17T12:00:00.000Z"
    }));
  });

  it("sends the operator's own body and leaves the fallback guard untouched", async () => {
    const { handler, sender, textSender, state, repository } = setup({
      command: command({
        templateId: WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID,
        body: "Oi! Podemos ajudar?",
        preserveFlowStatus: true
      }),
      invitation: { ...invitation, whatsappFlowStatus: "message_sent" as const, whatsappLastOutboundMessageId: "wamid.rsvp" }
    });

    await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(sender.send).not.toHaveBeenCalled();
    expect(textSender.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: { body: "Oi! Podemos ajudar?" } }),
      expect.anything(),
      expect.any(Function)
    );
    expect(state.command.status).toBe("sent");
    // An operator reply must never advance the RSVP flow...
    expect(state.invitation.whatsappFlowStatus).toBe("message_sent");
    expect(state.invitation.whatsappLastOutboundMessageId).toBe("wamid.rsvp");
    // ...nor consume the once-per-invitation automatic fallback.
    expect(state.invitation.whatsappFallbackSentAt).toBeUndefined();
    expect(repository.finalizeAcceptedWhatsappSend).toHaveBeenCalledWith(expect.objectContaining({
      effect: "preserve", fallback: false
    }));
    expect(repository.finalizeAcceptedWhatsappSend).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({ messageType: "text", body: "Oi! Podemos ajudar?" })
    }));
  });

  it("permanently fails an operator text command that lost its body", async () => {
    const { handler, textSender, state } = setup({
      command: command({ templateId: WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID, preserveFlowStatus: true }),
      invitation: { ...invitation, whatsappFlowStatus: "message_sent" as const }
    });

    const result = await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(result).toEqual({ batchItemFailures: [] });
    expect(textSender.sendText).not.toHaveBeenCalled();
    expect(state.command.status).toBe("failed");
  });

  it("never retries fallback text after provider acceptance when finalization fails", async () => {
    const { handler, textSender, repository, state } = setup({
      command: command({ templateId: WHATSAPP_FALLBACK_TEMPLATE_ID, stage: "fallback", preserveFlowStatus: true }),
      invitation: { ...invitation, whatsappFlowStatus: "message_sent" as const }
    });
    repository.finalizeAcceptedWhatsappSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const result = await handler({ Records: [record()] } as unknown as SQSEvent);

    expect(result).toEqual({ batchItemFailures: [] });
    expect(textSender.sendText).toHaveBeenCalledOnce();
    expect(state.command).toMatchObject({
      status: "reconciliation_required",
      providerMessageId: "wamid.text"
    });
  });
});
