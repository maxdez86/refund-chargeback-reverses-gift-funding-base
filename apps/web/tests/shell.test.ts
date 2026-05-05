import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("index.html", () => {
  it("contains migrated brimax shell metadata", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(html).toContain('<html lang="pt-BR" class="scroll-smooth">');
    expect(html).toContain("<title>Brimax — Casamento Brida e Max</title>");
    expect(html).toContain("raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures/6.jpg");
    expect(html).toContain("fonts.googleapis.com");
  });
});
