import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("index.html", () => {
  it("contains migrated brimax shell metadata", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(html).toContain('<html lang="pt-BR" class="scroll-smooth">');
    expect(html).toContain("<title>Brimax — Casamento Brida e Max</title>");
    expect(html).toContain("https://brimax.life/opengraph.jpg");
    expect(html).toContain("fonts.googleapis.com");
  });

  it("limits the landing-page hash interception to the root route", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(html).toContain("window.location.pathname === '/'");
    expect(html).toContain("window.__brimaxInitialHash = window.location.hash");
  });
});
