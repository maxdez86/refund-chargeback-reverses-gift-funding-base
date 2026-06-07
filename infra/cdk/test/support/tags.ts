import * as cdk from "aws-cdk-lib";
import { type AppStage } from "@brimax/config";

export function applyCostAllocationTags(app: cdk.App, stage: AppStage) {
  cdk.Tags.of(app).add("project", "brimax-life");
  cdk.Tags.of(app).add("stage", stage);
}
