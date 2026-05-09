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
const apiDomain = process.env.API_DOMAIN ?? `api.${rootDomain}`;
const wwwDomain = `www.${rootDomain}`;
const siteAssetPath = path.resolve(__dirname, "../../../apps/web/dist");
const rawAsaasApiKey = process.env.ASAAS_API_KEY;
const rawAsaasWebhookToken = process.env.ASAAS_WEBHOOK_TOKEN;

function requestedStackNames() {
  return process.argv.filter((arg) => /^([a-z0-9-]+)?Brimax[A-Za-z]+Stack$/i.test(arg));
}

function requiresPaymentSecretsForThisInvocation() {
  const requestedStacks = requestedStackNames();

  if (requestedStacks.length === 0) {
    return false;
  }

  const paymentManagedStacks = new Set([
    resourceName("BrimaxAppStack", stage),
    resourceName("BrimaxObservabilityStack", stage)
  ]);

  return requestedStacks.some((stackName) => paymentManagedStacks.has(stackName));
}

function requirePaymentDeploySecrets() {
  const missing = [];

  if (!rawAsaasApiKey) {
    missing.push("ASAAS_API_KEY");
  }

  if (!rawAsaasWebhookToken) {
    missing.push("ASAAS_WEBHOOK_TOKEN");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required payment deployment env vars: ${missing.join(", ")}. ` +
        "CDK manages the Asaas Secrets Manager entries from these raw values."
    );
  }
}

if (requiresPaymentSecretsForThisInvocation()) {
  requirePaymentDeploySecrets();
}

const asaasApiKey = rawAsaasApiKey ?? "cdk-placeholder-asaas-api-key";
const asaasWebhookToken = rawAsaasWebhookToken ?? "cdk-placeholder-asaas-webhook-token";

new PlatformStack(app, resourceName("BrimaxPlatformStack", stage), {
  stage
});

const certificateStack = new CertificateStack(app, resourceName("BrimaxCertificateStack", stage), {
  apiDomain,
  rootDomain,
  stage,
  wwwDomain
});

const dataStack = new DataStack(app, resourceName("BrimaxDataStack", stage), {
  stage
});

const appStack = new AppStack(app, resourceName("BrimaxAppStack", stage), {
  apiCertificate: certificateStack.apiCertificate,
  apiDomain,
  asaasApiKey,
  asaasWebhookToken,
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
