import {
  AdminAddGuestsRequestSchema,
  AdminCreateInvitationRequestSchema,
  AdminCreateInvitationResponseSchema,
  AdminDeleteInvitationResponseSchema,
  AdminInvitationRsvpWriteResponseSchema,
  type AdminDashboardGuest,
  type GuestSummary,
  type HouseholdInvitation,
  type RsvpGuestAnswer
} from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { deriveAdminRsvpStatus, deriveRsvpCounts } from "../services/dynamodb/mappers";
import { WeddingRepository } from "../services/dynamodb/repositories/wedding-repository";
import type { RsvpResponseItem } from "../services/dynamodb/rsvp-items";

/**
 * Structural changes to invitations and their guest lists: creating an invitation, deleting one,
 * and adding or removing a guest.
 *
 * Like `AdminGuestRsvpService`, this is deliberately constructed with the repository alone. Creating
 * an invitation sends no WhatsApp template and no email — "Enviar WhatsApp" stays a separate,
 * deliberate operator step — and not holding a queue publisher or an `EmailService` is what makes
 * that a property of the code rather than a promise in a comment.
 */
export class AdminInvitationProvisioningService {
  constructor(private readonly repository = new WeddingRepository()) {}

  /**
   * Creates an invitation from an operator-supplied code.
   *
   * Uniqueness is the repository's conditional write, not a read-then-write here: a preceding
   * `GetItem` would only narrow the race, never close it.
   */
  async createInvitation(request: unknown) {
    const parsed = AdminCreateInvitationRequestSchema.parse(request);
    const createdAt = new Date().toISOString();

    const { invitation, guests } = await this.repository.createInvitation({
      invitationCode: parsed.invitationCode,
      householdName: parsed.householdName,
      guests: parsed.guests.map((guest, index) => ({ ...guest, slot: index + 1 })),
      ...(parsed.phoneNumber
        ? { phoneNumber: parsed.phoneNumber, phoneNumberUpdatedAt: createdAt }
        : {})
    });

    return AdminCreateInvitationResponseSchema.parse({
      ok: true,
      invitation: {
        invitationCode: invitation.invitationCode,
        householdName: invitation.householdName,
        ...(invitation.phoneNumber
          ? {
              phoneNumber: invitation.phoneNumber,
              phoneNumberSource: "operator",
              phoneNumberUpdatedAt: createdAt
            }
          : {}),
        // Nothing has been sent yet, so a first send is allowed and a resend is not, and the
        // free-text window cannot be open before the household has ever replied.
        whatsappSendAvailability: { firstAllowed: true, resendAllowed: false },
        whatsappFreeTextWindow: { open: false },
        guests: guests.map((guest) => ({
          guestId: guest.guestId,
          guestName: guest.guestName,
          allowedPlusOnes: guest.allowedPlusOnes,
          rsvpStatus: guest.rsvpStatus,
          isChild: guest.isChild
        })),
        // No `RSVP#CURRENT` item is written on create, so the aggregate reports the only honest
        // thing: nobody has been asked yet.
        rsvp: {
          status: "pending",
          updatedAt: null,
          submittedBy: null,
          attending: 0,
          paid: 0,
          childrenSixOrYounger: 0
        }
      },
      createdAt
    });
  }

  /** Hard-deletes the invitation and everything keyed to its code. */
  async deleteInvitation(invitationCode: string) {
    const deleted = await this.repository.deleteInvitationCascade(invitationCode);

    return AdminDeleteInvitationResponseSchema.parse({
      ok: true,
      invitationCode,
      deletedAt: new Date().toISOString(),
      deleted
    });
  }

  /** Appends guests to an invitation; the repository assigns their slots. */
  async addGuests(invitationCode: string, request: unknown) {
    const { guests: rows } = AdminAddGuestsRequestSchema.parse(request);
    const { invitation, stored } = await this.load(invitationCode);

    const added = await this.repository.addInvitationGuests({ invitationCode, guests: rows });

    const effective: GuestSummary[] = [
      ...invitation.guests,
      ...added.map((guest) => ({
        guestId: guest.guestId,
        guestName: guest.guestName,
        allowedPlusOnes: guest.allowedPlusOnes,
        rsvpStatus: guest.rsvpStatus,
        isChild: guest.isChild
      }))
    ];

    // A new pending guest can move a fully declined invitation back to pending, so the aggregate is
    // recomputed even though no answer changed. The stored answers are untouched: the added guests
    // have none, and writing a synthesized row would claim they had been asked.
    return this.writeAggregate(invitation, stored, effective, stored?.guestResponses ?? []);
  }

