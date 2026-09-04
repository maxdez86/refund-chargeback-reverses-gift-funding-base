import { describe, expect, it } from "vitest";
import { findNextAvailableInvitationCode } from "@brimax/contracts";

describe("findNextAvailableInvitationCode", () => {
  it("returns the first valid code", () => {
    expect(findNextAvailableInvitationCode([])).toBe("AA2222");
  });

  it("reuses the first gap", () => {
    expect(findNextAvailableInvitationCode(["AA2222", "AA2224", "AA2223"])).toBe("AA2225");
    expect(findNextAvailableInvitationCode(["AA2222", "AA2224"])).toBe("AA2223");
  });

  it("ignores malformed and unrelated values", () => {
    expect(findNextAvailableInvitationCode(["AA2222", "bad", "aa2223", "ZZ9999"])).toBe("AA2223");
  });
});
