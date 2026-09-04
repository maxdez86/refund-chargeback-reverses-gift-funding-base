import { describe, expect, it, vi } from "vitest";
import { AdminInvitationCodeService } from "../src/domain/admin-invitation-code-service";

describe("AdminInvitationCodeService", () => {
  it("returns the first free code", async () => {
    const repository = { listInvitationCodes: vi.fn().mockResolvedValue(["AA2222", "AA2224"]) };
    await expect(new AdminInvitationCodeService(repository as never).getNextCode()).resolves.toEqual({
      ok: true,
      invitationCode: "AA2223"
    });
  });
});
