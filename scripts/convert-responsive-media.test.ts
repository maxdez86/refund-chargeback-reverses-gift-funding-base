import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

function createFixtureImage(outputPath: string): void {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const result = spawnSync(
    "convert",
    ["-size", "1600x900", "gradient:#f5efe3-#9f7a34", outputPath],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error(`Failed to create fixture image: ${result.stderr || result.error?.message || ""}`);
  }
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
    convertResponsiveMedia(plan);

    for (const variant of plan.variants) {
      assert.equal(existsSync(variant.outputPath), true, `missing ${variant.outputPath}`);
      assert.equal(path.basename(variant.outputPath).includes(".jpg"), false);
      assert.equal(path.basename(variant.outputPath), path.basename(variant.outputPath).toLowerCase());
    }
  }));
