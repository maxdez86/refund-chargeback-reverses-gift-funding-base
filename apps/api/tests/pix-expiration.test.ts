import { describe, expect, it, vi } from "vitest";
import { normalizePixExpiresAt } from "../src/domain/pix-expiration";

describe("normalizePixExpiresAt", () => {
  it("converts Asaas local timestamps into ISO 8601 with Sao Paulo offset", () => {
    expect(normalizePixExpiresAt("2027-05-10 23:59:59", "asaas")).toBe("2027-05-10T23:59:59-03:00");
  });

  it("returns undefined for missing values", () => {
    expect(normalizePixExpiresAt(undefined, "asaas")).toBeUndefined();
    expect(normalizePixExpiresAt("   ", "asaas")).toBeUndefined();
  });

  it("passes through ISO values unchanged", () => {
    expect(normalizePixExpiresAt("2027-05-10T23:59:59-03:00", "asaas")).toBe("2027-05-10T23:59:59-03:00");
    expect(normalizePixExpiresAt("2027-05-11T02:59:59.000Z", "asaas")).toBe("2027-05-11T02:59:59.000Z");
  });

  it("logs and omits malformed values", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(normalizePixExpiresAt("not-a-date", "asaas")).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      JSON.stringify({
        metric: "PIX_EXPIRATION_NORMALIZATION_FAILED",
        source: "asaas",
        value: "not-a-date"
      })
    );

    warnSpy.mockRestore();
  });
});
