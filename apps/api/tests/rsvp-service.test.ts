import { describe, expect, it, vi } from "vitest";
import type { RsvpSubmissionRequest } from "@brimax/contracts";
import { RsvpService } from "../src/domain/rsvp-service";
import { AppError } from "../src/lib/errors";

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

describe("RsvpService", () => {
  it("stores RSVP responses and emails the couple notification address", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(baseInvitation),
      upsertRsvp: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z")
    };
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-1" })
    };
    const service = new RsvpService(repository as never, emailService as never);

    const result = await service.submit(baseRequest);

    expect(repository.getInvitationByCode).toHaveBeenCalledWith("AB2345");
    expect(repository.upsertRsvp).toHaveBeenCalledWith(baseRequest, "attending");
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
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(baseInvitation),
      upsertRsvp: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z")
    };
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-2" })
    };
    const service = new RsvpService(repository as never, emailService as never);

    const requestWithMusic = {
      ...baseRequest,
      note: "Música sugerida: Tempos Modernos - Lulu Santos"
    };

    await service.submit(requestWithMusic);

    expect(repository.upsertRsvp).toHaveBeenCalledWith(requestWithMusic, "attending");

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
      upsertRsvp: vi.fn()
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
    expect(repository.upsertRsvp).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it("rejects when the RSVP payload does not match the invitation guests", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(baseInvitation),
      upsertRsvp: vi.fn()
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
    expect(repository.upsertRsvp).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it("returns success and logs the failure when SES rejects the email", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(baseInvitation),
      upsertRsvp: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z")
    };
    const emailService = {
      sendEmail: vi.fn().mockRejectedValue(new Error("ses rejected"))
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = new RsvpService(repository as never, emailService as never);

    const result = await service.submit(baseRequest);

    expect(repository.upsertRsvp).toHaveBeenCalled();
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
      upsertRsvp: vi.fn()
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
    expect(repository.upsertRsvp).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it("closes an active WhatsApp flow through the website RSVP path", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue({ ...baseInvitation, whatsappFlowStatus: "message_sent" as const }),
      upsertRsvp: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z"),
      updateWhatsappFlow: vi.fn().mockResolvedValue(undefined)
    };
    const service = new RsvpService(repository as never, { sendEmail: vi.fn().mockResolvedValue({}) } as never);

    await service.submit(baseRequest);

    expect(repository.updateWhatsappFlow).toHaveBeenCalledWith(
      "AB2345",
      expect.objectContaining({ whatsappFlowStatus: "website_update_required" }),
      expect.objectContaining({ values: { ":c0": "message_sent" } })
    );
  });

  it.each(["completed", "failed"] as const)("does not reopen a %s WhatsApp flow", async (status) => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue({ ...baseInvitation, whatsappFlowStatus: status }),
      upsertRsvp: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z"),
      updateWhatsappFlow: vi.fn()
    };
    const service = new RsvpService(repository as never, { sendEmail: vi.fn().mockResolvedValue({}) } as never);

    await service.submit(baseRequest);

    expect(repository.upsertRsvp).toHaveBeenCalledOnce();
    expect(repository.updateWhatsappFlow).not.toHaveBeenCalled();
  });
});
