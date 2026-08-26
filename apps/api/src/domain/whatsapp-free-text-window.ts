import {
  WhatsappFreeTextWindowSchema,
  type HouseholdInvitation,
  type WhatsappFreeTextWindow
} from "@brimax/contracts";

/** Meta's customer-service window: free-form text is deliverable for 24 h after a guest replies. */
export const WHATSAPP_FREE_TEXT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Derives whether an operator may still send free-form text to this invitation.
 *
 * An invitation that has never replied has no recorded inbound time and reports a closed
 * window — the safe default, and also what every record written before `whatsappLastInboundAt`
 * existed reports, so no backfill is required. The boundary is exclusive: a message that
 * arrived exactly 24 h ago is already outside the window.
 */
export function deriveWhatsappFreeTextWindow(
  invitation: Pick<HouseholdInvitation, "whatsappLastInboundAt">,
  now: Date
): WhatsappFreeTextWindow {
  const lastInboundAt = invitation.whatsappLastInboundAt;
  if (!lastInboundAt) return WhatsappFreeTextWindowSchema.parse({ open: false });

  const inboundMs = Date.parse(lastInboundAt);
  if (Number.isNaN(inboundMs)) return WhatsappFreeTextWindowSchema.parse({ open: false });

  const expiresAtMs = inboundMs + WHATSAPP_FREE_TEXT_WINDOW_MS;
  return WhatsappFreeTextWindowSchema.parse({
    open: now.getTime() < expiresAtMs,
    lastInboundAt: new Date(inboundMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString()
  });
}
