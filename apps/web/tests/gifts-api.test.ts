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
              id: "g-test-pix",
              name: "PIX Teste",
              imageUrl: "https://brimax.life/images/gifts-home.png",
              fractional: false,
              totalValueCents: 500,
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
        id: "g-test-pix",
        fullyFunded: true,
        partsFunded: 1
      })
    ]);
  });
});
