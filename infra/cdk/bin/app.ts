#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { resolveStage } from "@brimax/config";
import { AppStack } from "../lib/stacks/app-stack";
import { DataStack } from "../lib/stacks/data-stack";
import { EdgeStack } from "../lib/stacks/edge-stack";
import { ObservabilityStack } from "../lib/stacks/observability-stack";

const app = new cdk.App();
const stage = resolveStage(app.node.tryGetContext("stage") ?? process.env.STAGE);

const dataStack = new DataStack(app, `BrimaxDataStack-${stage}`, {
  stage
});

const appStack = new AppStack(app, `BrimaxAppStack-${stage}`, {
  stage,
  table: dataStack.table
});

const edgeStack = new EdgeStack(app, `BrimaxEdgeStack-${stage}`, {
  stage
});

new ObservabilityStack(app, `BrimaxObservabilityStack-${stage}`, {
  stage,
  distribution: edgeStack.distribution,
  httpApi: appStack.httpApi,
  table: dataStack.table
});
