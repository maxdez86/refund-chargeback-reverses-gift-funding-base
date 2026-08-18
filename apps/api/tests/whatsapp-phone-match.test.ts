import { describe, expect, it } from "vitest";
import { whatsappPhoneDigits, whatsappPhonesMatch } from "../src/domain/whatsapp-phone-match";

describe("WhatsApp phone matching", () => {
  it("strips formatting down to digits", () => {
    expect(whatsappPhoneDigits("+55 (11) 96365-6517")).toBe("5511963656517");
    expect(whatsappPhoneDigits("+1 415-555-1234")).toBe("14155551234");
    expect(whatsappPhoneDigits("")).toBe("");
  });

  it("ignores punctuation and spacing when comparing", () => {
    expect(whatsappPhonesMatch("+55 (11) 96365-6517", "5511963656517")).toBe(true);
    expect(whatsappPhonesMatch("5511963656517", "+55 11 96365 6517")).toBe(true);
  });

  it("no longer treats the two Brazilian formats as the same number", () => {
    expect(whatsappPhonesMatch("551163656517", "5511963656517")).toBe(false);
    expect(whatsappPhonesMatch("5511963656517", "551163656517")).toBe(false);
  });

  it("matches numbers from every guest region on their exact digits", () => {
    expect(whatsappPhonesMatch("+1 (415) 555-1234", "14155551234")).toBe(true);
    expect(whatsappPhonesMatch("+1 (604) 555-9876", "16045559876")).toBe(true);
    expect(whatsappPhonesMatch("+61 412 345 678", "61412345678")).toBe(true);
    expect(whatsappPhonesMatch("+66 81 234 5678", "66812345678")).toBe(true);
  });

  it("rejects same-region numbers that differ by a digit", () => {
    expect(whatsappPhonesMatch("14155551234", "14155551235")).toBe(false);
    expect(whatsappPhonesMatch("61412345678", "6141234567")).toBe(false);
    expect(whatsappPhonesMatch("66812345678", "6681234567")).toBe(false);
  });

  it("does not match unrelated senders", () => {
    expect(whatsappPhonesMatch("5511999999999", "5511963656517")).toBe(false);
    expect(whatsappPhonesMatch(undefined, "5511963656517")).toBe(false);
    expect(whatsappPhonesMatch("5511963656517", undefined)).toBe(false);
  });

  it("never matches on blank input", () => {
    expect(whatsappPhonesMatch("", "")).toBe(false);
    expect(whatsappPhonesMatch("+-()", "+-()")).toBe(false);
    expect(whatsappPhonesMatch("+-()", "5511963656517")).toBe(false);
  });
});
