import { describe, expect, it, vi } from "vitest";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { AppError } from "../src/lib/errors";
import { WhatsappOperatorTextService } from "../src/services/whatsapp/operator-text-service";
import { WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID } from "../src/domain/whatsapp-text-commands";

const NOW = "2026-08-20T12:00:00.000Z";
// Well inside the 24-hour customer-service window relative to NOW.
const LAST_INBOUND = "2026-08-20T09:00:00.000Z";

const invitation = {
  invitationCode: "SW2748",
  householdName: "Família Silva",
  phoneNumber: "5511963656517",
  whatsappFlowStatus: "message_sent" as const,
  whatsappLastInboundAt: LAST_INBOUND,
  guests: [{ guestId: "g1", guestName: "Ana", allowedPlusOnes: 0, rsvpStatus: "pending" as const }]
};

function setup(overrides: Record<string, unknown> = {}) {
  const repository = {
    getInvitationByCode: vi.fn().mockResolvedValue(invitation),
    getWhatsappCommand: vi.fn().mockResolvedValue(undefined),
    reserveWhatsappCommand: vi.fn().mockResolvedValue(undefined),
    updateWhatsappCommand: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
  const publish = (overrides.publish as ReturnType<typeof vi.fn> | undefined) ??
    vi.fn().mockResolvedValue({ status: "queued" as const, enqueuedAt: NOW, messageId: "sqs-1" });
  const log = vi.fn();
  const service = new WhatsappOperatorTextService({
    repository,
    publish,
    log,
    now: () => NOW,
    createCommandId: () => "command-1"
  });
  return { repository, publish, log, service };
}

const context = { requestId: "req-text-1" };

describe("WhatsappOperatorTextService", () => {
  it("reserves a preserve-effect text command, enqueues it, and never touches the invitation", async () => {
    const { service, repository, publish } = setup();

    await expect(service.queueText("SW2748", "Oi! Podemos ajudar?", undefined, context))
      .resolves.toEqual({
        commandId: "command-1",
        invitationCode: "SW2748",
        status: "queued",
        replayed: false
      });

    expect(repository.reserveWhatsappCommand).toHaveBeenCalledWith({
      commandId: "command-1",
      invitationCode: "SW2748",
      templateId: WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID,
      body: "Oi! Podemos ajudar?",
      status: "queued",
      effect: "preserve",
      createdAt: NOW
    }, undefined);
    expect(publish).toHaveBeenCalledWith("command-1", context);
    expect(repository.updateWhatsappCommand).toHaveBeenCalledWith("command-1", {
      status: "queued", enqueuedAt: NOW, updatedAt: NOW
    }, {
      expression: "(#status = :queued OR #status = :queueUnavailable) AND attribute_not_exists(#startedAt)",
      names: { "#status": "status", "#startedAt": "startedAt" },
      values: { ":queued": "queued", ":queueUnavailable": "queue_unavailable" }
    });
  });

  it("does not overwrite a worker claim when enqueue acknowledgement loses the race", async () => {
    const { service, repository } = setup({
      updateWhatsappCommand: vi.fn().mockRejectedValue(new ConditionalCheckFailedException({
        message: "worker claimed command", $metadata: {}
      }))
    });

    await expect(service.queueText("SW2748", "Oi!", undefined, context))
      .resolves.toMatchObject({ commandId: "command-1", status: "queued" });
    expect(repository.updateWhatsappCommand).toHaveBeenCalledOnce();
  });

  it("trims the body but preserves the operator's interior formatting", async () => {
    const { service, repository } = setup();
    await service.queueText("SW2748", "  linha 1\n\nlinha 2  ", undefined, context);
    expect(repository.reserveWhatsappCommand).toHaveBeenCalledWith(
      expect.objectContaining({ body: "linha 1\n\nlinha 2" }),
      undefined
    );
  });

  it("rejects a body that is empty once trimmed", async () => {
    const { service, repository } = setup();
    await expect(service.queueText("SW2748", "   \n  ", undefined, context)).rejects.toThrow();
    expect(repository.reserveWhatsappCommand).not.toHaveBeenCalled();
  });

  it("namespaces the command by the idempotency key and replays an existing one", async () => {
    const { service, repository, publish } = setup({
      getWhatsappCommand: vi.fn().mockResolvedValue({
        commandId: "idempotency-text-key-1",
        invitationCode: "SW2748",
        templateId: WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID,
        body: "Oi!",
        status: "sent",
        effect: "preserve",
        createdAt: NOW
      })
    });

    await expect(service.queueText("SW2748", "Oi!", "text-key-1", context))
      .resolves.toEqual({
        commandId: "idempotency-text-key-1",
        invitationCode: "SW2748",
        status: "sent",
        replayed: true
      });
    // A command that already reached the provider is not re-enqueued.
    expect(publish).not.toHaveBeenCalled();
    expect(repository.reserveWhatsappCommand).not.toHaveBeenCalled();
  });

  it("re-enqueues a replayed command that never left the queue", async () => {
    const { service, publish } = setup({
      getWhatsappCommand: vi.fn().mockResolvedValue({
        commandId: "idempotency-text-key-1",
        invitationCode: "SW2748",
        templateId: WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID,
        body: "Oi!",
        status: "queue_unavailable",
        effect: "preserve",
        createdAt: NOW
      })
    });
    await expect(service.queueText("SW2748", "Oi!", "text-key-1", context))
      .resolves.toMatchObject({ status: "queued", replayed: true });
    expect(publish).toHaveBeenCalledWith("idempotency-text-key-1", context);
  });

  it("rejects an idempotency key reused with a different body", async () => {
    const { service } = setup({
      getWhatsappCommand: vi.fn().mockResolvedValue({
        commandId: "idempotency-text-key-1",
        invitationCode: "SW2748",
        templateId: WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID,
        body: "Mensagem original",
        status: "queued",
        effect: "preserve",
        createdAt: NOW
      })
    });
    await expect(service.queueText("SW2748", "Mensagem diferente", "text-key-1", context))
      .rejects.toMatchObject({ statusCode: 409, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("replays instead of failing when the reservation loses the create race", async () => {
    const reserved = {
      commandId: "idempotency-text-key-1",
      invitationCode: "SW2748",
      templateId: WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID,
      body: "Oi!",
      status: "queued" as const,
      effect: "preserve" as const,
      createdAt: NOW
    };
    const getWhatsappCommand = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(reserved);
    const { service } = setup({
      getWhatsappCommand,
      reserveWhatsappCommand: vi.fn().mockRejectedValue(new TransactionCanceledException({
        $metadata: {},
        message: "cancelled",
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }]
      }))
    });
    await expect(service.queueText("SW2748", "Oi!", "text-key-1", context))
      .resolves.toMatchObject({ commandId: "idempotency-text-key-1", replayed: true });
  });

  it("refuses an invitation that is missing or has no usable WhatsApp number", async () => {
    const missing = setup({ getInvitationByCode: vi.fn().mockResolvedValue(null) });
    await expect(missing.service.queueText("SW2748", "Oi!", undefined, context))
      .rejects.toMatchObject({ statusCode: 404, code: "INVITATION_NOT_FOUND" });

    const noPhone = setup({
      getInvitationByCode: vi.fn().mockResolvedValue({ ...invitation, phoneNumber: undefined })
    });
    await expect(noPhone.service.queueText("SW2748", "Oi!", undefined, context))
      .rejects.toMatchObject({ statusCode: 422, code: "INVALID_INVITATION_STATE" });

    const badPhone = setup({
      getInvitationByCode: vi.fn().mockResolvedValue({ ...invitation, phoneNumber: "not-a-number" })
    });
    await expect(badPhone.service.queueText("SW2748", "Oi!", undefined, context))
      .rejects.toMatchObject({ statusCode: 422, code: "INVALID_INVITATION_STATE" });
  });

  it("refuses to queue outside the 24-hour free-text window", async () => {
    const never = setup({
      getInvitationByCode: vi.fn().mockResolvedValue({ ...invitation, whatsappLastInboundAt: undefined })
    });
    await expect(never.service.queueText("SW2748", "Oi!", undefined, context))
      .rejects.toMatchObject({ statusCode: 409, code: "FREE_TEXT_WINDOW_CLOSED" });
    expect(never.repository.reserveWhatsappCommand).not.toHaveBeenCalled();

    const lapsed = setup({
      getInvitationByCode: vi.fn().mockResolvedValue({
        ...invitation,
        whatsappLastInboundAt: "2026-08-19T09:00:00.000Z"
      })
    });
    await expect(lapsed.service.queueText("SW2748", "Oi!", undefined, context))
      .rejects.toMatchObject({ statusCode: 409, code: "FREE_TEXT_WINDOW_CLOSED" });
  });

  it("fails only the command on a queue failure, never the RSVP flow status", async () => {
    const { service, repository } = setup({
      publish: vi.fn().mockRejectedValue(new AppError("Queue unavailable.", 503, "QUEUE_UNAVAILABLE"))
    });
    await expect(service.queueText("SW2748", "Oi!", undefined, context))
      .rejects.toMatchObject({ statusCode: 503, code: "QUEUE_UNAVAILABLE" });

    expect(repository.updateWhatsappCommand).toHaveBeenCalledWith(
      "command-1",
      { status: "failed", failureReason: "Queue unavailable.", updatedAt: NOW },
      { expression: "#c0 = :c0", names: { "#c0": "status" }, values: { ":c0": "queued" } }
    );
    // `effect: "preserve"` owns no flow status, so there is nothing to compensate on the invitation.
    expect(repository).not.toHaveProperty("updateWhatsappFlow");
  });

  it("never writes the message body into a log line", async () => {
    const secret = "Segredo do convidado";
    const { service, log } = setup();
    await service.queueText("SW2748", secret, undefined, context);
    const failing = setup({
      publish: vi.fn().mockRejectedValue(new AppError("Queue unavailable.", 503, "QUEUE_UNAVAILABLE"))
    });
    await expect(failing.service.queueText("SW2748", secret, undefined, context)).rejects.toThrow();

    for (const entry of [...log.mock.calls, ...failing.log.mock.calls]) {
      expect(JSON.stringify(entry)).not.toContain(secret);
      expect(JSON.stringify(entry)).not.toContain(invitation.phoneNumber);
    }
  });
});
