#!/usr/bin/env node
import path from "node:path";
import * as cdk from "aws-cdk-lib";
import { resourceName, resolveStage, stageRootDomain } from "@brimax/config";
import { AppStack } from "../lib/stacks/app-stack";
import { CertificateStack } from "../lib/stacks/certificate-stack";
import { DataStack } from "../lib/stacks/data-stack";
import { EdgeStack } from "../lib/stacks/edge-stack";
import { GithubOidcStack } from "../lib/stacks/github-oidc-stack";
import { ObservabilityStack } from "../lib/stacks/observability-stack";
import { PlatformStack } from "../lib/stacks/platform-stack";

const app = new cdk.App();
const stage = resolveStage(app.node.tryGetContext("stage") ?? process.env.STAGE);
cdk.Tags.of(app).add("project", "brimax-life");
cdk.Tags.of(app).add("stage", stage);
// Region is hard-pinned: the CloudFront viewer cert (CertificateStack) MUST live
// in us-east-1, and the regional API Gateway cert must match the API region.
// Account stays portable via CDK_DEFAULT_ACCOUNT (set by the CDK CLI from the
// active profile). Bootstrap must exist in us-east-1 for the target account.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" };
const rootDomain = process.env.ROOT_DOMAIN ?? stageRootDomain(stage);
const apiDomain = process.env.API_DOMAIN ?? `api.${rootDomain}`;
const wwwDomain = process.env.WWW_DOMAIN ?? `www.${rootDomain}`;
const contactEmail = process.env.CONTACT_EMAIL ?? "casamento@brimax.life";
const siteAssetPath = path.resolve(__dirname, "../../../apps/web/dist");
const rawAsaasApiKey = process.env.ASAAS_API_KEY;
const rawAsaasWebhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
const rawTurnstileSecretKey = process.env.TURNSTILE_SECRET_KEY;
const rawSentryDsn = process.env.SENTRY_DSN?.trim();
const rawObservabilityAlertEmail = process.env.OBSERVABILITY_ALERT_EMAIL?.trim();
const rawXrayEnabled = process.env.XRAY_ENABLED?.trim().toLowerCase();
const xrayEnabled = rawXrayEnabled ? rawXrayEnabled === "true" : stage === "prod";

// Cloudflare's documented always-passes test key. Lets non-prod synth/deploys
// succeed without provisioning a real Turnstile site; prod must override.
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

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

  if (stage === "prod" && !rawTurnstileSecretKey) {
    missing.push("TURNSTILE_SECRET_KEY");
  }

  if (!rawSentryDsn) {
    missing.push("SENTRY_DSN");
  }

  if (stage === "prod" && !rawObservabilityAlertEmail) {
    missing.push("OBSERVABILITY_ALERT_EMAIL");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required deployment env vars for stage "${stage}": ${missing.join(", ")}. ` +
        "CDK manages the Asaas + Turnstile Secrets Manager entries from these raw values, and the backend Sentry DSN must come from the OpenTofu Sentry module."
    );
  }
}

if (requiresPaymentSecretsForThisInvocation()) {
  requirePaymentDeploySecrets();
}

const asaasApiKey = rawAsaasApiKey ?? "cdk-placeholder-asaas-api-key";
const asaasWebhookToken = rawAsaasWebhookToken ?? "cdk-placeholder-asaas-webhook-token";
const turnstileSecretKey = rawTurnstileSecretKey ?? TURNSTILE_TEST_SECRET_KEY;
const sentryDsn = rawSentryDsn ?? "";

function envOrDefault(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

new GithubOidcStack(app, resourceName("BrimaxGithubOidcStack", stage), {
  env,
  existingProviderArn: process.env.GITHUB_OIDC_PROVIDER_ARN?.trim() || undefined,
  githubRepository: process.env.GITHUB_OIDC_REPOSITORY?.trim() || "maxdez86/brimax-life",
  lockTableName: envOrDefault(
    "GITHUB_OIDC_LOCK_TABLE_NAME",
    stage === "dev" ? "dev-BrimaxPlatformStack-TofuLockTable" : "BrimaxPlatformStack-TofuLockTable"
  ),
  stage,
  stateBucketName: envOrDefault(
    "GITHUB_OIDC_STATE_BUCKET_NAME",
    stage === "dev" ? "dev-brimaxplatformstack-tofustatebucket" : "brimaxplatformstack-tofustatebucket"
  )
});

new PlatformStack(app, resourceName("BrimaxPlatformStack", stage), {
  env,
  stage
});

const certificateStack = new CertificateStack(app, resourceName("BrimaxCertificateStack", stage), {
  apiDomain,
  env,
  rootDomain,
  stage,
  wwwDomain
});

const dataStack = new DataStack(app, resourceName("BrimaxDataStack", stage), {
  env,
  stage
});

const appStack = new AppStack(app, resourceName("BrimaxAppStack", stage), {
  apiCertificate: certificateStack.apiCertificate,
  apiDomain,
  asaasApiKey,
  asaasWebhookToken,
  contactEmail,
  env,
  rootDomain,
  stage,
  sentryDsn,
  table: dataStack.table,
  turnstileSecretKey,
  wwwDomain,
  xrayEnabled
});

const edgeStack = new EdgeStack(app, resourceName("BrimaxEdgeStack", stage), {
  certificate: certificateStack.certificate,
  env,
  rootDomain,
  siteAssetPath,
  stage,
  wwwDomain
});

new ObservabilityStack(app, resourceName("BrimaxObservabilityStack", stage), {
  alertEmail: rawObservabilityAlertEmail,
  alarmedFunctions: appStack.alarmedFunctions,
  applicationLogGroups: appStack.applicationLogGroups,
  createPaymentFunction: appStack.createPaymentFunction,
  env,
  stage,
  distribution: edgeStack.distribution,
  httpApi: appStack.httpApi,
  webhookDlq: appStack.webhookDlq,
  webhookProcessorFunction: appStack.webhookProcessorFunction,
  webhookQueue: appStack.webhookQueue,
  table: dataStack.table
});

edgeStack.addDependency(certificateStack);
