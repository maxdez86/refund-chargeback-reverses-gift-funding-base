import { afterEach, describe, expect, it } from "vitest";
import {
  clearInvitationCodeFromUrl,
  readInvitationCodeFromSearch,
} from "@/lib/rsvp-deep-link";

describe("readInvitationCodeFromSearch", () => {
  it("normalizes a lowercase code to uppercase", () => {
    expect(readInvitationCodeFromSearch("?code=ab2345")).toBe("AB2345");
  });

  it("strips punctuation and whitespace while normalizing", () => {
    expect(readInvitationCodeFromSearch("?code=ab-23 45")).toBe("AB2345");
  });

  it("returns null when the param is missing", () => {
    expect(readInvitationCodeFromSearch("?other=1")).toBeNull();
    expect(readInvitationCodeFromSearch("")).toBeNull();
  });

  it("returns null when the param is empty after normalization", () => {
    expect(readInvitationCodeFromSearch("?code=")).toBeNull();
    expect(readInvitationCodeFromSearch("?code=---")).toBeNull();
  });
});

describe("clearInvitationCodeFromUrl", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("removes the code param while preserving the hash", () => {
    window.history.replaceState({}, "", "/?code=AB2345#confirmar-presenca");

    clearInvitationCodeFromUrl();

    expect(new URLSearchParams(window.location.search).has("code")).toBe(false);
    expect(window.location.hash).toBe("#confirmar-presenca");
  });

  it("is a no-op when the code param is absent", () => {
    window.history.replaceState({}, "", "/?other=1#confirmar-presenca");

    clearInvitationCodeFromUrl();

    expect(window.location.search).toBe("?other=1");
    expect(window.location.hash).toBe("#confirmar-presenca");
  });
});
