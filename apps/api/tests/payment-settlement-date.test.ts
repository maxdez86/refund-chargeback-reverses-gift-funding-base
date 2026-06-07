import { describe, expect, it, vi } from "vitest";
import { normalizeSettlementDate } from "../src/domain/payment-settlement-date";

describe("normalizeSettlementDate", () => {
  it("accepts canonical date strings unchanged", () => {
    expect(normalizeSettlementDate("2026-05-10", "confirmedOn")).toBe("2026-05-10");
  });

  it("returns undefined for missing values", () => {
    expect(normalizeSettlementDate(undefined, "confirmedOn")).toBeUndefined();
    expect(normalizeSettlementDate("   ", "receivedOn")).toBeUndefined();
  });

  it("logs and omits malformed values", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(normalizeSettlementDate("2026-05-10T14:48:20Z", "receivedOn")).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      JSON.stringify({
        metric: "PAYMENT_SETTLEMENT_DATE_NORMALIZATION_FAILED",
        source: "asaas",
        field: "receivedOn",
        value: "2026-05-10T14:48:20Z"
      })
    );

    warnSpy.mockRestore();
  });
});
