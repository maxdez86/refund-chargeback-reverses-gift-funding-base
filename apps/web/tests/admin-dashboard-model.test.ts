import { describe, expect, it } from "vitest";
import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import {
  GIFT_PART_CENTS,
  attentionMessage,
  deriveGift,
  filterGifts,
  filterGuests,
  filterInvitations,
  filterMusicSuggestions,
  giftBadge,
  courtesyState,
  giftTileClasses,
  guestFlags,
  isPrimaryGuest,
  isValidGiftTotal,
  messageFallback,
  needsAttention,
  recalculateRsvp,
  sendAvailability,
  templateLabel,
  templateForSend,
  toGuestRows,
  toMusicSuggestionRows,
  trailingInboundCount
} from "@/lib/admin-dashboard-model";
import type { AdminGift, AdminGuest, AdminInvitation } from "@/lib/admin-dashboard-types";

const snapshot = createFixtureDashboardSnapshot();
const byCode = (code: string) =>
  snapshot.invitations.find((invitation) => invitation.invitationCode === code) as AdminInvitation;

const guest = (overrides: Partial<AdminGuest> = {}): AdminGuest => ({
  guestId: "X0001--guest-01",
  guestName: "Convidado",
  isChild: false,
  allowedPlusOnes: 0,
  rsvpStatus: "pending",
  ...overrides
});

describe("invitation selectors", () => {
  it("flattens invitations into one row per person with a 1-based order", () => {
    const rows = toGuestRows(snapshot.invitations);
    expect(rows).toHaveLength(
      snapshot.invitations.reduce((sum, invitation) => sum + invitation.guests.length, 0)
    );
    const tavares = rows.filter((row) => row.invitationCode === "HL4120");
    expect(tavares.map((row) => row.sortOrder)).toEqual([1, 2, 3, 4]);
    expect(tavares[0].householdName).toBe("Família Tavares");
  });

  it("treats the first guest on an invitation as the primary one", () => {
    const invitation = byCode("HL4120");
    expect(isPrimaryGuest(invitation, "HL4120--guest-01")).toBe(true);
    expect(isPrimaryGuest(invitation, "HL4120--guest-03")).toBe(false);
  });

  it("flags invitations whose flow cannot advance on its own", () => {
    expect(needsAttention(byCode("LB6640"))).toBe(true); // failed send
    expect(needsAttention(byCode("QP8814"))).toBe(true); // reconciliation required
    expect(needsAttention(byCode("MV2093"))).toBe(false);
  });

  it("explains why an invitation needs attention, failure first", () => {
    expect(attentionMessage(byCode("LB6640"))).toMatch(/falhou após 3 tentativas/);
    expect(attentionMessage(byCode("QP8814"))).toMatch(/reconciliar manualmente/);
    expect(attentionMessage(byCode("MV2093"))).toBeNull();
  });

  it("filters invitations by RSVP status, attention and free text", () => {
    const all = snapshot.invitations;
    expect(filterInvitations(all, "Todos", "")).toHaveLength(all.length);
    expect(
      filterInvitations(all, "Confirmados", "").every((i) => i.rsvp.status === "attending")
    ).toBe(true);
    expect(filterInvitations(all, "Requer atenção", "").map((i) => i.invitationCode)).toEqual([
      "QP8814",
      "LB6640"
    ]);
    expect(filterInvitations(all, "Todos", "tavares").map((i) => i.invitationCode)).toEqual([
      "HL4120"
    ]);
    // Search covers the phone number, not just the code and household.
    expect(filterInvitations(all, "Todos", "5511914362818")).toHaveLength(1);
  });

  it("filters guests by status, courtesy and free text", () => {
    const rows = toGuestRows(snapshot.invitations);
    // Only a confirmed "6 anos ou menos" is a cortesia — Bento is a criança who pays.
    expect(filterGuests(rows, "Cortesias", "").map((row) => row.guestName)).toEqual([
      "Manuela Tavares"
    ]);
    expect(filterGuests(rows, "Pendentes", "").every((row) => row.rsvpStatus === "pending")).toBe(
      true
    );
    expect(filterGuests(rows, "Todos", "bento").map((row) => row.guestName)).toEqual([
      "Bento Tavares"
    ]);
    // The guest id is searchable so an operator can paste one straight from a log.
    expect(filterGuests(rows, "Todos", "hl4120--guest-02")).toHaveLength(1);
  });
});

