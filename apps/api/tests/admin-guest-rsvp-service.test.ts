import { describe, expect, it, vi } from "vitest";
import { AdminGuestRsvpService } from "../src/domain/admin-guest-rsvp-service";
import type { AdminGuestEditInput } from "../src/services/dynamodb/repositories/wedding-repository";

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

const invitation = (guests: ReturnType<typeof guest>[]) => ({
  invitationCode: "AB2345",
  householdName: "Amanda e Chris",
  guests
});

const amanda = guest({ guestId: "AB2345--guest-01", guestName: "Amanda" });
const chris = guest({ guestId: "AB2345--guest-02", guestName: "Chris" });

const storedRsvp = (guestResponses: unknown[], overrides: Record<string, unknown> = {}) => ({
  PK: "INVITATION#AB2345",
  SK: "RSVP#CURRENT",
  entityType: "RsvpResponse" as const,
  invitationCode: "AB2345",
  submittedBy: "AB2345--guest-01",
  guestResponses,
  attendingGuestCount: 0,
  paidAttendingGuestCount: 0,
  childSixOrYoungerAttendingCount: 0,
  status: "pending" as const,
  updatedAt: "2026-08-01T10:00:00.000Z",
  ...overrides
});

const repositoryDouble = (options: {
  invitation?: ReturnType<typeof invitation> | null;
  rsvp?: ReturnType<typeof storedRsvp> | null;
} = {}) => {
  const applyAdminGuestEdit = vi.fn(async (input: AdminGuestEditInput) => input.updatedAt);
  return {
    applyAdminGuestEdit,
    getInvitationByCode: vi.fn().mockResolvedValue(
      options.invitation === undefined ? invitation([amanda, chris]) : options.invitation
    ),
    getRsvpResponse: vi.fn().mockResolvedValue(options.rsvp ?? null)
  };
};

const written = (repository: ReturnType<typeof repositoryDouble>) =>
  repository.applyAdminGuestEdit.mock.calls[0]![0];

const service = (repository: ReturnType<typeof repositoryDouble>) =>
  new AdminGuestRsvpService(repository as never);