  /**
   * Removes one guest and prunes the answer they left.
   *
   * Removing the last guest is rejected rather than performed: `AdminDashboardInvitation` and the
   * write response both require at least one guest, and `AdminGuestRsvpService` reads `guests[0]`
   * unguarded, so a guestless invitation would break the next admin edit rather than merely look
   * odd. The primary guest is not special-cased here — that escalation is a UI convention, and the
   * dashboard routes it to "Excluir convite" before it ever reaches this route.
   */
  async removeGuest(invitationCode: string, guestId: string) {
    const { invitation, stored } = await this.load(invitationCode);
    if (!invitation.guests.some((guest) => guest.guestId === guestId)) {
      throw new AppError("Guest not found.", 404);
    }
    if (invitation.guests.length <= 1) {
      throw new AppError(
        "Cannot remove the last guest of an invitation. Delete the invitation instead.",
        409
      );
    }

    const effective = invitation.guests.filter((guest) => guest.guestId !== guestId);
    const guestResponses = (stored?.guestResponses ?? []).filter((row) => row.guestId !== guestId);
    const updatedAt = new Date().toISOString();

    const { status, counts, fallbackSubmittedBy } = this.deriveAggregate(effective);
    await this.repository.removeInvitationGuest({
      invitationCode,
      guestId,
      guestResponses,
      status,
      counts,
      updatedAt,
      fallbackSubmittedBy
    });

    return this.buildResponse(invitation, stored, effective, { status, counts, updatedAt, fallbackSubmittedBy });
  }

  private async load(invitationCode: string) {
    const invitation = await this.repository.getInvitationByCode(invitationCode);
    if (!invitation) throw new AppError("Invitation not found.", 404);
    const stored = await this.repository.getRsvpResponse(invitationCode);
    return { invitation, stored };
  }

  /** The invitation-wide aggregate implied by the guests that remain. */
  private deriveAggregate(effective: GuestSummary[]) {
    return {
      status: deriveAdminRsvpStatus(effective.map((guest) => ({ status: guest.rsvpStatus }))),
      counts: deriveRsvpCounts({
        guestResponses: effective.map((guest) => ({
          guestId: guest.guestId,
          status: guest.rsvpStatus,
          isChildSixOrYounger: guest.isChildSixOrYounger === true
        }))
      }),
      // Required by the item schema and only ever used on an invitation that never answered.
      fallbackSubmittedBy: effective[0]!.guestId
    };
  }

  private async writeAggregate(
    invitation: HouseholdInvitation,
    stored: RsvpResponseItem | null,
    effective: GuestSummary[],
    guestResponses: RsvpGuestAnswer[]
  ) {
    const updatedAt = new Date().toISOString();
    const { status, counts, fallbackSubmittedBy } = this.deriveAggregate(effective);

    await this.repository.applyAdminGuestEdit({
      invitationCode: invitation.invitationCode,
      guestResponses,
      status,
      counts,
      updatedAt,
      fallbackSubmittedBy
    });

    return this.buildResponse(invitation, stored, effective, { status, counts, updatedAt, fallbackSubmittedBy });
  }

  private buildResponse(
    invitation: HouseholdInvitation,
    stored: RsvpResponseItem | null,
    effective: GuestSummary[],
    aggregate: {
      status: ReturnType<typeof deriveAdminRsvpStatus>;
      counts: ReturnType<typeof deriveRsvpCounts>;
      updatedAt: string;
      fallbackSubmittedBy: string;
    }
  ) {
    const guests: AdminDashboardGuest[] = effective.map((guest) => ({
      guestId: guest.guestId,
      guestName: guest.guestName,
      allowedPlusOnes: guest.allowedPlusOnes,
      rsvpStatus: guest.rsvpStatus,
      isChild: guest.isChild,
      isChildSixOrYounger: guest.isChildSixOrYounger,
      dietaryNotes: guest.dietaryNotes
    }));

    return AdminInvitationRsvpWriteResponseSchema.parse({
      ok: true,
      invitationCode: invitation.invitationCode,
      guests,
      rsvp: {
        status: aggregate.status,
        updatedAt: aggregate.updatedAt,
        submittedBy: stored?.submittedBy ?? aggregate.fallbackSubmittedBy,
        attending: aggregate.counts.attendingGuestCount,
        paid: aggregate.counts.paidAttendingGuestCount,
        childrenSixOrYounger: aggregate.counts.childSixOrYoungerAttendingCount,
        ...(stored?.note === undefined ? {} : { note: stored.note })
      },
      updatedAt: aggregate.updatedAt
    });
  }
}