describe("recalculateRsvp", () => {
  const previous = {
    status: "pending" as const,
    updatedAt: "2026-01-01T00:00:00Z",
    submittedBy: null,
    attending: 0,
    paid: 0,
    childrenSixOrYounger: 0
  };

  it("counts attending seats and excludes courtesies from the paying ones", () => {
    const result = recalculateRsvp(
      [
        guest({ guestId: "a", rsvpStatus: "attending", isChildSixOrYounger: false }),
        guest({
          guestId: "b",
          rsvpStatus: "attending",
          isChild: true,
          isChildSixOrYounger: true
        }),
        guest({ guestId: "c", rsvpStatus: "declined", isChildSixOrYounger: false })
      ],
      previous,
      "2026-08-20T10:00:00Z"
    );
    expect(result).toMatchObject({
      status: "attending",
      attending: 2,
      paid: 1,
      childrenSixOrYounger: 1,
      updatedAt: "2026-08-20T10:00:00Z"
    });
  });

  it("charges a criança until the guest confirms the age band", () => {
    const rows = [
      // Seeded as a criança, but nobody has answered the age question yet.
      guest({ guestId: "a", rsvpStatus: "attending", isChild: true }),
      // Answered "7 anos ou mais": a criança who keeps a paying seat.
      guest({ guestId: "b", rsvpStatus: "attending", isChild: true, isChildSixOrYounger: false })
    ];
    expect(recalculateRsvp(rows, previous, "t")).toMatchObject({
      attending: 2,
      paid: 2,
      childrenSixOrYounger: 0
    });
  });

  it("falls back to pending while anyone is undecided, and declined only when all are", () => {
    expect(
      recalculateRsvp([guest({ rsvpStatus: "pending" }), guest({ rsvpStatus: "declined" })], previous, "t")
        .status
    ).toBe("pending");
    expect(recalculateRsvp([guest({ rsvpStatus: "declined" })], previous, "t").status).toBe(
      "declined"
    );
  });

  it("agrees with every roll-up the fixtures declare", () => {
    // Guards the drift that let "criança" and "cortesia" mean the same thing: a hand-written
    // fixture total that no longer matches its own guests is a broken demo.
    for (const invitation of snapshot.invitations) {
      expect({
        code: invitation.invitationCode,
        ...recalculateRsvp(
          invitation.guests,
          invitation.rsvp,
          invitation.rsvp.updatedAt ?? "2026-01-01T00:00:00Z"
        )
      }).toMatchObject({ code: invitation.invitationCode, ...invitation.rsvp });
    }
  });
});

describe("courtesy state", () => {
  it("separates the operator seed from the answer only the guest can give", () => {
    expect(courtesyState(guest({ isChild: true, isChildSixOrYounger: true }))).toBe("courtesy");
    expect(courtesyState(guest({ isChild: true, isChildSixOrYounger: false }))).toBe("paying");
    expect(courtesyState(guest({ isChild: true }))).toBe("awaiting");
    expect(courtesyState(guest())).toBe("not-applicable");
    // The RSVP submits `false` for every adult without ever asking them, so that default is
    // not an age answer and must not read as one.
    expect(courtesyState(guest({ isChildSixOrYounger: false }))).toBe("not-applicable");
  });

  it("lists criança and cortesia as separate markers", () => {
    expect(guestFlags(guest({ isChild: true, isChildSixOrYounger: true }))).toEqual([
      "criança",
      "cortesia"
    ]);
    expect(guestFlags(guest({ isChild: true }))).toEqual(["criança"]);
    expect(guestFlags(guest())).toEqual([]);
  });
});

describe("WhatsApp send availability", () => {
  it("keeps legacy and internal template identifiers readable", () => {
    expect(templateLabel("wedding_invitation")).toBe("Convite enviado");
    expect(templateLabel("__whatsapp_fallback_text__")).toBe(
      "Modelo __whatsapp_fallback_text__"
    );
  });

  it("offers a first send only to invitations that were never contacted", () => {
    const fresh: AdminInvitation = {
      ...byCode("SW2748"),
      commands: [],
      whatsappFlowStatus: "idle",
      whatsappFlowCompletedAt: null,
      whatsappSendAvailability: { firstAllowed: true, resendAllowed: false }
    };
    expect(sendAvailability(fresh)).toMatchObject({ firstAllowed: true, resendAllowed: false });
    expect(sendAvailability(byCode("SW2748"))).toMatchObject({
      firstAllowed: false,
      resendAllowed: false
    });
  });

  it("uses authoritative resend availability for failed, undecided, and completed-pending flows", () => {
    expect(sendAvailability(byCode("LB6640")).resendAllowed).toBe(true); // failed
    expect(sendAvailability(byCode("QP8814")).resendAllowed).toBe(false); // reconciliation required
    expect(sendAvailability(byCode("ZR5567")).resendAllowed).toBe(true); // undecided
    expect(sendAvailability(byCode("MV2093")).resendAllowed).toBe(false); // completed
    const completedPending: AdminInvitation = {
      ...byCode("ZR5567"),
      whatsappFlowStatus: "completed",
      whatsappFlowCompletedAt: "2026-08-26T16:54:07.954Z",
      whatsappSendAvailability: {
        firstAllowed: false,
        resendAllowed: true,
        resendReason: "completed_pending"
      }
    };
    expect(sendAvailability(completedPending)).toMatchObject({
      resendAllowed: true,
      completedPending: true,
      resendReason: "completed_pending"
    });
  });

  it("mirrors confirmed/pending and single/group automatic template selection", () => {
    expect(templateForSend(byCode("ZR5567"), "first")).toBe("wedding_rsvp_pending_reminder_group");
    expect(templateForSend(byCode("LB6640"), "resend")).toBe("wedding_rsvp_pending_reminder_group");
    expect(templateForSend(byCode("ZR5567"), "resend")).toBe(
      "wedding_rsvp_pending_reminder_group"
    );
    expect(templateForSend(byCode("QP8814"), "resend")).toBe(
      "wedding_rsvp_pending_reminder_single"
    );
    const singleConfirmed = {
      ...byCode("QP8814"),
      guests: [{ ...byCode("QP8814").guests[0], rsvpStatus: "attending" as const }]
    };
    const groupConfirmed = {
      ...byCode("ZR5567"),
      guests: byCode("ZR5567").guests.map((guest, index) => ({
        ...guest,
        rsvpStatus: index === 0 ? "attending" as const : guest.rsvpStatus
      }))
    };
    expect(templateForSend(singleConfirmed, "first")).toBe("wedding_rsvp_reconfirmation_single");
    expect(templateForSend(groupConfirmed, "resend")).toBe("wedding_rsvp_reconfirmation");
  });
});

