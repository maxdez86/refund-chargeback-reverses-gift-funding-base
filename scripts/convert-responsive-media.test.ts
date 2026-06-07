import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildConversionPlan,
  convertResponsiveMedia,
  isKebabCaseSlug,
  slugifyAssetName,
} from "./lib/responsive-media-convert.ts";

const manifest = {
  sections: {
    story: {
      "o-ultimo-primeiro-beijo": [],
    },
    padrinhos: {
      alice: [],
    },
    presentes: {},
    hero: [],
    footer: [],
  },
  variantStrategies: {
    deviceSpecific: {
      sections: ["hero", "footer"],
      devices: ["mobile", "tablet", "desktop"],
      formats: ["avif", "webp", "jpeg"],
    },
    sharedCropWidths: {
      sections: ["story", "padrinhos", "presentes"],
      widths: ["480", "960", "1440"],
      formats: ["avif", "webp", "jpeg"],
    },
  },
} as const;

function withTempDir(fn: (tempDir: string) => void): Promise<void> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responsive-media-"));
  return Promise.resolve()
    .then(() => fn(tempDir))
    .finally(() => rmSync(tempDir, { recursive: true, force: true }));
}

function withMockConvert(tempDir: string, fn: () => void): void {
  const binDir = path.join(tempDir, "bin");
  const convertPath = path.join(binDir, "convert");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    convertPath,
    `#!/usr/bin/env node
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "-version") {
  process.stdout.write("mock-convert 1.0.0\\n");
  process.exit(0);
}

const outputPath = args.at(-1);
if (!outputPath || outputPath.startsWith("-")) {
  process.stderr.write("missing output path\\n");
  process.exit(1);
}

const sourcePath = args[0];
if (sourcePath && !sourcePath.startsWith("-") && !existsSync(sourcePath)) {
  process.stderr.write(\`source not found: \${sourcePath}\\n\`);
  process.exit(1);
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, "mock-image");
`,
    "utf8",
  );
  chmodSync(convertPath, 0o755);

  const originalPath = process.env.PATH ?? "";
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;

  try {
    fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

function createFixtureImage(outputPath: string): void {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, "fixture-image");
}

test("slugifyAssetName applies the architecture naming rules", () => {
  assert.equal(slugifyAssetName("Alice.jpeg"), "alice");
  assert.equal(slugifyAssetName("Ana Clara.jpeg"), "ana-clara");
  assert.equal(slugifyAssetName("Kelly-e-Sa.jpeg"), "kelly-e-sa");
  assert.equal(slugifyAssetName("Cristiane e Juliano.jpeg"), "cristiane-e-juliano");
  assert.equal(slugifyAssetName("Sá.jpeg"), "sa");
  assert.equal(slugifyAssetName("Elís.jpeg"), "elis");
  assert.equal(slugifyAssetName("Débora.jpeg"), "debora");
  assert.equal(isKebabCaseSlug("alice"), true);
  assert.equal(isKebabCaseSlug("ana-clara"), true);
  assert.equal(isKebabCaseSlug("Ana-Clara"), false);
});

test("buildConversionPlan resolves shared-width paths under the slug directory", () =>
  withTempDir((tempDir) => {
    const sourcePath = path.join(tempDir, "images/old/padrinhos/Alice.jpeg");
    createFixtureImage(sourcePath);

    const plan = buildConversionPlan({
      sourcePath,
      section: "padrinhos",
      repoRoot: tempDir,
      manifest,
    });

    assert.equal(plan.slug, "alice");
    assert.equal(plan.variants.length, 9);
    assert.equal(plan.variants[0]?.outputPath, path.join(tempDir, "images/padrinhos/alice/480.avif"));
    assert.equal(plan.variants[8]?.outputPath, path.join(tempDir, "images/padrinhos/alice/1440.jpeg"));
  }));

test("buildConversionPlan resolves hero and footer device targets without a slug", () =>
  withTempDir((tempDir) => {
    const sourcePath = path.join(tempDir, "images/old/hero_footer/hero.jpeg");
    createFixtureImage(sourcePath);

    const plan = buildConversionPlan({
      sourcePath,
      section: "hero",
      repoRoot: tempDir,
      manifest,
    });

    assert.equal(plan.slug, null);
    assert.equal(plan.variants.length, 9);
    assert.equal(plan.variants[0]?.outputPath, path.join(tempDir, "images/hero/mobile.avif"));
    assert.equal(plan.variants[8]?.outputPath, path.join(tempDir, "images/hero/desktop.jpeg"));
  }));

test("convertResponsiveMedia writes the full output set for a shared-width section", () =>
  withTempDir((tempDir) => {
    const sourcePath = path.join(tempDir, "images/old/story/o-ultimo-primeiro-beijo.jpeg");
    createFixtureImage(sourcePath);

    const plan = buildConversionPlan({
      sourcePath,
      section: "story",
      repoRoot: tempDir,
      manifest,
    });

    assert.equal(plan.slug, "o-ultimo-primeiro-beijo");
    withMockConvert(tempDir, () => {
      convertResponsiveMedia(plan);
    });

    for (const variant of plan.variants) {
      assert.equal(existsSync(variant.outputPath), true, `missing ${variant.outputPath}`);
      assert.equal(path.basename(variant.outputPath).includes(".jpg"), false);
      assert.equal(path.basename(variant.outputPath), path.basename(variant.outputPath).toLowerCase());
    }
  }));
