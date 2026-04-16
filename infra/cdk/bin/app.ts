#!/usr/bin/env node
import path from "node:path";
import * as cdk from "aws-cdk-lib";
import { resourceName, resolveStage } from "@brimax/config";
import { AppStack } from "../lib/stacks/app-stack";
import { CertificateStack } from "../lib/stacks/certificate-stack";
import { DataStack } from "../lib/stacks/data-stack";
import { EdgeStack } from "../lib/stacks/edge-stack";
import { ObservabilityStack } from "../lib/stacks/observability-stack";
import { PlatformStack } from "../lib/stacks/platform-stack";

const app = new cdk.App();
const stage = resolveStage(app.node.tryGetContext("stage") ?? process.env.STAGE);
const rootDomain = process.env.ROOT_DOMAIN ?? "brimax.life";
const wwwDomain = `www.${rootDomain}`;
const siteAssetPath = path.resolve(__dirname, "../../../apps/web/dist");

new PlatformStack(app, resourceName("BrimaxPlatformStack", stage), {
  stage
});

const certificateStack = new CertificateStack(app, resourceName("BrimaxCertificateStack", stage), {
  rootDomain,
  stage,
  wwwDomain
});

const dataStack = new DataStack(app, resourceName("BrimaxDataStack", stage), {
  stage
});

const appStack = new AppStack(app, resourceName("BrimaxAppStack", stage), {
  stage,
  table: dataStack.table
});

const edgeStack = new EdgeStack(app, resourceName("BrimaxEdgeStack", stage), {
  certificate: certificateStack.certificate,
  rootDomain,
  siteAssetPath,
  stage,
  wwwDomain
});

new ObservabilityStack(app, resourceName("BrimaxObservabilityStack", stage), {
  stage,
  distribution: edgeStack.distribution,
  httpApi: appStack.httpApi,
  table: dataStack.table
});

edgeStack.addDependency(certificateStack);