describe("music suggestions", () => {
  const withNote = (
    code: string,
    note: string | undefined,
    updatedAt: string | null
  ): AdminInvitation => ({
    ...byCode("MV2093"),
    invitationCode: code,
    householdName: `Convite ${code}`,
    rsvp: { ...byCode("MV2093").rsvp, note, updatedAt }
  });

  it("strips the site prefix and keeps a bare note as written", () => {
    const rows = toMusicSuggestionRows([
      withNote("AA2222", "Música sugerida: Evidências - Chitãozinho e Xororó", "2026-08-01T10:00:00Z"),
      withNote("BB3333", "Trem-Bala - Ana Vilela", "2026-08-02T10:00:00Z")
    ]);
    expect(rows.map((row) => row.music)).toEqual([
      "Trem-Bala - Ana Vilela",
      "Evidências - Chitãozinho e Xororó"
    ]);
  });

  it("skips invitations with no note or only whitespace", () => {
    const rows = toMusicSuggestionRows([
      withNote("AA2222", undefined, "2026-08-01T10:00:00Z"),
      withNote("BB3333", "Música sugerida:    ", "2026-08-02T10:00:00Z"),
      withNote("CC4444", "Música sugerida: Sozinho - Caetano Veloso", "2026-08-03T10:00:00Z")
    ]);
    expect(rows.map((row) => row.invitationCode)).toEqual(["CC4444"]);
  });

  it("does not invent a date for a malformed note without an RSVP timestamp", () => {
    expect(
      toMusicSuggestionRows([
        withNote("AA2222", "Música sugerida: Trem-Bala - Ana Vilela", null)
      ])
    ).toEqual([]);
  });

  it("sorts newest first and carries the invitation's RSVP status", () => {
    const rows = toMusicSuggestionRows(snapshot.invitations);
    expect(rows.map((row) => row.invitationCode)).toEqual([
      "SW2748",
      "TX6935",
      "HL4120",
      "RQ7712",
      "MV2093"
    ]);
    // A guest who later declined still gets to keep their song on the list.
    expect(rows.find((row) => row.invitationCode === "RQ7712")?.rsvpStatus).toBe("declined");
  });

  it("searches by code, household name and song text", () => {
    const rows = toMusicSuggestionRows(snapshot.invitations);
    expect(filterMusicSuggestions(rows, "")).toHaveLength(rows.length);
    expect(filterMusicSuggestions(rows, "sw2748").map((row) => row.invitationCode)).toEqual([
      "SW2748"
    ]);
    expect(filterMusicSuggestions(rows, "tavares").map((row) => row.invitationCode)).toEqual([
      "HL4120"
    ]);
    expect(filterMusicSuggestions(rows, "legião").map((row) => row.invitationCode)).toEqual([
      "RQ7712"
    ]);
    expect(filterMusicSuggestions(rows, "bohemian rhapsody")).toEqual([]);
  });
});

