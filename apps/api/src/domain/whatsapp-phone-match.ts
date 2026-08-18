/** Strips every non-digit so ids from different sources compare on the same footing. */
export function whatsappPhoneDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

/**
 * Exact, country-agnostic comparison of two WhatsApp ids. Only formatting is forgiven — two numbers
 * that differ by so much as one digit are different numbers, whichever country they belong to.
 */
export function whatsappPhonesMatch(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const leftDigits = whatsappPhoneDigits(left);
  if (!leftDigits) return false;
  return leftDigits === whatsappPhoneDigits(right);
}
