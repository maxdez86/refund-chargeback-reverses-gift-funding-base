import { describe, expect, it, vi } from "vitest";
import type { RsvpSubmissionRequest } from "@brimax/contracts";
import { RsvpService } from "../src/domain/rsvp-service";
import { createRsvpOperationIdentity } from "../src/domain/rsvp-idempotency";
import { AppError } from "../src/lib/errors";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";

process.env.WEDDING_TABLE_NAME = "test-wedding-table";
process.env.CONTACT_EMAIL = "casamento@brimax.life";

const baseInvitation = {
  invitationCode: "AB2345",
  householdName: "Familia Silva",
  guests: [
    {
      guestId: "guest-001",
      guestName: "Maria Silva",
      allowedPlusOnes: 0,
      rsvpStatus: "pending" as const
    },
    {
      guestId: "guest-002",
      guestName: "Joao Silva",
      allowedPlusOnes: 0,
      rsvpStatus: "pending" as const
    }
  ]
};

const baseRequest: RsvpSubmissionRequest = {
  invitationCode: "AB2345",
  submittedBy: "Maria Silva",
  guestResponses: [
    { guestId: "guest-001", status: "attending", isChildSixOrYounger: true },
    { guestId: "guest-002", status: "declined", isChildSixOrYounger: false }
  ],
  attendingGuestCount: 1
};

const unavailableTemplates = { getActive: vi.fn().mockResolvedValue(null) };

