import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AdminInvitationProvisioningService } from "../src/domain/admin-invitation-provisioning-service";
import { AppError } from "../src/lib/errors";

type GuestOverrides = {
  guestId: string;
  guestName: string;
  rsvpStatus?: "pending" | "attending" | "declined";
  isChild?: boolean;
  isChildSixOrYounger?: boolean;
};

const guest = (overrides: GuestOverrides) => ({
  allowedPlusOnes: 0,
  rsvpStatus: "pending" as const,
  ...overrides
});

const amanda = guest({ guestId: "AB2345--guest-01", guestName: "Amanda", rsvpStatus: "attending" });
const chris = guest({ guestId: "AB2345--guest-02", guestName: "Chris", rsvpStatus: "declined" });

const invitation = (guests: ReturnType<typeof guest>[]) => ({
  invitationCode: "AB2345",
  householdName: "Amanda e Chris",
  guests
});

const storedRsvp = (guestResponses: unknown[]) => ({
  PK: "INVITATION#AB2345",
  SK: "RSVP#CURRENT",
  entityType: "RsvpResponse" as const,
  invitationCode: "AB2345",
  submittedBy: "AB2345--guest-01",
  guestResponses,
  attendingGuestCount: 1,
  paidAttendingGuestCount: 1,
  childSixOrYoungerAttendingCount: 0,
  status: "attending" as const,
  updatedAt: "2026-08-01T10:00:00.000Z"
});

const repositoryDouble = (
  options: {
    invitation?: ReturnType<typeof invitation> | null;
    rsvp?: ReturnType<typeof storedRsvp> | null;
  } = {}
) => ({
  createInvitation: vi.fn(),
  deleteInvitationCascade: vi.fn(),
  addInvitationGuests: vi.fn(),
  removeInvitationGuest: vi.fn(async (input: { updatedAt: string }) => input.updatedAt),
  applyAdminGuestEdit: vi.fn(async (input: { updatedAt: string }) => input.updatedAt),
  getInvitationByCode: vi
    .fn()
    .mockResolvedValue(
      options.invitation === undefined ? invitation([amanda, chris]) : options.invitation
    ),
  getRsvpResponse: vi.fn().mockResolvedValue(options.rsvp ?? null)
});

const service = (repository: ReturnType<typeof repositoryDouble>) =>
  new AdminInvitationProvisioningService(repository as never);