describe("AdminGuestRsvpService.updateGuest", () => {
  it("confirms one guest and leaves the household's other answers alone", async () => {
    const repository = repositoryDouble();

    const response = await service(repository).updateGuest(
      "AB2345",
      "AB2345--guest-01",
      { rsvpStatus: "attending" }
    );

    // Only the edited guest gains a stored answer; Chris keeps "no answer yet".
    expect(written(repository).guestResponses).toEqual([
      { guestId: "AB2345--guest-01", status: "attending", isChildSixOrYounger: false }
    ]);
    expect(written(repository).status).toBe("attending");
    expect(written(repository).counts).toEqual({
      attendingGuestCount: 1,
      paidAttendingGuestCount: 1,
      childSixOrYoungerAttendingCount: 0
    });
    expect(response.guests.map((entry) => entry.rsvpStatus)).toEqual(["attending", "pending"]);
    expect(response.guests[1]?.isChildSixOrYounger).toBeUndefined();
    expect(response.rsvp).toMatchObject({ status: "attending", attending: 1, paid: 1 });
  });

  it("keeps the invitation pending while any guest is unanswered", async () => {
    const repository = repositoryDouble();

    await service(repository).updateGuest("AB2345", "AB2345--guest-01", {
      rsvpStatus: "declined"
    });

    expect(written(repository).status).toBe("pending");
  });

  it("reports declined only once every guest has declined", async () => {
    const repository = repositoryDouble({
      rsvp: storedRsvp([
        { guestId: "AB2345--guest-01", status: "declined", isChildSixOrYounger: false }
      ])
    });

    const response = await service(repository).updateGuest("AB2345", "AB2345--guest-02", {
      rsvpStatus: "declined"
    });

    expect(written(repository).status).toBe("declined");
    expect(response.rsvp.status).toBe("declined");
    expect(response.rsvp.attending).toBe(0);
  });

  it("writes the seed child flag on the guest item without inventing an age answer", async () => {
    const repository = repositoryDouble();

    const response = await service(repository).updateGuest("AB2345", "AB2345--guest-02", {
      isChild: true
    });

    expect(written(repository).guestFlags).toEqual({
      guestId: "AB2345--guest-02",
      isChild: true
    });
    expect(written(repository).guestResponses).toEqual([]);
    expect(response.guests[1]).toMatchObject({ isChild: true });
    expect(response.guests[1]?.isChildSixOrYounger).toBeUndefined();
  });

  it("clears the age answer when the operator unmarks a guest as criança", async () => {
    const repository = repositoryDouble({
      invitation: invitation([
        amanda,
        guest({
          guestId: "AB2345--guest-02",
          guestName: "Chris",
          rsvpStatus: "attending",
          isChild: true,
          isChildSixOrYounger: true
        })
      ]),
      rsvp: storedRsvp(
        [{ guestId: "AB2345--guest-02", status: "attending", isChildSixOrYounger: true }],
        { attendingGuestCount: 1, childSixOrYoungerAttendingCount: 1 }
      )
    });

    const response = await service(repository).updateGuest("AB2345", "AB2345--guest-02", {
      isChild: false,
      isChildSixOrYounger: false
    });

    expect(written(repository).guestResponses).toEqual([
      { guestId: "AB2345--guest-02", status: "attending", isChildSixOrYounger: false }
    ]);
    // The courtesy seat becomes a paying one.
    expect(written(repository).counts).toEqual({
      attendingGuestCount: 1,
      paidAttendingGuestCount: 1,
      childSixOrYoungerAttendingCount: 0
    });
    expect(response.guests[1]).toMatchObject({ isChild: false, isChildSixOrYounger: false });
  });

  it("counts a confirmed under-six guest as a courtesy seat", async () => {
    const repository = repositoryDouble({
      invitation: invitation([
        amanda,
        guest({
          guestId: "AB2345--guest-02",
          guestName: "Chris",
          isChild: true,
          isChildSixOrYounger: true
        })
      ])
    });

    await service(repository).updateGuest("AB2345", "AB2345--guest-02", {
      rsvpStatus: "attending"
    });

    expect(written(repository).counts).toEqual({
      attendingGuestCount: 1,
      paidAttendingGuestCount: 0,
      childSixOrYoungerAttendingCount: 1
    });
  });

  it("preserves an answer another guest already gave, including its meal note", async () => {
    const repository = repositoryDouble({
      rsvp: storedRsvp([
        {
          guestId: "AB2345--guest-01",
          status: "attending",
          isChildSixOrYounger: false,
          mealPreference: "vegetariano"
        }
      ])
    });

    await service(repository).updateGuest("AB2345", "AB2345--guest-02", {
      rsvpStatus: "attending"
    });

    expect(written(repository).guestResponses).toEqual([
      {
        guestId: "AB2345--guest-01",
        status: "attending",
        isChildSixOrYounger: false,
        mealPreference: "vegetariano"
      },
      { guestId: "AB2345--guest-02", status: "attending", isChildSixOrYounger: false }
    ]);
  });

  it("preserves who answered and the note the guests left", async () => {
    const repository = repositoryDouble({
      rsvp: storedRsvp([], { submittedBy: "AB2345--guest-02", note: "Música sugerida: Dreams" })
    });

    const response = await service(repository).updateGuest("AB2345", "AB2345--guest-01", {
      rsvpStatus: "attending"
    });

    expect(response.rsvp.submittedBy).toBe("AB2345--guest-02");
    expect(response.rsvp.note).toBe("Música sugerida: Dreams");
    expect(written(repository).fallbackSubmittedBy).toBe("AB2345--guest-01");
  });

  it("seeds submittedBy with the primary guest when the invitation never answered", async () => {
    const repository = repositoryDouble();

    const response = await service(repository).updateGuest("AB2345", "AB2345--guest-02", {
      rsvpStatus: "attending"
    });

    expect(written(repository).fallbackSubmittedBy).toBe("AB2345--guest-01");
    expect(response.rsvp.submittedBy).toBe("AB2345--guest-01");
    expect(response.rsvp.note).toBeUndefined();
  });

  it("rejects an unknown invitation and an unknown guest", async () => {
    const missingInvitation = repositoryDouble({ invitation: null });
    await expect(
      service(missingInvitation).updateGuest("ZY9999", "AB2345--guest-01", {
        rsvpStatus: "attending"
      })
    ).rejects.toMatchObject({ statusCode: 404, message: "Invitation not found." });
    expect(missingInvitation.applyAdminGuestEdit).not.toHaveBeenCalled();

    const repository = repositoryDouble();
    await expect(
      service(repository).updateGuest("AB2345", "AB2345--guest-99", { rsvpStatus: "attending" })
    ).rejects.toMatchObject({ statusCode: 404, message: "Guest not found." });
    expect(repository.applyAdminGuestEdit).not.toHaveBeenCalled();
  });

  it("rejects an empty patch and one that tries to un-answer a guest", async () => {
    const repository = repositoryDouble();

    await expect(
      service(repository).updateGuest("AB2345", "AB2345--guest-01", {})
    ).rejects.toThrow();
    await expect(
      service(repository).updateGuest("AB2345", "AB2345--guest-01", { rsvpStatus: "pending" })
    ).rejects.toThrow();
    expect(repository.applyAdminGuestEdit).not.toHaveBeenCalled();
  });

  it("writes no WhatsApp, email or idempotency state", async () => {
    const repository = repositoryDouble({
      rsvp: storedRsvp([], {
        websiteOperationId: "operation-1",
        websitePayloadDigest: "a".repeat(64)
      })
    });

    await service(repository).updateGuest("AB2345", "AB2345--guest-01", {
      rsvpStatus: "attending"
    });

    // The repository is the service's only collaborator, and the edit passes it nothing that
    // could message a guest, move the WhatsApp flow, or claim the RSVP's website identity.
    expect(Object.keys(repository)).toEqual([
      "applyAdminGuestEdit",
      "getInvitationByCode",
      "getRsvpResponse"
    ]);
    expect(Object.keys(written(repository)).sort()).toEqual([
      "counts",
      "fallbackSubmittedBy",
      "guestResponses",
      "invitationCode",
      "status",
      "updatedAt"
    ]);
  });
});

