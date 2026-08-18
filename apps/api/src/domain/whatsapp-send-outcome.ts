import { WhatsappApiError, type WhatsappErrorCategory } from "../services/whatsapp/client";

export type WhatsappSendOutcome = "retryable" | "permanent" | "ambiguous";

export function classifyWhatsappSendError(error: unknown): {
  outcome: WhatsappSendOutcome;
  category?: WhatsappErrorCategory;
  providerCode?: number;
} {
  if (!(error instanceof WhatsappApiError)) return { outcome: "permanent" };

  switch (error.category) {
    case "network":
    case "timeout":
    case "ambiguous_delivery":
      return { outcome: "ambiguous", category: error.category, providerCode: error.providerCode };
    case "rate_limited":
    case "transient":
      return error.retryable
        ? { outcome: "retryable", category: error.category, providerCode: error.providerCode }
        : { outcome: "permanent", category: error.category, providerCode: error.providerCode };
    case "invalid_request":
    case "unauthorized":
    case "invalid_response":
      return { outcome: "permanent", category: error.category, providerCode: error.providerCode };
    default: {
      const exhaustive: never = error.category;
      return exhaustive;
    }
  }
}
