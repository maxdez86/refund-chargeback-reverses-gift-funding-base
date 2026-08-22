import type { WhatsappTimestampSource } from "@brimax/contracts";

export type NormalizedWhatsappTimestamp = {
  timestamp: string;
  source: WhatsappTimestampSource;
};

/** Converts Meta's Unix-seconds string without accepting partial or lossy numeric input. */
export function normalizeWhatsappTimestamp(
  providerTimestamp: string | undefined,
  processingTimestamp: string
): NormalizedWhatsappTimestamp {
  if (/^\d{10}$/.test(providerTimestamp ?? "")) {
    const milliseconds = Number(providerTimestamp) * 1_000;
    if (Number.isSafeInteger(milliseconds)) {
      try {
        return { timestamp: new Date(milliseconds).toISOString(), source: "provider" };
      } catch {
        // Fall through to the caller-supplied processing timestamp.
      }
    }
  }

  return { timestamp: new Date(processingTimestamp).toISOString(), source: "processing" };
}
