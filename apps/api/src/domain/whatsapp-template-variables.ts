import { InvitationCodeSchema, type HouseholdInvitation } from "@brimax/contracts";
import { AppError } from "../lib/errors";
import type {
  WhatsappStoredComponent,
  WhatsappTemplateParameter,
  WhatsappTemplateParameterSlot
} from "../services/whatsapp/schemas";

export type WhatsappDerivableParameterKey =
  | "household_name"
  | "guests"
  | "invitation_code"
  | "invitation_link_suffix";

export const WHATSAPP_DERIVABLE_PARAMETER_KEYS: readonly WhatsappDerivableParameterKey[] = [
  "household_name",
  "guests",
  "invitation_code",
  "invitation_link_suffix"
];

export const GUEST_LIST_SCOPE_BY_PURPOSE: Readonly<Record<string, "all" | "attending">> = {
  wedding_rsvp_reconfirmation: "attending",
  wedding_rsvp_pending_reminder_group: "all",
  wedding_rsvp_reconfirmation_single: "attending",
  wedding_rsvp_pending_reminder_single: "all"
};

// 270 + 100 + 560 = 930, leaving headroom below Meta's approximately 1024-character body limit.
export const HOUSEHOLD_NAME_MAX_LENGTH = 100;
export const GUEST_LIST_MAX_LENGTH = 560;
export const WHATSAPP_PARAMETER_MAX_LENGTH = 1024;

function invalidState(message: string): AppError {
  return new AppError(message, 422, "INVALID_INVITATION_STATE");
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("");
}

export function sanitizeParameterText(value: string, field: string, maxLength: number): string {
  const normalized = replaceControlCharacters(value).replace(/\s+/g, " ").trim();
  if (!normalized) throw invalidState(`Invitation ${field} is empty.`);
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
    : normalized;
}

export function extractFirstName(householdName: string): string {
  const normalized = replaceControlCharacters(householdName).replace(/\s+/g, " ").trim();
  if (!normalized) throw invalidState("Invitation household name is empty.");
  return sanitizeParameterText(normalized.split(" ", 1)[0]!, "household name", HOUSEHOLD_NAME_MAX_LENGTH);
}

export function invitationLinkSuffix(invitationCode: string): string {
  InvitationCodeSchema.parse(invitationCode);
  // The host is frozen in Meta's approved template; even dev-stage sends link to prod.
  return `?code=${encodeURIComponent(invitationCode)}#confirmar-presenca`;
}

function joinPtBr(names: string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export function formatGuestList(names: string[], maxLength: number): string {
  for (let count = names.length; count >= 1; count -= 1) {
    const hidden = names.length - count;
    const text = hidden === 0
      ? joinPtBr(names)
      : `${names.slice(0, count).join(", ")} e mais ${hidden}`;
    if (text.length <= maxLength) return text;
  }
  return sanitizeParameterText(names[0], "guest name", maxLength);
}

export function templateParameterSlots(
  components: WhatsappStoredComponent[]
): WhatsappTemplateParameterSlot[] {
  const types = new Map<string, WhatsappTemplateParameterSlot["type"]>();
  const slots: WhatsappTemplateParameterSlot[] = [];
  for (const component of components) {
    for (const slot of component.parameters) {
      if (!(WHATSAPP_DERIVABLE_PARAMETER_KEYS as readonly string[]).includes(slot.key)) {
        throw invalidState(`Unsupported WhatsApp template parameter ${slot.key}.`);
      }
      if (slot.type !== "text") {
        throw invalidState(
          `WhatsApp template parameter ${slot.key} must be a text slot; the deriver cannot produce ${slot.type}.`
        );
      }
      const previousType = types.get(slot.key);
      if (previousType && previousType !== slot.type) {
        throw invalidState(`WhatsApp template parameter ${slot.key} is declared with conflicting types.`);
      }
      types.set(slot.key, slot.type);
      slots.push(slot);
    }
  }
  return slots;
}

export function deriveTemplateParameters(
  invitation: HouseholdInvitation,
  definition: { purpose: string; components: WhatsappStoredComponent[] }
): Record<string, WhatsappTemplateParameter> {
  const slots = templateParameterSlots(definition.components);
  const keys = new Set(slots.map((slot) => slot.key));
  const values: Record<string, WhatsappTemplateParameter> = {};

  if (keys.has("household_name")) {
    values.household_name = {
      type: "text",
      text: extractFirstName(invitation.householdName)
    };
  }
  if (keys.has("invitation_code")) {
    values.invitation_code = {
      type: "text",
      text: sanitizeParameterText(invitation.invitationCode, "invitation code", WHATSAPP_PARAMETER_MAX_LENGTH)
    };
  }
  if (keys.has("invitation_link_suffix")) {
    values.invitation_link_suffix = { type: "text", text: invitationLinkSuffix(invitation.invitationCode) };
  }
  if (keys.has("guests")) {
    const scope = GUEST_LIST_SCOPE_BY_PURPOSE[definition.purpose];
    if (!scope) throw invalidState(`No guest-list scope is configured for ${definition.purpose}.`);
    const selected = scope === "attending"
      ? invitation.guests.filter((guest) => guest.rsvpStatus === "attending")
      : invitation.guests;
    if (selected.length === 0 && scope === "attending") {
      throw invalidState(
        `Invitation has no confirmed guests for ${definition.purpose}; send wedding_rsvp_pending_reminder_group instead.`
      );
    }
    const names = selected
      .map((guest) => replaceControlCharacters(guest.guestName).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (names.length === 0) throw invalidState("Invitation guest names are empty.");
    const guests = formatGuestList(names, GUEST_LIST_MAX_LENGTH);
    if (names.length > 1 && !guests.startsWith(joinPtBr(names))) {
      const shown = names.findIndex((name) => !guests.includes(name));
      console.info(JSON.stringify({
        metric: "WHATSAPP_GUEST_LIST_TRUNCATED",
        invitationCode: invitation.invitationCode,
        shown: shown < 0 ? names.length : Math.max(1, shown),
        hidden: shown < 0 ? 0 : names.length - Math.max(1, shown)
      }));
    }
    values.guests = { type: "text", text: guests };
  }

  return values;
}

/** Queue-time compatibility entry point used by the send handlers. */
export function validateWhatsappTemplateVariables(
  invitation: HouseholdInvitation,
  definition: { purpose: string; components: WhatsappStoredComponent[] }
): void {
  deriveTemplateParameters(invitation, definition);
}
