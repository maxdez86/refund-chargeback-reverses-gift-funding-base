import { describe, expect, it } from "vitest";
import type { HouseholdInvitation } from "@brimax/contracts";
import {
  WHATSAPP_FREE_TEXT_WINDOW_MS,
  deriveWhatsappFreeTextWindow
} from "../src/domain/whatsapp-free-text-window";

const at = (iso: string) => new Date(iso);
const invitation = (whatsappLastInboundAt?: string) =>
  ({ whatsappLastInboundAt }) as Pick<HouseholdInvitation, "whatsappLastInboundAt">;

describe("deriveWhatsappFreeTextWindow", () => {
  it("reports a closed window for an invitation that has never replied", () => {
    expect(deriveWhatsappFreeTextWindow(invitation(), at("2026-08-20T12:00:00.000Z")))
      .toEqual({ open: false });
  });

  it("opens the window inside 24 hours and publishes when it lapses", () => {
    expect(deriveWhatsappFreeTextWindow(
      invitation("2026-08-20T12:00:00.000Z"),
      at("2026-08-20T23:59:59.000Z")
    )).toEqual({
      open: true,
      lastInboundAt: "2026-08-20T12:00:00.000Z",
      expiresAt: "2026-08-21T12:00:00.000Z"
    });
  });

  it("closes the window once 24 hours have elapsed, keeping the timestamps", () => {
    expect(deriveWhatsappFreeTextWindow(
      invitation("2026-08-20T12:00:00.000Z"),
      at("2026-08-21T12:30:00.000Z")
    )).toEqual({
      open: false,
      lastInboundAt: "2026-08-20T12:00:00.000Z",
      expiresAt: "2026-08-21T12:00:00.000Z"
    });
  });

  it("treats the exact boundary as closed", () => {
    const lastInboundAt = "2026-08-20T12:00:00.000Z";
    const boundary = new Date(Date.parse(lastInboundAt) + WHATSAPP_FREE_TEXT_WINDOW_MS);
    expect(deriveWhatsappFreeTextWindow(invitation(lastInboundAt), boundary).open).toBe(false);
    expect(deriveWhatsappFreeTextWindow(invitation(lastInboundAt), new Date(boundary.getTime() - 1)).open).toBe(true);
  });

  it("falls back to a closed window for an unparsable stored timestamp", () => {
    expect(deriveWhatsappFreeTextWindow(invitation("not-a-date"), at("2026-08-20T12:00:00.000Z")))
      .toEqual({ open: false });
  });
});
