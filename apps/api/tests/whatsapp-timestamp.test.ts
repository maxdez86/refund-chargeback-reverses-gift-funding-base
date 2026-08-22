import { describe, expect, it } from "vitest";
import { normalizeWhatsappTimestamp } from "../src/domain/whatsapp-timestamp";

const FALLBACK = "2026-08-21T18:00:00.000Z";

describe("normalizeWhatsappTimestamp", () => {
  it("normalizes Meta Unix seconds to ISO-8601", () => {
    expect(normalizeWhatsappTimestamp("1603059201", FALLBACK)).toEqual({
      timestamp: "2020-10-18T22:13:21.000Z",
      source: "provider"
    });
  });

  it.each([undefined, "", "1", "1603059201.5", "not-a-time", "175000000000", "1750000000000"])(
    "uses processing time for invalid or missing provider timestamp %s",
    (value) => {
      expect(normalizeWhatsappTimestamp(value, FALLBACK)).toEqual({
        timestamp: FALLBACK,
        source: "processing"
      });
    }
  );

  it("accepts a distant but correctly shaped Unix-seconds timestamp", () => {
    expect(normalizeWhatsappTimestamp("9999999999", FALLBACK)).toEqual({
      timestamp: "2286-11-20T17:46:39.000Z",
      source: "provider"
    });
  });
});