describe("gift derivation", () => {
  const base = {
    id: "g-test",
    name: "Teste",
    image: "teste",
    partsFunded: 0,
    partsReserved: 0,
    paused: false,
    photoUrl: null,
    updatedAt: "2026-08-01T00:00:00Z",
    version: 1
  };

  it("splits a fractional total into R$ 50,00 quotas", () => {
    const gift = deriveGift({ ...base, fractional: true, totalValueCents: 120_000 });
    expect(gift.totalParts).toBe(120_000 / GIFT_PART_CENTS);
    expect(gift.partValueCents).toBe(GIFT_PART_CENTS);
    expect(gift.fullyFunded).toBe(false);
  });

  it("prices a single item as one whole unit", () => {
    const gift = deriveGift({ ...base, fractional: false, totalValueCents: 6_900, partsFunded: 1 });
    expect(gift.totalParts).toBeNull();
    expect(gift.partValueCents).toBeNull();
    expect(gift.confirmedAmountCents).toBe(6_900);
    expect(gift.fullyFunded).toBe(true);
    expect(gift.availableAmountCents).toBe(0);
  });

  it("subtracts confirmed and reserved money from what is still available", () => {
    const gift = deriveGift({
      ...base,
      fractional: true,
      totalValueCents: 100_000,
      partsFunded: 10,
      partsReserved: 4
    });
    expect(gift.confirmedAmountCents).toBe(50_000);
    expect(gift.reservedAmountCents).toBe(20_000);
    expect(gift.availableAmountCents).toBe(30_000);
    expect(gift.availableParts).toBe(6);
  });

  it("labels the catalog state, with pausing taking priority over progress", () => {
    const funded = deriveGift({
      ...base,
      fractional: true,
      totalValueCents: 100_000,
      partsFunded: 20
    });
    expect(giftBadge(funded).label).toBe("COMPLETO");
    expect(giftBadge({ ...funded, paused: true }).label).toBe("PAUSADO");
    expect(giftBadge({ ...funded, partsFunded: 1, fullyFunded: false }).label).toBe("EM ANDAMENTO");
    expect(giftBadge({ ...funded, partsFunded: 0, fullyFunded: false }).label).toBe("DISPONÍVEL");
  });

  it("accepts only positive totals, and quota multiples when fractional", () => {
    expect(isValidGiftTotal(145_000, true)).toBe(true);
    expect(isValidGiftTotal(145_001, true)).toBe(false);
    expect(isValidGiftTotal(6_900, false)).toBe(true);
    expect(isValidGiftTotal(0, false)).toBe(false);
  });

  it("gives a gift the same placeholder tile every time", () => {
    expect(giftTileClasses("g-sofa")).toBe(giftTileClasses("g-sofa"));
    expect(giftTileClasses("g-sofa")).toMatch(/^bg-admin-tile-[1-6]-bg text-admin-tile-[1-6]-fg$/);
  });

  it("filters gifts by catalog state and free text", () => {
    const gifts = snapshot.gifts as AdminGift[];
    expect(filterGifts(gifts, "Pausados", "").map((gift) => gift.id)).toEqual(["g-adega"]);
    expect(filterGifts(gifts, "Completos", "").every((gift) => gift.fullyFunded)).toBe(true);
    expect(filterGifts(gifts, "Em andamento", "").map((gift) => gift.id)).toEqual([
      "g-jogo-jantar",
      "g-lua-de-mel",
      "g-cama-box",
      "g-panelas",
      "g-robo"
    ]);
    expect(filterGifts(gifts, "Todos", "noronha").map((gift) => gift.id)).toEqual(["g-lua-de-mel"]);
  });
});

describe("WhatsApp message display helpers", () => {
  it("names a bodyless message by template, then by media type, then generically", () => {
    expect(messageFallback({ templateId: "wedding_invitation", messageType: "template" })).toBe(
      "Mensagem de modelo: wedding_invitation"
    );
    expect(messageFallback({ messageType: "image" })).toBe("Mensagem image");
    expect(messageFallback({ messageType: "text" })).toBe("Mensagem sem texto disponível");
    expect(messageFallback({})).toBe("Mensagem sem texto disponível");
    expect(messageFallback({ buttonAction: "decline", buttonId: "rsvp_b2_decline" })).toBe("Não vai");
    expect(messageFallback({ buttonId: "unknown_button", messageType: "button_reply" })).toBe(
      "Resposta por botão: unknown_button"
    );
  });

  it("counts the trailing inbound run and nothing before it", () => {
    const at = (index: number) => `2026-08-20T1${index}:00:00Z`;
    const message = (direction: "inbound" | "outbound", index: number) => ({
      messageId: `m${index}`, direction, sentAt: at(index), text: `#${index}`
    });

    expect(trailingInboundCount([])).toBe(0);
    expect(trailingInboundCount([message("inbound", 0), message("outbound", 1)])).toBe(0);
    expect(
      trailingInboundCount([
        message("inbound", 0),
        message("outbound", 1),
        message("inbound", 2),
        message("inbound", 3)
      ])
    ).toBe(2);
    expect(trailingInboundCount([message("inbound", 0), message("inbound", 1)])).toBe(2);
  });
});