describe("AdminInvitationProvisioningService.createInvitation", () => {
  const request = {
    invitationCode: "AB2345",
    householdName: "Amanda e Chris",
    phoneNumber: "5511999998888",
    guests: [{ guestName: "Amanda" }, { guestName: "Bruno", isChild: true }]
  };

  it("assigns sequential slots and answers with a never-asked invitation", async () => {
    const repository = repositoryDouble();
    repository.createInvitation.mockImplementation(async (input) => ({
      invitation: {
        invitationCode: input.invitationCode,
        householdName: input.householdName,
        phoneNumber: input.phoneNumber
      },
      guests: input.guests.map((row: { guestName: string; slot: number; isChild?: boolean }) => ({
        guestId: `AB2345--guest-0${row.slot}`,
        guestName: row.guestName,
        allowedPlusOnes: 0,
        rsvpStatus: "pending",
        isChild: row.isChild ?? false
      }))
    }));

    const response = await service(repository).createInvitation(request);

    expect(repository.createInvitation.mock.calls[0]![0].guests).toEqual([
      { guestName: "Amanda", slot: 1 },
      { guestName: "Bruno", isChild: true, slot: 2 }
    ]);
    expect(response.invitation.phoneNumberSource).toBe("operator");
    expect(response.invitation.whatsappSendAvailability).toEqual({
      firstAllowed: true,
      resendAllowed: false
    });
    // Nothing has been asked yet, so the aggregate must not claim an answer or a submitter.
    expect(response.invitation.rsvp).toMatchObject({
      status: "pending",
      updatedAt: null,
      submittedBy: null,
      attending: 0
    });
  });

  it("rejects a code the invitation-code format does not allow", async () => {
    const repository = repositoryDouble();

    await expect(
      service(repository).createInvitation({ ...request, invitationCode: "brx-014" })
    ).rejects.toBeInstanceOf(ZodError);
    expect(repository.createInvitation).not.toHaveBeenCalled();
  });

  it("passes a duplicate-code conflict through untouched", async () => {
    const repository = repositoryDouble();
    repository.createInvitation.mockRejectedValue(
      new AppError("Invitation code already in use.", 409)
    );

    await expect(service(repository).createInvitation(request)).rejects.toMatchObject({
      statusCode: 409
    });
  });

  it("writes no phone attributes when the operator supplies no number", async () => {
    const repository = repositoryDouble();
    repository.createInvitation.mockResolvedValue({
      invitation: { invitationCode: "AB2345", householdName: "Amanda e Chris" },
      guests: [
        {
          guestId: "AB2345--guest-01",
          guestName: "Amanda",
          allowedPlusOnes: 0,
          rsvpStatus: "pending",
          isChild: false
        }
      ]
    });

    const response = await service(repository).createInvitation({
      invitationCode: "AB2345",
      householdName: "Amanda e Chris",
      guests: [{ guestName: "Amanda" }]
    });

    expect(repository.createInvitation.mock.calls[0]![0].phoneNumber).toBeUndefined();
    expect(response.invitation.phoneNumber).toBeUndefined();
    expect(response.invitation.phoneNumberSource).toBeUndefined();
  });
});

describe("AdminInvitationProvisioningService.deleteInvitation", () => {
  it("reports what the cascade removed", async () => {
    const repository = repositoryDouble();
    repository.deleteInvitationCascade.mockResolvedValue({
      guests: 2,
      rsvp: 1,
      whatsappItems: 7,
      phoneLookups: 1
    });

    const response = await service(repository).deleteInvitation("AB2345");

    expect(repository.deleteInvitationCascade).toHaveBeenCalledWith("AB2345");
    expect(response).toMatchObject({
      ok: true,
      invitationCode: "AB2345",
      deleted: { guests: 2, rsvp: 1, whatsappItems: 7, phoneLookups: 1 }
    });
  });
});

