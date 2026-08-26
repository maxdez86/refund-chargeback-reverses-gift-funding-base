import { describe, expect, it, vi } from "vitest";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { AppError } from "../src/lib/errors";
import { WhatsappRsvpSendService } from "../src/services/whatsapp/rsvp-send-service";

const invitation = {
  invitationCode: "SW2748",
  householdName: "Família Silva",
  phoneNumber: "5511963656517",
  whatsappFlowStatus: "idle" as const,
  guests: [{ guestId: "g1", guestName: "Ana", allowedPlusOnes: 0, rsvpStatus: "pending" as const }]
};

const definition = {
  purpose: "wedding_rsvp_pending_reminder_group",
  version: 3,
  name: "wedding_rsvp_pending_reminder_group",
  language: "pt_BR",
  parameterFormat: "named" as const,
  components: [{ type: "body" as const, parameters: [{ key: "household_name", type: "text" as const }] }],
  createdAt: "2026-08-17T00:00:00.000Z"
};

function setup(overrides: Record<string, unknown> = {}) {
  const repository = {
    getInvitationByCode: vi.fn().mockResolvedValue(invitation),
    getRsvpResponse: vi.fn().mockResolvedValue(null),
    getWhatsappCommand: vi.fn(),
    reserveWhatsappCommand: vi.fn().mockResolvedValue(undefined),
    updateWhatsappCommand: vi.fn().mockResolvedValue(undefined),
    updateWhatsappFlow: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
  const templates = { getActive: vi.fn().mockResolvedValue(definition) };
  const publish = (overrides.publish as ReturnType<typeof vi.fn> | undefined) ?? vi.fn().mockResolvedValue({ status: "queued" as const, enqueuedAt: "2026-08-17T12:00:00.000Z", messageId: "sqs-1" });
  const log = vi.fn();
  const service = new WhatsappRsvpSendService({
    repository,
    templates,
    publish,
    validateVariables: vi.fn(),
    log,
    createCommandId: () => "command-1"
  });
  return { repository, templates, publish, log, service };
}

describe("WhatsappRsvpSendService", () => {
  it("auto-selects the first-send template and accepts it only from idle", async () => {
    const { service, repository } = setup();
    await expect(service.queueAutoTemplate("SW2748", "first", "firstkey1", { requestId: "req-first" }))
      .resolves.toMatchObject({ templateId: "wedding_rsvp_pending_reminder_single", status: "queued" });
    expect(repository.reserveWhatsappCommand).toHaveBeenCalledWith(
      expect.objectContaining({ operatorSendMode: "first", templateId: "wedding_rsvp_pending_reminder_single" }),
      "idle"
    );

    for (const status of ["send_queued", "message_sent", "failed", "undecided", "reconciliation_required", "completed"] as const) {
      const blocked = setup({ getInvitationByCode: vi.fn().mockResolvedValue({ ...invitation, whatsappFlowStatus: status }) });
      await expect(blocked.service.queueAutoTemplate("SW2748", "first", undefined, { requestId: `req-${status}` }))
        .rejects.toMatchObject({ statusCode: 409, code: "INVALID_FLOW_TRANSITION" });
      expect(blocked.repository.reserveWhatsappCommand).not.toHaveBeenCalled();
    }
  });

  it("accepts resends from failed or undecided and rejects every other state", async () => {
    for (const status of ["failed", "undecided"] as const) {
      const allowed = setup({ getInvitationByCode: vi.fn().mockResolvedValue({ ...invitation, whatsappFlowStatus: status }) });
      await expect(allowed.service.queueAutoTemplate("SW2748", "resend", undefined, { requestId: `req-${status}` }))
        .resolves.toMatchObject({ status: "queued" });
      expect(allowed.repository.reserveWhatsappCommand).toHaveBeenCalledWith(
        expect.objectContaining({ operatorSendMode: "resend" }),
        status
      );
    }
    for (const status of ["idle", "send_queued", "message_sent", "reconciliation_required", "website_update_required"] as const) {
      const blocked = setup({ getInvitationByCode: vi.fn().mockResolvedValue({ ...invitation, whatsappFlowStatus: status }) });
      await expect(blocked.service.queueAutoTemplate("SW2748", "resend", undefined, { requestId: `req-${status}` }))
        .rejects.toMatchObject({ statusCode: 409, code: "INVALID_FLOW_TRANSITION" });
    }
  });

  it("accepts a completed resend when every guest remains pending", async () => {
    const completedInvitation = {
      ...invitation,
      whatsappFlowStatus: "completed" as const,
      whatsappFlowCompletedAt: "2026-08-17T12:00:00.000Z"
    };
    const getInvitationByCode = vi.fn().mockResolvedValue(completedInvitation);
    const { service, repository } = setup({ getInvitationByCode });

    await expect(service.queueAutoTemplate("SW2748", "resend", undefined, { requestId: "req-completed" }))
      .resolves.toMatchObject({ status: "queued", templateId: "wedding_rsvp_pending_reminder_single" });
    expect(getInvitationByCode).toHaveBeenCalledTimes(2);
    expect(repository.getRsvpResponse).toHaveBeenCalledWith("SW2748");
    expect(repository.reserveWhatsappCommand).toHaveBeenCalledWith(
      expect.objectContaining({ operatorSendMode: "resend" }),
      "completed",
      { completedAt: "2026-08-17T12:00:00.000Z", rsvpUpdatedAt: null }
    );
  });

  it.each([
    { label: "attending guest", changes: { guests: [{ ...invitation.guests[0], rsvpStatus: "attending" as const }] } },
    { label: "declined guest", changes: { guests: [{ ...invitation.guests[0], rsvpStatus: "declined" as const }] } },
    { label: "WhatsApp attendance", changes: { whatsappAttendance: [{ guestId: "g1", status: "attending" as const, recordedAt: "2026-08-17T11:00:00.000Z" }] } }
  ])("blocks a completed resend with a decisive $label", async ({ changes }) => {
    const completedInvitation = {
      ...invitation,
      ...changes,
      whatsappFlowStatus: "completed" as const,
      whatsappFlowCompletedAt: "2026-08-17T12:00:00.000Z"
    };
    const blocked = setup({ getInvitationByCode: vi.fn().mockResolvedValue(completedInvitation) });
    await expect(blocked.service.queueAutoTemplate("SW2748", "resend", undefined, { requestId: "req-blocked" }))
      .rejects.toMatchObject({ statusCode: 409, code: "INVALID_FLOW_TRANSITION" });
    expect(blocked.repository.reserveWhatsappCommand).not.toHaveBeenCalled();
  });

  it("maps a completed resend reservation race to a state conflict", async () => {
    const completedInvitation = {
      ...invitation,
      whatsappFlowStatus: "completed" as const,
      whatsappFlowCompletedAt: "2026-08-17T12:00:00.000Z"
    };
    const raced = setup({
      getInvitationByCode: vi.fn().mockResolvedValue(completedInvitation),
      getRsvpResponse: vi.fn().mockResolvedValue({ updatedAt: "2026-08-17T11:59:00.000Z" }),
      reserveWhatsappCommand: vi.fn().mockRejectedValue(new TransactionCanceledException({
        message: "conditional race", $metadata: {}, CancellationReasons: [{ Code: "ConditionalCheckFailed" }]
      }))
    });
    await expect(raced.service.queueAutoTemplate("SW2748", "resend", undefined, { requestId: "req-race" }))
      .rejects.toMatchObject({ statusCode: 409, code: "INVALID_FLOW_TRANSITION" });
    expect(raced.publish).not.toHaveBeenCalled();
  });

  it("rejects empty or durably completed invitations before queueing", async () => {
    const empty = setup({ getInvitationByCode: vi.fn().mockResolvedValue({ ...invitation, guests: [] }) });
    await expect(empty.service.queueAutoTemplate("SW2748", "first", undefined, { requestId: "req-empty" }))
      .rejects.toMatchObject({ statusCode: 422, code: "INVALID_INVITATION_STATE" });
    const completed = setup({
      getInvitationByCode: vi.fn().mockResolvedValue({
        ...invitation,
        whatsappFlowStatus: "failed",
        whatsappFlowCompletedAt: "2026-08-17T12:00:00.000Z"
      })
    });
    await expect(completed.service.queueAutoTemplate("SW2748", "resend", undefined, { requestId: "req-complete" }))
      .rejects.toMatchObject({ statusCode: 409, code: "INVALID_FLOW_TRANSITION" });
  });

  it("atomically reserves, enqueues, and returns the command", async () => {
    const { service, repository, publish, log } = setup();
    await expect(service.queueTemplate("SW2748", definition.purpose, "key12345", { requestId: "req-1" })).resolves.toEqual({
      commandId: "idempotency-key12345",
      invitationCode: "SW2748",
      templateId: definition.purpose,
      templateVersion: 3,
      status: "queued",
      replayed: false
    });
    expect(repository.reserveWhatsappCommand).toHaveBeenCalledWith(expect.objectContaining({ status: "queued", stage: "pending" }), "idle");
    expect(publish).toHaveBeenCalledWith("idempotency-key12345", { requestId: "req-1" });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req-1", commandId: "idempotency-key12345", outcome: "queued" }));
  });

  it("does not overwrite a worker claim when enqueue acknowledgement loses the race", async () => {
    const { service, repository } = setup({
      updateWhatsappCommand: vi.fn().mockRejectedValue(new ConditionalCheckFailedException({
        message: "worker claimed command", $metadata: {}
      }))
    });

    await expect(service.queueTemplate("SW2748", definition.purpose, "key12345", { requestId: "req-race" }))
      .resolves.toMatchObject({ commandId: "idempotency-key12345", status: "queued" });
    expect(repository.updateWhatsappCommand).toHaveBeenCalledOnce();
  });

  it("validates invitation, template, phone, flow, and variables before reservation", async () => {
    const { service, repository, templates } = setup({
      getInvitationByCode: vi.fn().mockResolvedValue(null)
    });
    await expect(service.queueTemplate("SW2748", definition.purpose, undefined, { requestId: "req-1" })).rejects.toMatchObject({ statusCode: 404 });
    expect(templates.getActive).not.toHaveBeenCalled();
    expect(repository.reserveWhatsappCommand).not.toHaveBeenCalled();

    const invalidVariables = setup({
      getInvitationByCode: vi.fn().mockResolvedValue({ ...invitation, whatsappFlowStatus: "send_queued" })
    });
    await expect(invalidVariables.service.queueTemplate("SW2748", definition.purpose, undefined, { requestId: "req-2" })).rejects.toMatchObject({ statusCode: 409 });
    expect(invalidVariables.repository.reserveWhatsappCommand).not.toHaveBeenCalled();
  });

  it("rejects an incompatible template before writing", async () => {
    const validateVariables = vi.fn().mockImplementation(() => {
      throw new AppError("Unsupported WhatsApp template parameter guest_name.", 422, "INVALID_INVITATION_STATE");
    });
    const { repository, templates, publish, log } = setup();
    const service = new WhatsappRsvpSendService({ repository, templates, publish, validateVariables, log });
    await expect(service.queueTemplate("SW2748", definition.purpose, undefined, { requestId: "req-1" })).rejects.toMatchObject({ statusCode: 422 });
    expect(repository.reserveWhatsappCommand).not.toHaveBeenCalled();
  });

  it("re-enqueues a persisted queued command and detects conflicts", async () => {
    const existing = { commandId: "idempotency-key12345", invitationCode: "SW2748", templateId: definition.purpose, templateVersion: 2, status: "queued" as const };
    const { service, publish } = setup({
      reserveWhatsappCommand: vi.fn().mockRejectedValue({ name: "ConditionalCheckFailedException" }),
      getWhatsappCommand: vi.fn().mockResolvedValue(existing)
    });
    await expect(service.queueTemplate("SW2748", definition.purpose, "key12345", { requestId: "req-1" })).resolves.toMatchObject({ replayed: true, status: "queued", templateVersion: 2 });
    expect(publish).toHaveBeenCalledWith("idempotency-key12345", { requestId: "req-1" });

    const conflict = setup({
      reserveWhatsappCommand: vi.fn().mockRejectedValue({ name: "ConditionalCheckFailedException" }),
      getWhatsappCommand: vi.fn().mockResolvedValue({ ...existing, invitationCode: "AB1234" })
    });
    await expect(conflict.service.queueTemplate("SW2748", definition.purpose, "key12345", { requestId: "req-2" })).rejects.toMatchObject({ statusCode: 409, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("treats an idempotency key reused with a different automatic mode as a conflict", async () => {
    const { service } = setup({
      getInvitationByCode: vi.fn().mockResolvedValue({ ...invitation, whatsappFlowStatus: "failed" }),
      reserveWhatsappCommand: vi.fn().mockRejectedValue({ name: "ConditionalCheckFailedException" }),
      getWhatsappCommand: vi.fn().mockResolvedValue({
        commandId: "idempotency-key12345",
        invitationCode: "SW2748",
        templateId: "wedding_rsvp_pending_reminder_single",
        templateVersion: 2,
        status: "sent",
        operatorSendMode: "first"
      })
    });
    await expect(service.queueAutoTemplate("SW2748", "resend", "key12345", { requestId: "req-mode" }))
      .rejects.toMatchObject({ statusCode: 409, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("replays an automatic first send before revalidating the now-active flow", async () => {
    const getInvitationByCode = vi.fn();
    const { service, publish } = setup({
      getInvitationByCode,
      getWhatsappCommand: vi.fn().mockResolvedValue({
        commandId: "idempotency-firstkey1",
        invitationCode: "SW2748",
        templateId: "wedding_rsvp_pending_reminder_single",
        templateVersion: 2,
        status: "queued",
        operatorSendMode: "first"
      })
    });
    await expect(service.queueAutoTemplate("SW2748", "first", "firstkey1", { requestId: "req-replay" }))
      .resolves.toMatchObject({ replayed: true, status: "queued" });
    expect(getInvitationByCode).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith("idempotency-firstkey1", { requestId: "req-replay" });
  });

  it("replays a command when reservation loses a conditional transaction race", async () => {
    const existing = { commandId: "idempotency-key12345", invitationCode: "SW2748", templateId: definition.purpose, templateVersion: 2, status: "queued" as const };
    const { service, publish } = setup({
      reserveWhatsappCommand: vi.fn().mockRejectedValue(new TransactionCanceledException({
        message: "conditional race", $metadata: {}, CancellationReasons: [{ Code: "ConditionalCheckFailed" }]
      })),
      getWhatsappCommand: vi.fn().mockResolvedValue(existing)
    });
    await expect(service.queueTemplate("SW2748", definition.purpose, "key12345", { requestId: "req-1" }))
      .resolves.toMatchObject({ replayed: true, status: "queued" });
    expect(publish).toHaveBeenCalledWith("idempotency-key12345", { requestId: "req-1" });
  });

  it("marks the command and flow failed when SQS rejects", async () => {
    const { service, repository } = setup({ publish: vi.fn().mockRejectedValue(new Error("SQS unavailable")) });
    await expect(service.queueTemplate("SW2748", definition.purpose, undefined, { requestId: "req-1" })).rejects.toMatchObject({ statusCode: 503, code: "QUEUE_FAILURE" });
    expect(repository.updateWhatsappCommand).toHaveBeenCalledWith("command-1", expect.objectContaining({ status: "failed" }), expect.any(Object));
    expect(repository.updateWhatsappFlow).toHaveBeenCalledWith("SW2748", expect.objectContaining({ whatsappFlowStatus: "failed" }), expect.any(Object));
  });

  it("allows only the scoped failed or undecided automatic resend", async () => {
    const { service, repository } = setup({
      getInvitationByCode: vi.fn().mockResolvedValue({ ...invitation, whatsappFlowStatus: "failed" })
    });
    await expect(service.queueTemplate("SW2748", definition.purpose, undefined, { requestId: "req-1" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.queueAutoTemplate("SW2748", "resend", undefined, { requestId: "req-2" })).resolves.toMatchObject({ status: "queued" });
    expect(repository.reserveWhatsappCommand).toHaveBeenCalledWith(
      expect.objectContaining({ operatorSendMode: "resend" }),
      "failed"
    );
  });

  it("does not expose sensitive values in logs", async () => {
    const { service, log } = setup();
    await service.queueTemplate("SW2748", definition.purpose, undefined, { requestId: "req-1" });
    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).not.toContain(invitation.phoneNumber);
    expect(serialized).not.toContain(invitation.householdName);
  });
});
