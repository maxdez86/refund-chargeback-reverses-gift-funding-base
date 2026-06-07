import { describe, expect, it } from "vitest";
import { INVITATION_CODE_REGEX, InvitationCodeSchema } from "@brimax/contracts";

describe("INVITATION_CODE_REGEX", () => {
  it("accepts well-formed codes", () => {
    for (const code of ["AB2345", "ZZ9999", "JK4567"]) {
      expect(INVITATION_CODE_REGEX.test(code)).toBe(true);
      expect(InvitationCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it("rejects lowercase", () => {
    expect(INVITATION_CODE_REGEX.test("ab2345")).toBe(false);
    expect(InvitationCodeSchema.safeParse("ab2345").success).toBe(false);
  });

  it("rejects ambiguous letters (I, O)", () => {
    expect(INVITATION_CODE_REGEX.test("IA2345")).toBe(false);
    expect(INVITATION_CODE_REGEX.test("OA2345")).toBe(false);
    expect(INVITATION_CODE_REGEX.test("AI2345")).toBe(false);
    expect(INVITATION_CODE_REGEX.test("AO2345")).toBe(false);
  });

  it("rejects ambiguous digits (0, 1)", () => {
    expect(INVITATION_CODE_REGEX.test("AB0345")).toBe(false);
    expect(INVITATION_CODE_REGEX.test("AB1345")).toBe(false);
    expect(INVITATION_CODE_REGEX.test("AB2340")).toBe(false);
    expect(INVITATION_CODE_REGEX.test("AB2341")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(INVITATION_CODE_REGEX.test("AB234")).toBe(false);
    expect(INVITATION_CODE_REGEX.test("AB23456")).toBe(false);
    expect(INVITATION_CODE_REGEX.test("")).toBe(false);
  });

  it("rejects wrong order (digits before letters)", () => {
    expect(INVITATION_CODE_REGEX.test("2345AB")).toBe(false);
    expect(INVITATION_CODE_REGEX.test("1234AB")).toBe(false);
  });

  it("rejects the dash-formatted display form (regex matches canonical only)", () => {
    expect(INVITATION_CODE_REGEX.test("AB-2345")).toBe(false);
  });
});
