import { describe, expect, it, vi } from "vitest";
import { InvitationService } from "../src/domain/invitation-service";
import { AppError } from "../src/lib/errors";

describe("InvitationService", () => {
  it("returns the household shape on success", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue({
        invitationCode: "ABCD2345",
        householdId: "grupo-amanda-cris",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "grupo-amanda-cris--amanda",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      })
    };
    const service = new InvitationService(repository as never);

    const result = await service.getInvitation("ABCD2345");

    expect(repository.getInvitationByCode).toHaveBeenCalledWith("ABCD2345");
    expect(result.householdName).toBe("Amanda e Chris");
    expect(result.guests).toHaveLength(1);
  });

  it("normalizes incoming codes to trimmed uppercase before lookup", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue({
        invitationCode: "ABCD2345",
        householdId: "grupo-amanda-cris",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      })
    };
    const service = new InvitationService(repository as never);

    await service.getInvitation("  abcd2345 ");

    expect(repository.getInvitationByCode).toHaveBeenCalledWith("ABCD2345");
  });

  it("throws a 404 AppError when no invitation matches", async () => {
    const repository = {
      getInvitationByCode: vi.fn().mockResolvedValue(null)
    };
    const service = new InvitationService(repository as never);

    await expect(service.getInvitation("MISSING1")).rejects.toMatchObject({
      statusCode: 404
    });
    await expect(service.getInvitation("MISSING1")).rejects.toBeInstanceOf(AppError);
  });

  it("rejects an empty code with a 400", async () => {
    const repository = { getInvitationByCode: vi.fn() };
    const service = new InvitationService(repository as never);

    await expect(service.getInvitation("   ")).rejects.toMatchObject({
      statusCode: 400
    });
    expect(repository.getInvitationByCode).not.toHaveBeenCalled();
  });
});
