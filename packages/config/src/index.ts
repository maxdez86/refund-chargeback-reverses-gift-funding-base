export const APP_STAGES = ["prod", "dev"] as const;
export const DEFAULT_STAGE = "prod" as const;

export * from "./gifts";

export type AppStage = (typeof APP_STAGES)[number];

export function resolveStage(value: string | undefined): AppStage {
  return value === "dev" ? "dev" : DEFAULT_STAGE;
}

export function isProductionStage(stage: AppStage): boolean {
  return stage === "prod";
}

export function stageNamePrefix(stage: AppStage): string {
  return isProductionStage(stage) ? "" : "dev-";
}

export function resourceName(baseName: string, stage: AppStage): string {
  return `${stageNamePrefix(stage)}${baseName}`;
}

export function stageResourceName(baseName: string, stage: AppStage): string {
  return resourceName(baseName, stage);
}

export function stageRootDomain(stage: AppStage, productionDomain = "brimax.life"): string {
  return isProductionStage(stage) ? productionDomain : `dev.${productionDomain}`;
}

export function stageWwwDomain(stage: AppStage, productionDomain = "brimax.life"): string {
  return `www.${stageRootDomain(stage, productionDomain)}`;
}

export function stageApiDomain(stage: AppStage, productionDomain = "brimax.life"): string {
  return `api.${stageRootDomain(stage, productionDomain)}`;
}

export function stageSiteUrl(stage: AppStage, productionDomain = "brimax.life"): string {
  return `https://${stageRootDomain(stage, productionDomain)}`;
}

export function stageAllowedOrigins(stage: AppStage, productionDomain = "brimax.life"): string[] {
  return [
    stageSiteUrl(stage, productionDomain),
    `https://${stageWwwDomain(stage, productionDomain)}`
  ];
}
