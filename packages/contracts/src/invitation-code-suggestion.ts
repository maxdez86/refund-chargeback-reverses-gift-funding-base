import {
  INVITATION_CODE_ALPHABET,
  INVITATION_CODE_DIGITS,
  INVITATION_CODE_REGEX
} from "./invitation-code";

const CODE_SPACE_SIZE = INVITATION_CODE_ALPHABET.length ** 2 * INVITATION_CODE_DIGITS.length ** 4;

/** Returns the first valid code not present in the supplied set, or null when exhausted. */
export function findNextAvailableInvitationCode(existingCodes: Iterable<string>): string | null {
  const occupied = new Set(existingCodes);

  for (let value = 0; value < CODE_SPACE_SIZE; value += 1) {
    let remainder = value;
    const digits = Array.from({ length: 4 }, () => {
      const digit = INVITATION_CODE_DIGITS[remainder % INVITATION_CODE_DIGITS.length]!;
      remainder = Math.floor(remainder / INVITATION_CODE_DIGITS.length);
      return digit;
    }).reverse().join("");
    const letters =
      INVITATION_CODE_ALPHABET[Math.floor(remainder / INVITATION_CODE_ALPHABET.length)]!
      + INVITATION_CODE_ALPHABET[remainder % INVITATION_CODE_ALPHABET.length]!;
    const code = `${letters}${digits}`;
    if (!occupied.has(code) && INVITATION_CODE_REGEX.test(code)) return code;
  }

  return null;
}
