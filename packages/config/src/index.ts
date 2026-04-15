export const APP_STAGES = ["dev", "prod"] as const;

export type AppStage = (typeof APP_STAGES)[number];

export function resolveStage(value: string | undefined): AppStage {
  return value === "prod" ? "prod" : "dev";
}

export function stageResourceName(baseName: string, stage: AppStage): string {
  return `${baseName}-${stage}`;
}