describe("AdminInvitationProvisioningService.addGuests", () => {
  it("appends the returned guests and recomputes the aggregate over the whole household", async () => {
    // Both stored guests declined, so the invitation reads "declined". A new pending guest has to
    // move it back to pending, which is why the aggregate is recomputed on an add at all.
    const repository = repositoryDouble({
      invitation: invitation([
        guest({ guestId: "AB2345--guest-01", guestName: "Amanda", rsvpStatus: "declined" }),
        chris
      ]),
      rsvp: storedRsvp([])
    });
    repository.addInvitationGuests.mockResolvedValue([
      {
        guestId: "AB2345--guest-06",
        guestName: "Duda",
        allowedPlusOnes: 0,
        rsvpStatus: "pending",
        isChild: false
      }
    ]);

    const response = await service(repository).addGuests("AB2345", {
      guests: [{ guestName: "Duda" }]
    });

    expect(repository.addInvitationGuests).toHaveBeenCalledWith({
      invitationCode: "AB2345",
      guests: [{ guestName: "Duda" }]
    });
    expect(response.guests.map((row) => row.guestId)).toEqual([
      "AB2345--guest-01",
      "AB2345--guest-02",
      "AB2345--guest-06"
    ]);
    expect(response.rsvp.status).toBe("pending");
    // The added guest has no answer, so no synthesized row is persisted for them.
    expect(repository.applyAdminGuestEdit.mock.calls[0]![0].guestResponses).toEqual([]);
  });

  it("rejects a body that tries to choose the slot or the guest id", async () => {
    const repository = repositoryDouble();

    await expect(
      service(repository).addGuests("AB2345", { guests: [{ guestName: "Duda", slot: 3 }] })
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      service(repository).addGuests("AB2345", {
        guests: [{ guestName: "Duda", guestId: "AB2345--guest-03" }]
      })
    ).rejects.toBeInstanceOf(ZodError);
    expect(repository.addInvitationGuests).not.toHaveBeenCalled();
  });

  it("404s for an invitation that does not exist", async () => {
    const repository = repositoryDouble({ invitation: null });

    await expect(
      service(repository).addGuests("AB2345", { guests: [{ guestName: "Duda" }] })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("AdminInvitationProvisioningService.removeGuest", () => {
  it("prunes only the removed guest's answer and recomputes the counts", async () => {
    const repository = repositoryDouble({
      invitation: invitation([amanda, chris, guest({ guestId: "AB2345--guest-03", guestName: "Duda", rsvpStatus: "attending" })]),
      rsvp: storedRsvp([
        { guestId: "AB2345--guest-01", status: "attending", isChildSixOrYounger: false },
        { guestId: "AB2345--guest-03", status: "attending", isChildSixOrYounger: false }
      ])
    });

    const response = await service(repository).removeGuest("AB2345", "AB2345--guest-01");

    const written = repository.removeInvitationGuest.mock.calls[0]![0];
    expect(written.guestId).toBe("AB2345--guest-01");
    expect(written.guestResponses).toEqual([
      { guestId: "AB2345--guest-03", status: "attending", isChildSixOrYounger: false }
    ]);
    // One of the two attending adults is gone, so both derived counts drop by one.
    expect(written.counts).toEqual({
      attendingGuestCount: 1,
      paidAttendingGuestCount: 1,
      childSixOrYoungerAttendingCount: 0
    });
    expect(response.guests.map((row) => row.guestId)).toEqual([
      "AB2345--guest-02",
      "AB2345--guest-03"
    ]);
  });

  it("flips the invitation to declined when the only attending guest leaves", async () => {
    const repository = repositoryDouble({ invitation: invitation([amanda, chris]) });

    const response = await service(repository).removeGuest("AB2345", "AB2345--guest-01");

    expect(response.rsvp.status).toBe("declined");
    expect(response.rsvp.attending).toBe(0);
  });

  it("still writes the RSVP item when no answers remain", async () => {
    const repository = repositoryDouble({
      rsvp: storedRsvp([
        { guestId: "AB2345--guest-01", status: "attending", isChildSixOrYounger: false }
      ])
    });

    await service(repository).removeGuest("AB2345", "AB2345--guest-01");

    // A `RSVP#CURRENT` at zero responses is a real state — the invitation's only respondent left —
    // so the aggregate is rewritten rather than the item deleted.
    expect(repository.removeInvitationGuest.mock.calls[0]![0].guestResponses).toEqual([]);
  });

  it("removes the primary guest, because that escalation is a UI convention only", async () => {
    const repository = repositoryDouble();

    const response = await service(repository).removeGuest("AB2345", "AB2345--guest-01");

    expect(repository.removeInvitationGuest).toHaveBeenCalled();
    expect(response.guests.map((row) => row.guestId)).toEqual(["AB2345--guest-02"]);
  });

  it("refuses to remove the last guest, and writes nothing", async () => {
    const repository = repositoryDouble({ invitation: invitation([amanda]) });

    await expect(service(repository).removeGuest("AB2345", "AB2345--guest-01")).rejects.toMatchObject(
      { statusCode: 409 }
    );
    expect(repository.removeInvitationGuest).not.toHaveBeenCalled();
  });

  it("404s for an unknown guest and for an unknown invitation", async () => {
    await expect(
      service(repositoryDouble()).removeGuest("AB2345", "AB2345--guest-99")
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      service(repositoryDouble({ invitation: null })).removeGuest("AB2345", "AB2345--guest-01")
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
