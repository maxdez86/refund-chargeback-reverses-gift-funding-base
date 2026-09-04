import {
  AdminConfirmGuestsRequestSchema,
  AdminGuestUpdateRequestSchema,
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

/** The invitation-wide state one admin edit rewrites, before it is persisted. */
type EditPlan = {
  /** Rows actually stored on `RSVP#CURRENT` — sparse, so an untouched guest keeps "no answer". */
  guestResponses: RsvpGuestAnswer[];
  /** Every guest's effective answer, used for the aggregates and for the response payload. */
  effective: GuestSummary[];
};

/**
 * Admin corrections to the RSVP of guests who already exist on an invitation.
 *
 * This service is deliberately constructed with the repository alone. `RsvpService.submit()` also
 * sends the couple's notification email, reserves and enqueues a WhatsApp follow-up template, moves
 * `whatsappFlowStatus`, and claims the RSVP's website idempotency identity — an admin edit does
 * none of that. Not holding an `EmailService`, a template repository or a queue publisher is what
 * makes "an admin correction never messages the guest" a property of the code rather than a promise
 * in a comment.
 */
export class AdminGuestRsvpService {
  constructor(private readonly repository = new WeddingRepository()) {}

  /** Sets one guest's RSVP status, seed child flag, and/or confirmed age band. */
  async updateGuest(invitationCode: string, guestId: string, request: unknown) {
    const patch = AdminGuestUpdateRequestSchema.parse(request);
    const { invitation, stored } = await this.load(invitationCode);
    if (!invitation.guests.some((guest) => guest.guestId === guestId)) {
      throw new AppError("Guest not found.", 404);
    }

    const plan = this.planEdit(invitation, stored, (guest, row) => {
      if (guest.guestId !== guestId) return row;
      return {
        ...row,
        ...(patch.rsvpStatus === undefined ? {} : { status: patch.rsvpStatus }),
        ...(patch.isChildSixOrYounger === undefined
          ? {}
          : { isChildSixOrYounger: patch.isChildSixOrYounger })
      };
    });

    return this.persist(invitation, stored, plan, {
      ...(patch.isChild === undefined ? {} : { guestFlags: { guestId, isChild: patch.isChild } })
    });
  }

  /**
   * Confirms the selected guests of one invitation.
   *
   * Guests left out of `guestIds` keep the status they already had, which is what the confirmation
   * modal tells the operator. A selected guest who had declined becomes attending — correcting a
   * wrong "não vai" is the reason the control exists.
   */
  async confirmGuests(invitationCode: string, request: unknown) {
    const { guestIds } = AdminConfirmGuestsRequestSchema.parse(request);
    const { invitation, stored } = await this.load(invitationCode);
    const known = new Set(invitation.guests.map((guest) => guest.guestId));
    if (guestIds.some((guestId) => !known.has(guestId))) {
      throw new AppError("Guest not found.", 404);
    }

    const selected = new Set(guestIds);
    const plan = this.planEdit(invitation, stored, (guest, row) =>
      selected.has(guest.guestId) ? { ...row, status: "attending" as const } : row
    );

    return this.persist(invitation, stored, plan, {});
  }

  private async load(invitationCode: string) {
    const invitation = await this.repository.getInvitationByCode(invitationCode);
    if (!invitation) throw new AppError("Invitation not found.", 404);
    const stored = await this.repository.getRsvpResponse(invitationCode);
    return { invitation, stored };
  }

  /**
   * Merges one edit into the invitation's answers.
   *
   * `apply` receives the row a guest would have — their stored answer, or one synthesized from
   * their current effective state — and returns the row the edit wants. A synthesized row is only
   * persisted when the edit actually changed it, so confirming one guest never invents an age
   * answer for the rest of the household.
   */
  private planEdit(
    invitation: HouseholdInvitation,
    stored: RsvpResponseItem | null,
    apply: (guest: GuestSummary, row: RsvpGuestAnswer) => RsvpGuestAnswer
  ): EditPlan {
    const storedById = new Map(stored?.guestResponses.map((row) => [row.guestId, row]) ?? []);
    const guestResponses: RsvpGuestAnswer[] = [];
    const effective: EditPlan["effective"] = [];

    for (const guest of invitation.guests) {
      const existing = storedById.get(guest.guestId);
      // A guest with no stored answer is treated as holding their seed state. `guest.rsvpStatus`
      // is already the effective merge, and it equals the seed exactly when no answer overrides it.
      const base: RsvpGuestAnswer = existing ?? {
        guestId: guest.guestId,
        status: "pending",
        isChildSixOrYounger: guest.isChildSixOrYounger ?? false
      };
      const next = apply(guest, base);
      // Compared by content, not identity: a patch that only moves the seed child flag leaves the
      // answer untouched, and must not persist a synthesized row claiming an age band nobody gave.
      const changed = !sameAnswer(base, next);
      const stores = Boolean(existing) || changed;
      if (stores) guestResponses.push(next);

      // The dashboard resolves a `pending` answer against the seed status, so the effective view
      // has to do the same or the stored aggregates would not match the guest list beside them.
      effective.push({
        ...guest,
        rsvpStatus: next.status === "pending" ? guest.rsvpStatus : next.status,
        isChildSixOrYounger: stores ? next.isChildSixOrYounger : guest.isChildSixOrYounger
      });
    }

    return { guestResponses, effective };
  }

  private async persist(
    invitation: HouseholdInvitation,
    stored: RsvpResponseItem | null,
    plan: EditPlan,
    options: { guestFlags?: { guestId: string; isChild: boolean } }
  ) {
    const counts = deriveRsvpCounts({
      guestResponses: plan.effective.map((guest) => ({
        guestId: guest.guestId,
        status: guest.rsvpStatus,
        isChildSixOrYounger: guest.isChildSixOrYounger === true
      }))
    });
    const status = deriveAdminRsvpStatus(
      plan.effective.map((guest) => ({ status: guest.rsvpStatus }))
    );
    const updatedAt = new Date().toISOString();
    // Required by the item schema and only ever used when the invitation has never answered. The
    // primary guest is the same value the website form submits and the panel already falls back to.
    const fallbackSubmittedBy = invitation.guests[0]!.guestId;

    await this.repository.applyAdminGuestEdit({
      invitationCode: invitation.invitationCode,
      guestResponses: plan.guestResponses,
      status,
      counts,
      updatedAt,
      fallbackSubmittedBy,
      ...options
    });

    const guests: AdminDashboardGuest[] = plan.effective.map((guest) => ({
      guestId: guest.guestId,
      guestName: guest.guestName,
      allowedPlusOnes: guest.allowedPlusOnes,
      rsvpStatus: guest.rsvpStatus,
      isChild:
        options.guestFlags?.guestId === guest.guestId ? options.guestFlags.isChild : guest.isChild,
      isChildSixOrYounger: guest.isChildSixOrYounger,
      dietaryNotes: guest.dietaryNotes
    }));

    return AdminInvitationRsvpWriteResponseSchema.parse({
      ok: true,
      invitationCode: invitation.invitationCode,
      guests,
      rsvp: {
        status,
        updatedAt,
        submittedBy: stored?.submittedBy ?? fallbackSubmittedBy,
        attending: counts.attendingGuestCount,
        paid: counts.paidAttendingGuestCount,
        childrenSixOrYounger: counts.childSixOrYoungerAttendingCount,
        ...(stored?.note === undefined ? {} : { note: stored.note })
      },
      updatedAt
    });
  }
}

/** Whether two answers for the same guest carry identical content. */
function sameAnswer(left: RsvpGuestAnswer, right: RsvpGuestAnswer) {
  return (
    left.status === right.status &&
    left.isChildSixOrYounger === right.isChildSixOrYounger &&
    left.mealPreference === right.mealPreference &&
    left.note === right.note
  );
}
