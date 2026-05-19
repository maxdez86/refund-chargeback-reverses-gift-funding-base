import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type SharedSection = "story" | "padrinhos" | "presentes";
export type DeviceSection = "hero" | "footer";
export type MediaSection = SharedSection | DeviceSection;
export type PhotographicFormat = "avif" | "webp" | "jpeg";

type VariantManifest = {
  sections: Record<string, unknown>;
  variantStrategies: {
    deviceSpecific: {
      sections: string[];
      devices: string[];
      formats: string[];
    };
    sharedCropWidths: {
      sections: string[];
      widths: string[];
      formats: string[];
    };
  };
};

export type SharedVariant = {
  kind: "shared";
  width: number;
  format: PhotographicFormat;
  outputPath: string;
};

export type DeviceVariant = {
  kind: "device";
  device: string;
  width: number;
  format: PhotographicFormat;
  outputPath: string;
};

export type ConversionVariant = SharedVariant | DeviceVariant;

export type ConversionPlan = {
  sourcePath: string;
  section: MediaSection;
  slug: string | null;
  variants: ConversionVariant[];
  warnings: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../..");
const MANIFEST_PATH = path.join(
  DEFAULT_REPO_ROOT,
  "docs/architecture/responsive-media-bucket-tree-v2.manifest.json",
);
const KEBAB_CASE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEVICE_WIDTHS: Record<string, number> = {
  mobile: 767,
  tablet: 1279,
  desktop: 1920,
};
const PRESERVATION_FIRST_QUALITY = "100";

function assertMediaSection(value: string): asserts value is MediaSection {
  if (!["story", "padrinhos", "presentes", "hero", "footer"].includes(value)) {
    throw new Error(
      `Unsupported section "${value}". Expected one of: story, padrinhos, presentes, hero, footer.`,
    );
  }
}

export function loadResponsiveMediaManifest(
  manifestPath: string = MANIFEST_PATH,
): VariantManifest {
  const json = readFileSync(manifestPath, "utf8");
  return JSON.parse(json) as VariantManifest;
}

export function slugifyAssetName(filename: string): string {
  return path
    .basename(filename, path.extname(filename))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function isKebabCaseSlug(value: string): boolean {
  return KEBAB_CASE_REGEX.test(value);
}

export function resolveSourcePath(sourcePath: string, repoRoot: string = DEFAULT_REPO_ROOT): string {
  return path.isAbsolute(sourcePath) ? sourcePath : path.resolve(repoRoot, sourcePath);
}

export function buildConversionPlan(args: {
  sourcePath: string;
  section: string;
  repoRoot?: string;
  manifest?: VariantManifest;
}): ConversionPlan {
  const repoRoot = args.repoRoot ?? DEFAULT_REPO_ROOT;
  const manifest = args.manifest ?? loadResponsiveMediaManifest();

  assertMediaSection(args.section);

  const sourcePath = resolveSourcePath(args.sourcePath, repoRoot);
  if (!existsSync(sourcePath)) {
    throw new Error(`Source image not found: ${sourcePath}`);
  }

  const sharedStrategy = manifest.variantStrategies.sharedCropWidths;
  const deviceStrategy = manifest.variantStrategies.deviceSpecific;
  const section = args.section;

  const warnings: string[] = [];

  if (sharedStrategy.sections.includes(section)) {
    const slug = slugifyAssetName(sourcePath);
    if (!slug) {
      throw new Error(`Could not derive a slug from source filename: ${sourcePath}`);
    }
    if (!isKebabCaseSlug(slug)) {
      throw new Error(`Derived slug is not valid kebab-case: ${slug}`);
    }

    const sectionEntries = manifest.sections[section];
    if (sectionEntries && typeof sectionEntries === "object" && !Array.isArray(sectionEntries)) {
      const slugEntries = (sectionEntries as Record<string, unknown>)[slug];
      if (!slugEntries) {
        warnings.push(
          `Manifest does not list slug "${slug}" under section "${section}". Generation will continue.`,
        );
      }
    }

    const formats = sharedStrategy.formats as PhotographicFormat[];
    const widths = sharedStrategy.widths.map((value) => Number.parseInt(value, 10));
    const variants: SharedVariant[] = [];

    for (const width of widths) {
      for (const format of formats) {
        variants.push({
          kind: "shared",
          width,
          format,
          outputPath: path.join(repoRoot, "images", section, slug, `${width}.${format}`),
        });
      }
    }

    return {
      sourcePath,
      section,
      slug,
      variants,
      warnings,
    };
  }

  const formats = deviceStrategy.formats as PhotographicFormat[];
  const variants: DeviceVariant[] = [];
  for (const device of deviceStrategy.devices) {
    const width = DEVICE_WIDTHS[device];
    if (!width) {
      throw new Error(`No resize width is configured for device "${device}".`);
    }
    for (const format of formats) {
      variants.push({
        kind: "device",
        device,
        width,
        format,
        outputPath: path.join(repoRoot, "images", section, `${device}.${format}`),
      });
    }
  }

  return {
    sourcePath,
    section,
    slug: null,
    variants,
    warnings,
  };
}

export function ensureConvertAvailable(): void {
  const result = spawnSync("convert", ["-version"], {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error || result.status !== 0) {
    throw new Error("ImageMagick `convert` is required but was not found or failed to start.");
  }
}

function buildConvertArgs(sourcePath: string, variant: ConversionVariant): string[] {
  const args = [sourcePath, "-auto-orient", "-resize", `${variant.width}x>`];

  if (variant.format === "avif") {
    args.push("-define", "heic:speed=0");
  }

  args.push("-quality", PRESERVATION_FIRST_QUALITY, variant.outputPath);
  return args;
}

function runConvert(sourcePath: string, variant: ConversionVariant): void {
  const result = spawnSync("convert", buildConvertArgs(sourcePath, variant), {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(
      `ImageMagick failed for ${path.basename(variant.outputPath)}.${stderr ? ` ${stderr}` : ""}`,
    );
  }
}

export function convertResponsiveMedia(plan: ConversionPlan): ConversionPlan {
  ensureConvertAvailable();

  for (const warning of plan.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  for (const variant of plan.variants) {
    mkdirSync(path.dirname(variant.outputPath), { recursive: true });
    runConvert(plan.sourcePath, variant);
  }

  return plan;
}

export function formatPlanSummary(plan: ConversionPlan): string[] {
  const lines = [
    `Source: ${plan.sourcePath}`,
    `Section: ${plan.section}`,
  ];

  if (plan.slug) {
    lines.push(`Slug: ${plan.slug}`);
  }

  for (const variant of plan.variants) {
    lines.push(`Wrote: ${variant.outputPath}`);
  }

  return lines;
}

