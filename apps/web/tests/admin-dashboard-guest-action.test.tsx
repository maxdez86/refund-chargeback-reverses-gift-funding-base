import { describe, expect, it } from "vitest";
import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import { toGuestRows } from "@/lib/admin-dashboard-model";
import { guestActionCopy } from "@/components/dashboard/modals/GuestActionModal";

const rows = toGuestRows(createFixtureDashboardSnapshot().invitations);
const rowOf = (guestId: string) => rows.find((row) => row.guestId === guestId)!;

/** Manuela seeded as criança and confirmed "6 anos ou menos" — the only real cortesia. */
const courtesy = rowOf("HL4120--guest-03");
/** Bento seeded as criança and confirmed "7 anos ou mais": a child who still pays. */
const payingChild = rowOf("HL4120--guest-04");
/** Antônio seeded as criança with nobody having answered the age question yet. */
const awaitingChild = rowOf("LB6640--guest-02");
/** Paulo, an adult whose RSVP recorded the default answer. */
const adult = rowOf("HL4120--guest-02");

describe("guestActionCopy", () => {
  it("offers to clear the seed for a criança and to set it for anyone else", () => {
    expect(guestActionCopy(courtesy, "child").confirmLabel).toBe("Desmarcar como criança");
    expect(guestActionCopy(awaitingChild, "child").confirmLabel).toBe("Desmarcar como criança");
    expect(guestActionCopy(adult, "child").confirmLabel).toBe("Marcar como criança");
  });

  it("warns only when clearing the seed would discard an answer the guest already gave", () => {
    expect(guestActionCopy(courtesy, "child").note).toMatch(/faixa etária já respondida é descartada/);
    expect(guestActionCopy(payingChild, "child").note).toMatch(
      /faixa etária já respondida é descartada/
    );
    // Nothing to discard: the age question was never answered for Antônio.
    expect(guestActionCopy(awaitingChild, "child").note).toBeUndefined();
  });

  it("says the cortesia stays the guest's to declare when seeding the flag", () => {
    expect(guestActionCopy(adult, "child").note).toMatch(/definida pelo convidado/);
    expect(guestActionCopy(adult, "child").body).toMatch(/passa a pedir a faixa etária/);
  });

  it("tells the operator whether confirming a guest adds a paying seat", () => {
    expect(guestActionCopy(courtesy, "attending").note).toMatch(/sem gerar cobrança/);
    // A criança with no confirmed age is billed until the guest answers.
    expect(guestActionCopy(awaitingChild, "attending").note).toMatch(/entra como pagante/);
    expect(guestActionCopy(payingChild, "attending").note).toBeUndefined();
    expect(guestActionCopy(adult, "attending").note).toBeUndefined();
  });
});
