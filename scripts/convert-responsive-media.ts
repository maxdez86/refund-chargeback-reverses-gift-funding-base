import {
  buildConversionPlan,
  convertResponsiveMedia,
  formatPlanSummary,
} from "./lib/responsive-media-convert.ts";

function printUsage(): void {
  console.error("Usage: pnpm media:convert -- <sourcePath> <section>");
}

function main(): void {
  const [sourcePath, section] = process.argv.slice(2);

  if (!sourcePath || !section) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    const plan = buildConversionPlan({ sourcePath, section });
    convertResponsiveMedia(plan);
    for (const line of formatPlanSummary(plan)) {
      console.log(line);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

main();

