import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("index.html", () => {
  it("contains the updated pt-BR shell metadata", () => {
    const currentPackagePath = resolve(process.cwd(), "index.html");
    const repoRootPath = resolve(process.cwd(), "apps/web/index.html");
    const html = readFileSync(existsSync(currentPackagePath) ? currentPackagePath : repoRootPath, "utf8");

    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain("<title>Brida e Max | 06/12/2026</title>");
    expect(html).toContain('name="description"');
    expect(html).toContain("fonts.googleapis.com");
  });
});