describe("AdminGuestRsvpService.confirmGuests", () => {
  it("confirms the selected guests and leaves the rest untouched", async () => {
    const repository = repositoryDouble({
      invitation: invitation([
        amanda,
        chris,
        guest({ guestId: "AB2345--guest-03", guestName: "Dani" })
      ])
    });

    const response = await service(repository).confirmGuests("AB2345", {
      guestIds: ["AB2345--guest-01", "AB2345--guest-03"]
    });

    expect(written(repository).guestResponses).toEqual([
      { guestId: "AB2345--guest-01", status: "attending", isChildSixOrYounger: false },
      { guestId: "AB2345--guest-03", status: "attending", isChildSixOrYounger: false }
    ]);
    expect(response.guests.map((entry) => entry.rsvpStatus)).toEqual([
      "attending",
      "pending",
      "attending"
    ]);
    expect(written(repository).status).toBe("attending");
    expect(written(repository).counts.attendingGuestCount).toBe(2);
  });

  it("overwrites an existing declined answer for a selected guest", async () => {
    const repository = repositoryDouble({
      rsvp: storedRsvp([
        { guestId: "AB2345--guest-01", status: "declined", isChildSixOrYounger: false },
        { guestId: "AB2345--guest-02", status: "declined", isChildSixOrYounger: false }
      ])
    });

    await service(repository).confirmGuests("AB2345", { guestIds: ["AB2345--guest-01"] });

    expect(written(repository).guestResponses).toEqual([
      { guestId: "AB2345--guest-01", status: "attending", isChildSixOrYounger: false },
      { guestId: "AB2345--guest-02", status: "declined", isChildSixOrYounger: false }
    ]);
    expect(written(repository).counts.attendingGuestCount).toBe(1);
  });

  it("never writes the seed child flag", async () => {
    const repository = repositoryDouble();

    await service(repository).confirmGuests("AB2345", { guestIds: ["AB2345--guest-01"] });

    expect(written(repository).guestFlags).toBeUndefined();
  });

  it("rejects an empty selection and a guest from another invitation", async () => {
    const repository = repositoryDouble();

    await expect(
      service(repository).confirmGuests("AB2345", { guestIds: [] })
    ).rejects.toThrow();
    await expect(
      service(repository).confirmGuests("AB2345", { guestIds: ["WX9999--guest-01"] })
    ).rejects.toMatchObject({ statusCode: 404, message: "Guest not found." });
    expect(repository.applyAdminGuestEdit).not.toHaveBeenCalled();
  });
});