function rsvpRepository(overrides: Record<string, unknown> = {}) {
  return {
    getInvitationByCode: vi.fn().mockResolvedValue(baseInvitation),
    getRsvpResponse: vi.fn().mockResolvedValue(null),
    writeRsvpOnly: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

describe("RsvpService", () => {
  it("stores RSVP responses and emails the couple notification address", async () => {
    const repository = rsvpRepository();
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-1" })
    };
    const service = new RsvpService(repository as never, emailService as never);

    const result = await service.submit(baseRequest);

    expect(repository.getInvitationByCode).toHaveBeenCalledWith("AB2345");
    expect(repository.writeRsvpOnly).toHaveBeenCalledWith(expect.objectContaining({ request: baseRequest, status: "attending" }));
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "casamento@brimax.life",
        subject: "Nova confirmacao de presenca: Familia Silva",
        text: expect.stringContaining("Maria Silva: vai comparecer (6 anos ou menos)"),
        html: expect.stringContaining("Enviado automaticamente por brimax.life.")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Joao Silva: nao vai comparecer")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Pagantes: 0")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Criancas 6 anos ou menos: 1")
      })
    );
    expect(result.response.status).toBe("attending");
    expect(result.notificationSent).toBe(true);
  });

  it("includes the music suggestion in notifications and persists it", async () => {
    const repository = rsvpRepository();
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-2" })
    };
    const service = new RsvpService(repository as never, emailService as never);

    const requestWithMusic = {
      ...baseRequest,
      note: "Música sugerida: Tempos Modernos - Lulu Santos"
    };

    await service.submit(requestWithMusic);

    expect(repository.writeRsvpOnly).toHaveBeenCalledWith(expect.objectContaining({ request: requestWithMusic, status: "attending" }));

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Sugestão musical: Tempos Modernos - Lulu Santos")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("Tempos Modernos - Lulu Santos")
      })
    );
  });

  it("rejects when the invitation does not exist", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(null),
      getRsvpResponse: vi.fn(),
      writeRsvpOnly: vi.fn()
    };
    const emailService = {
      sendEmail: vi.fn()
    };
    const service = new RsvpService(repository as never, emailService as never);

    const promise = service.submit(baseRequest);

    await expect(promise).rejects.toMatchObject({
      statusCode: 404
    });
    await expect(promise).rejects.toBeInstanceOf(AppError);
    expect(repository.writeRsvpOnly).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it("rejects when the RSVP payload does not match the invitation guests", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(baseInvitation),
      getRsvpResponse: vi.fn(),
      writeRsvpOnly: vi.fn()
    };
    const emailService = {
      sendEmail: vi.fn()
    };
    const service = new RsvpService(repository as never, emailService as never);

    await expect(
      service.submit({
        ...baseRequest,
        guestResponses: [
          { guestId: "guest-404", status: "attending", isChildSixOrYounger: false }
        ]
      })
    ).rejects.toMatchObject({
      statusCode: 409
    });
    expect(repository.writeRsvpOnly).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it("returns success and logs the failure when SES rejects the email", async () => {
    const repository = rsvpRepository();
    const emailService = {
      sendEmail: vi.fn().mockRejectedValue(new Error("ses rejected"))
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new RsvpService(repository as never, emailService as never);

    const result = await service.submit(baseRequest);

    expect(repository.writeRsvpOnly).toHaveBeenCalled();
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(result.response.ok).toBe(true);
    expect(result.notificationSent).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"event\":\"RSVP_EMAIL_FAILED\"")
    );

    errorSpy.mockRestore();
  });

  it("rejects when the attending count does not match guest responses", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(baseInvitation),
      getRsvpResponse: vi.fn(),
      writeRsvpOnly: vi.fn()
    };
    const emailService = {
      sendEmail: vi.fn()
    };
    const service = new RsvpService(repository as never, emailService as never);

    await expect(
      service.submit({
        ...baseRequest,
        attendingGuestCount: 0
      })
    ).rejects.toMatchObject({
      statusCode: 409
    });
    expect(repository.writeRsvpOnly).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it("does not write the legacy website terminal state", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue({ ...baseInvitation, whatsappFlowStatus: "message_sent" as const }),
      getRsvpResponse: vi.fn().mockResolvedValue(null),
      writeRsvpOnly: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z"),
      updateWhatsappFlow: vi.fn().mockResolvedValue(undefined)
    };
    const service = new RsvpService(repository as never, { sendEmail: vi.fn().mockResolvedValue({}) } as never, unavailableTemplates as never);

    await service.submit(baseRequest);

    expect(repository.updateWhatsappFlow).not.toHaveBeenCalled();
  });

  it("atomically reserves an attending website follow-up for an open journey", async () => {
    const invitation = {
      ...baseInvitation,
      phoneNumber: "5511999999999",
      whatsappFlowStatus: "message_sent" as const
    };
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(invitation),
      getRsvpResponse: vi.fn().mockResolvedValue(null),
      reserveWebsiteRsvp: vi.fn().mockResolvedValue(undefined),
      updateWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      writeRsvpOnly: vi.fn(),
      updateWhatsappFlow: vi.fn()
    };
    const publish = vi.fn().mockResolvedValue({ status: "queued", enqueuedAt: "2026-08-19T12:00:00.000Z" });
    const templates = {
      getActive: vi.fn().mockResolvedValue({
        purpose: "wedding_rsvp_attending_followup_website",
        version: 1,
        name: "website-followup",
        language: "pt_BR",
        parameterFormat: "positional",
        components: []
      })
    };
    const service = new RsvpService(
      repository as never,
      { sendEmail: vi.fn().mockResolvedValue({}) } as never,
      templates as never,
      publish
    );

    await service.submit(baseRequest, "safe-key-1");

    expect(repository.reserveWebsiteRsvp).toHaveBeenCalledWith(expect.objectContaining({
      expectedStatus: "message_sent",
      status: "attending",
      command: expect.objectContaining({
        effect: "complete_on_send",
        expectedFlowStatus: "website_followup_pending",
        templateId: "wedding_rsvp_attending_followup_website"
      })
    }));
    expect(publish).toHaveBeenCalledOnce();
    expect(repository.writeRsvpOnly).not.toHaveBeenCalled();
  });

  it("selects the single/group decline follow-up for an all-declined website RSVP", async () => {
    const invitation = {
      ...baseInvitation,
      phoneNumber: "5511999999999",
      guests: baseInvitation.guests.map((guest) => ({ ...guest, rsvpStatus: "pending" as const })),
      whatsappFlowStatus: "message_sent" as const
    };
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(invitation),
      getRsvpResponse: vi.fn().mockResolvedValue(null),
      reserveWebsiteRsvp: vi.fn().mockResolvedValue(undefined),
      writeRsvpOnly: vi.fn(),
      updateWhatsappCommand: vi.fn(),
      updateWhatsappFlow: vi.fn()
    };
    const service = new RsvpService(
      repository as never,
      { sendEmail: vi.fn().mockResolvedValue({}) } as never,
      { getActive: vi.fn().mockResolvedValue({
        version: 1,
        components: [{ type: "body", parameters: [{ key: "household_name", type: "text" }] }]
      }) } as never,
      vi.fn().mockResolvedValue({ status: "queued", enqueuedAt: "2026-08-19T12:00:00.000Z" })
    );

    await service.submit({
      ...baseRequest,
      guestResponses: baseRequest.guestResponses.map((response) => ({
        ...response,
        status: "declined" as const,
        isChildSixOrYounger: false
      })),
      attendingGuestCount: 0
    }, "safe-key-decline");

    expect(repository.reserveWebsiteRsvp).toHaveBeenCalledWith(expect.objectContaining({
      status: "declined",
      command: expect.objectContaining({
        templateId: "wedding_rsvp_declined_followup",
        expectedFlowStatus: "website_followup_pending"
      })
    }));
  });

  it("returns a conflict when an idempotency key is reused with another payload", async () => {
    const operation = createRsvpOperationIdentity(baseRequest, "safe-key-1");
    operation.websitePayloadDigest = "a".repeat(64);
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(baseInvitation),
      getRsvpResponse: vi.fn().mockResolvedValue({
        invitationCode: "AB2345",
        status: "attending",
        updatedAt: "2026-08-19T12:00:00.000Z",
        ...operation
      }),
      writeRsvpOnly: vi.fn()
    };
    const service = new RsvpService(repository as never, { sendEmail: vi.fn() } as never);

    await expect(service.submit({ ...baseRequest, note: "different payload" }, "safe-key-1"))
      .rejects.toMatchObject({ statusCode: 409, code: "IDEMPOTENCY_CONFLICT" });
    expect(repository.writeRsvpOnly).not.toHaveBeenCalled();
  });

  it("updates an existing RSVP when a new idempotency key is used", async () => {
    const existingOperation = createRsvpOperationIdentity(baseRequest, "old-key-1");
    const repository = rsvpRepository({
      getRsvpResponse: vi.fn().mockResolvedValue({
        invitationCode: "AB2345", status: "attending", updatedAt: "2026-08-19T12:00:00.000Z",
        ...existingOperation
      })
    });
    const service = new RsvpService(repository as never, { sendEmail: vi.fn().mockResolvedValue({}) } as never);

    await service.submit({ ...baseRequest, attendingGuestCount: 0, guestResponses: baseRequest.guestResponses.map((response) => ({ ...response, status: "declined" as const })) }, "new-key-1");

    expect(repository.writeRsvpOnly).toHaveBeenCalledWith(expect.objectContaining({
      expectedWebsiteOperationId: existingOperation.websiteOperationId,
      operation: expect.objectContaining({ websiteIdempotencyKeyDigest: expect.any(String) })
    }));
  });

  it("updates a legacy RSVP record without operation metadata", async () => {
    const repository = rsvpRepository({
      getRsvpResponse: vi.fn().mockResolvedValue({
        invitationCode: "AB2345", status: "attending", updatedAt: "2026-08-19T12:00:00.000Z"
      })
    });
    const service = new RsvpService(repository as never, { sendEmail: vi.fn().mockResolvedValue({}) } as never);

    await service.submit(baseRequest, "new-key-legacy");

    expect(repository.writeRsvpOnly).toHaveBeenCalledWith(expect.objectContaining({ expectedLegacyRsvp: true }));
  });

  it("stores the RSVP when WhatsApp template preparation fails", async () => {
    const repository = rsvpRepository({
      getInvitationByCode: vi.fn().mockResolvedValue({ ...baseInvitation, phoneNumber: "5511999999999", whatsappFlowStatus: "message_sent" as const }),
      writeRsvpOnly: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z")
    });
    const service = new RsvpService(
      repository as never,
      { sendEmail: vi.fn().mockResolvedValue({}) } as never,
      { getActive: vi.fn().mockRejectedValue(new Error("Dynamo throttled")) } as never
    );

    await expect(service.submit(baseRequest, "template-failure-1")).resolves.toMatchObject({ response: { ok: true } });
    expect(repository.writeRsvpOnly).toHaveBeenCalledOnce();
  });

  it("stores the RSVP after a conditional website race cancellation", async () => {
    const repository = rsvpRepository({
      getInvitationByCode: vi.fn().mockResolvedValue({ ...baseInvitation, phoneNumber: "5511999999999", whatsappFlowStatus: "message_sent" as const }),
      getRsvpResponse: vi.fn().mockResolvedValue(null),
      reserveWebsiteRsvp: vi.fn().mockRejectedValue(new TransactionCanceledException({ message: "race", $metadata: {} })),
      writeRsvpOnly: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z")
    });
    const service = new RsvpService(
      repository as never,
      { sendEmail: vi.fn().mockResolvedValue({}) } as never,
      { getActive: vi.fn().mockResolvedValue({ version: 1, components: [] }) } as never
    );

    await expect(service.submit(baseRequest, "race-key-1")).resolves.toMatchObject({ response: { ok: true } });
    expect(repository.writeRsvpOnly).toHaveBeenCalledOnce();
  });

  it("retries an RSVP-only write after losing a concurrent replacement", async () => {
    const existingOperation = createRsvpOperationIdentity(baseRequest, "other-key");
    const repository = rsvpRepository({
      getRsvpResponse: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ invitationCode: "AB2345", status: "attending", updatedAt: "2026-01-01T00:00:00.000Z", ...existingOperation }),
      writeRsvpOnly: vi.fn()
        .mockRejectedValueOnce({ name: "ConditionalCheckFailedException" })
        .mockResolvedValueOnce("2026-01-01T00:00:01.000Z")
    });
    const service = new RsvpService(repository as never, { sendEmail: vi.fn().mockResolvedValue({}) } as never);

    await expect(service.submit({ ...baseRequest, note: "updated" }, "new-key-after-race"))
      .resolves.toMatchObject({ response: { ok: true } });
    expect(repository.writeRsvpOnly).toHaveBeenCalledTimes(2);
    expect(repository.writeRsvpOnly).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedWebsiteOperationId: existingOperation.websiteOperationId
    }));
  });

  it("keeps a concurrent same-key payload change as an idempotency conflict", async () => {
    const firstOperation = createRsvpOperationIdentity(baseRequest, "race-same-key");
    const repository = rsvpRepository({
      getInvitationByCode: vi.fn().mockResolvedValue({ ...baseInvitation, phoneNumber: "5511999999999", whatsappFlowStatus: "message_sent" as const }),
      getRsvpResponse: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ invitationCode: "AB2345", status: "attending", updatedAt: "2026-01-01T00:00:00.000Z", ...firstOperation }),
      reserveWebsiteRsvp: vi.fn().mockRejectedValue(new TransactionCanceledException({ message: "race", $metadata: {} })),
      writeRsvpOnly: vi.fn()
    });
    const service = new RsvpService(
      repository as never,
      { sendEmail: vi.fn() } as never,
      { getActive: vi.fn().mockResolvedValue({ version: 1, components: [] }) } as never
    );

    await expect(service.submit({ ...baseRequest, note: "different" }, "race-same-key"))
      .rejects.toMatchObject({ statusCode: 409, code: "IDEMPOTENCY_CONFLICT" });
    expect(repository.writeRsvpOnly).not.toHaveBeenCalled();
  });

  it.each([
    "completed",
    "failed",
    "reconciliation_required",
    "website_update_required",
    "website_followup_pending"
  ] as const)("does not reopen a %s WhatsApp flow", async (status) => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue({ ...baseInvitation, whatsappFlowStatus: status }),
      getRsvpResponse: vi.fn().mockResolvedValue(null),
      writeRsvpOnly: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z"),
      updateWhatsappFlow: vi.fn()
    };
    const service = new RsvpService(repository as never, { sendEmail: vi.fn().mockResolvedValue({}) } as never);

    await service.submit(baseRequest);

    expect(repository.writeRsvpOnly).toHaveBeenCalledOnce();
    expect(repository.updateWhatsappFlow).not.toHaveBeenCalled();
  });

  it("stores the RSVP without a WhatsApp send when the journey is idle or has no phone", async () => {
    for (const invitation of [
      { ...baseInvitation, whatsappFlowStatus: "idle" as const, phoneNumber: "5511999999999" },
      { ...baseInvitation, whatsappFlowStatus: "message_sent" as const, phoneNumber: undefined }
    ]) {
      const repository = rsvpRepository({ getInvitationByCode: vi.fn().mockResolvedValue(invitation) });
      const publish = vi.fn();
      const service = new RsvpService(
        repository as never,
        { sendEmail: vi.fn().mockResolvedValue({}) } as never,
        unavailableTemplates as never,
        publish
      );

      await service.submit(baseRequest);
      expect(repository.writeRsvpOnly).toHaveBeenCalledOnce();
      expect(publish).not.toHaveBeenCalled();
    }
  });

  it("keeps the RSVP and marks the reserved website command failed when queue publication fails", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue({
        ...baseInvitation,
        phoneNumber: "5511999999999",
        whatsappFlowStatus: "message_sent" as const
      }),
      getRsvpResponse: vi.fn().mockResolvedValue(null),
      reserveWebsiteRsvp: vi.fn().mockResolvedValue(undefined),
      updateWhatsappCommand: vi.fn().mockResolvedValue(undefined),
      updateWhatsappFlow: vi.fn().mockResolvedValue(undefined),
      writeRsvpOnly: vi.fn()
    };
    const service = new RsvpService(
      repository as never,
      { sendEmail: vi.fn().mockResolvedValue({}) } as never,
      { getActive: vi.fn().mockResolvedValue({
        version: 1,
        components: [{ type: "body", parameters: [{ key: "household_name", type: "text" }] }]
      }) } as never,
      vi.fn().mockRejectedValue(new Error("queue unavailable"))
    );

    await service.submit(baseRequest, "safe-key-queue");

    expect(repository.reserveWebsiteRsvp).toHaveBeenCalledOnce();
    expect(repository.writeRsvpOnly).not.toHaveBeenCalled();
    expect(repository.updateWhatsappCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "failed" }),
      expect.any(Object)
    );
    expect(repository.updateWhatsappFlow).toHaveBeenCalledWith(
      "AB2345",
      expect.objectContaining({ whatsappFlowStatus: "failed" }),
      expect.any(Object)
    );
  });
});
