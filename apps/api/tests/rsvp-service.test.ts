import { describe, expect, it, vi } from "vitest";
import type { RsvpSubmissionRequest } from "@brimax/contracts";
import { RsvpService } from "../src/domain/rsvp-service";
import { AppError } from "../src/lib/errors";

process.env.WEDDING_TABLE_NAME = "test-wedding-table";
process.env.CONTACT_EMAIL = "casamento@brimax.life";

const baseInvitation = {
  invitationCode: "AB2345",
  householdId: "household-001",
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
  householdId: "household-001",
  submittedBy: "Maria Silva",
  guestResponses: [
    { guestId: "guest-001", status: "attending" },
    { guestId: "guest-002", status: "declined" }
  ],
  attendingGuestCount: 1,
  note: "Temos restricao alimentar."
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
        text: expect.stringContaining("Maria Silva: vai comparecer"),
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
        text: expect.stringContaining("Recado:\nTemos restricao alimentar.")
      })
    );
    expect(result.response.status).toBe("attending");
    expect(result.notificationSent).toBe(true);
  });

  it("includes a fallback message when no note is provided", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(baseInvitation),
      upsertRsvp: vi.fn().mockResolvedValue("2026-01-01T00:00:00.000Z")
    };
    const emailService = {
      sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "msg-2" })
    };
    const service = new RsvpService(repository as never, emailService as never);

    await service.submit({
      ...baseRequest,
      note: undefined
    });

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Recado:\nNenhum recado enviado.")
      })
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("Nenhum recado enviado.")
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

  it("rejects when the invitation household does not match the payload", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue({
        ...baseInvitation,
        householdId: "household-999"
      }),
      upsertRsvp: vi.fn()
    };
    const emailService = {
      sendEmail: vi.fn()
    };
    const service = new RsvpService(repository as never, emailService as never);

    await expect(service.submit(baseRequest)).rejects.toMatchObject({
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
});
