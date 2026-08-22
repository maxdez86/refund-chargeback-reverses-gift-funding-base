import { describe, expect, it, vi } from "vitest";
import { AdminDashboardService } from "../src/domain/admin-dashboard-service";

const emptyGiftResponse = { ok: true as const, gifts: [] };

describe("AdminDashboardService", () => {
  it("starts all independent top-level reads concurrently", async () => {
    let resolveInvitations!: (value: []) => void;
    let resolveGifts!: (value: typeof emptyGiftResponse) => void;
    let resolveMessages!: (value: { ok: true; messages: []; nextCursor: null }) => void;
    const repository = {
      listAdminDashboardInvitations: vi.fn(() => new Promise<[]>(resolve => { resolveInvitations = resolve; }))
    };
    const giftService = {
      getGifts: vi.fn(() => new Promise<typeof emptyGiftResponse>(resolve => { resolveGifts = resolve; }))
    };
    const guestMessageService = {
      list: vi.fn(() => new Promise<{ ok: true; messages: []; nextCursor: null }>(resolve => { resolveMessages = resolve; }))
    };
    const service = new AdminDashboardService(
      repository as never,
      giftService as never,
      guestMessageService as never
    );

    const pending = service.getDashboard();
    expect(repository.listAdminDashboardInvitations).toHaveBeenCalledTimes(1);
    expect(giftService.getGifts).toHaveBeenCalledTimes(1);
    expect(guestMessageService.list).toHaveBeenCalledWith(null);

    resolveInvitations([]);
    resolveGifts(emptyGiftResponse);
    resolveMessages({ ok: true, messages: [], nextCursor: null });
    await expect(pending).resolves.toEqual({
      ok: true,
      invitations: [],
      gifts: [],
      guestMessages: []
    });
  });

  it("drains every guest-message page in newest-first order", async () => {
    const first = {
      messageId: "newer",
      authorName: "Ana",
      message: "Mensagem nova",
      createdAt: "2026-08-20T13:00:00.000Z"
    };
    const second = {
      messageId: "older",
      authorName: "Bia",
      message: "Mensagem antiga",
      createdAt: "2026-08-20T12:00:00.000Z"
    };
    const guestMessageService = {
      list: vi.fn()
        .mockResolvedValueOnce({ ok: true, messages: [first], nextCursor: "cursor-2" })
        .mockResolvedValueOnce({ ok: true, messages: [second], nextCursor: null })
    };
    const service = new AdminDashboardService(
      { listAdminDashboardInvitations: vi.fn().mockResolvedValue([]) } as never,
      { getGifts: vi.fn().mockResolvedValue(emptyGiftResponse) } as never,
      guestMessageService as never
    );

    const result = await service.getDashboard();

    expect(guestMessageService.list.mock.calls).toEqual([[null], ["cursor-2"]]);
    expect(result.guestMessages).toEqual([first, second]);
  });

  it("rejects a repeated guest-message cursor instead of looping or returning duplicate pages", async () => {
    const guestMessageService = {
      list: vi.fn().mockResolvedValue({ ok: true, messages: [], nextCursor: "cursor-2" })
    };
    const service = new AdminDashboardService(
      { listAdminDashboardInvitations: vi.fn().mockResolvedValue([]) } as never,
      { getGifts: vi.fn().mockResolvedValue(emptyGiftResponse) } as never,
      guestMessageService as never
    );

    await expect(service.getDashboard()).rejects.toThrow(
      "Guest-message pagination returned a repeated cursor."
    );
    expect(guestMessageService.list.mock.calls).toEqual([[null], ["cursor-2"]]);
  });

  it("rejects invalid assembled output and dependency failures", async () => {
    const invalidService = new AdminDashboardService(
      { listAdminDashboardInvitations: vi.fn().mockResolvedValue([{ invitationCode: "bad" }]) } as never,
      { getGifts: vi.fn().mockResolvedValue(emptyGiftResponse) } as never,
      { list: vi.fn().mockResolvedValue({ ok: true, messages: [], nextCursor: null }) } as never
    );
    await expect(invalidService.getDashboard()).rejects.toThrow();

    const failure = new Error("DynamoDB unavailable");
    const failingService = new AdminDashboardService(
      { listAdminDashboardInvitations: vi.fn().mockRejectedValue(failure) } as never,
      { getGifts: vi.fn().mockResolvedValue(emptyGiftResponse) } as never,
      { list: vi.fn().mockResolvedValue({ ok: true, messages: [], nextCursor: null }) } as never
    );
    await expect(failingService.getDashboard()).rejects.toBe(failure);
  });
});
