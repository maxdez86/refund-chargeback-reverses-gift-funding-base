import { afterEach, describe, expect, it, vi } from "vitest";

describe("gifts-api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("parses the gifts response shape", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          gifts: [
            {
              id: "g-toalhas-banho",
              name: "4 Toalhas de Banho",
              image: "toalhas-banho",
              fractional: false,
              totalValueCents: 17_600,
              partValueCents: null,
              totalParts: null,
              partsFunded: 1,
              fullyFunded: true,
              updatedAt: "2026-05-13T00:00:00.000Z"
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );

    const { getGifts } = await import("@/lib/gifts-api");
    const gifts = await getGifts();

    expect(gifts).toEqual([
      expect.objectContaining({
        id: "g-toalhas-banho",
        fullyFunded: true,
        partsFunded: 1
      })
    ]);
  });
});
