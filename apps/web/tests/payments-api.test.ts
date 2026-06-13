import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("discardPayment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockReturnValue("idem-discard-1"),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the discard request with an idempotency key and parses the payment", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          payment: {
            paymentId: "payment/1",
            paymentMethod: "HOSTED",
            status: "CANCELED",
            amountCents: 10_000,
            currency: "BRL",
            gift: {
              id: "gift-1",
              name: "Gift",
              fractional: false,
              quantity: 1,
              unitAmountCents: null,
              amountCents: 10_000,
            },
            createdAt: "2026-06-13T10:00:00.000Z",
            updatedAt: "2026-06-13T10:01:00.000Z",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    const { discardPayment } = await import("@/lib/payments-api");

    await expect(discardPayment("payment/1")).resolves.toEqual(
      expect.objectContaining({ status: "CANCELED" })
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/payments/payment%2F1/discard",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem-discard-1",
        },
      }
    );
  });

  it("surfaces the backend message on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Checkout ainda está ativo." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      })
    );
    const { discardPayment, PaymentApiError } = await import("@/lib/payments-api");

    await expect(discardPayment("payment-1")).rejects.toEqual(
      new PaymentApiError("Checkout ainda está ativo.", 409)
    );
  });
});
