import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const setupScript = path.join(repoRoot, "scripts/setup-github-environment.sh");

const tempDirs: string[] = [];

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content, { mode: 0o755 });
}

function createHarness(stage: "dev" | "prod") {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "setup-github-environment-"));
  tempDirs.push(tempDir);

  const binDir = path.join(tempDir, "bin");
  mkdirSync(binDir, { recursive: true });

  const logFile = path.join(tempDir, "commands.log");
  const envFile = path.join(tempDir, ".env.test");

  const rootDomain = stage === "dev" ? "dev.brimax.life" : "brimax.life";
  const apiDomain = stage === "dev" ? "api.dev.brimax.life" : "api.brimax.life";
  const wwwDomain = stage === "dev" ? "www.dev.brimax.life" : "www.brimax.life";

  writeFileSync(
    envFile,
    [
      `STAGE=${stage}`,
      "AWS_REGION=us-east-1",
      `ROOT_DOMAIN=${rootDomain}`,
      "CONTACT_EMAIL=casamento@brimax.life",
      `API_DOMAIN=${apiDomain}`,
      `WWW_DOMAIN=${wwwDomain}`,
      "CLOUDFLARE_API_TOKEN=test-cloudflare-token",
      "CLOUDFLARE_ZONE_ID=test-zone",
      "OBSERVABILITY_ALERT_EMAIL=test@example.com",
      "XRAY_ENABLED=true",
      "ASAAS_ENV=sandbox",
      "ASAAS_API_BASE_URL=https://api-sandbox.asaas.com/v3",
      "ASAAS_API_KEY=test-asaas-key",
      "ASAAS_WEBHOOK_TOKEN=test-asaas-webhook-token",
      "TURNSTILE_SECRET_KEY=test-turnstile-secret",
      "TURNSTILE_SITE_KEY=test-turnstile-site",
      "PAYMENTS_TEST_GIFT_ID=g-test",
      "PAYMENTS_TEST_GIFT_QUANTITY=1",
      'PAYMENTS_TEST_PAYER_NAME="Test User"',
      "PAYMENTS_TEST_PAYER_EMAIL=test@example.com",
      "PAYMENTS_TEST_PAYER_CPF=12345678900",
      "PAYMENTS_TEST_PAYER_PHONE=5511999999999",
      "SENTRY_AUTH_TOKEN=test-sentry-token",
      "GITHUB_TOKEN=test-github-token",
      "GITHUB_OIDC_REPOSITORY=maxdez86/brimax-life",
      "TOFU_STATE_KEY_PREFIX=brimax-life",
      "SENTRY_ORG=brimax",
      "SENTRY_TEAM_SLUG=brimax-life"
    ].join("\n")
  );

  writeExecutable(
    path.join(binDir, "gh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'gh|%s\\n' "$*" >> "${logFile}"
`
  );

  return {
    env: {
      ...process.env,
      BRIMAX_ENV_FILE: envFile,
      PATH: `${binDir}:${process.env.PATH ?? ""}`
    },
    logFile
  };
}

function runSetup(stage: "dev" | "prod") {
  const harness = createHarness(stage);
  const args = [setupScript, "arn:aws:iam::183286346090:role/stage-deploy-role"];

  const result = spawnSync("bash", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: harness.env
  });

  const log = existsSync(harness.logFile) ? readFileSync(harness.logFile, "utf8") : "";

  return {
    ...result,
    log
  };
}

function logLines(log: string, prefix: string) {
  return log
    .trim()
    .split("\n")
    .filter((line) => line.startsWith(prefix));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
    }
  }
});

describe("setup-github-environment.sh", () => {
  it("writes the stage secret when STAGE=dev", () => {
    const result = runSetup("dev");

    expect(result.status).toBe(0);
    expect(logLines(result.log, "gh|")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("api --method PUT --header Accept: application/vnd.github+json repos/maxdez86/brimax-life/environments/dev"),
        expect.stringContaining(
          "secret set AWS_ROLE_TO_ASSUME_DEV --env dev --repo maxdez86/brimax-life --body arn:aws:iam::183286346090:role/stage-deploy-role"
        )
      ])
    );
  });

  it("writes only the prod stage secret when STAGE=prod", () => {
    const result = runSetup("prod");

    expect(result.status).toBe(0);
    expect(logLines(result.log, "gh|")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("api --method PUT --header Accept: application/vnd.github+json repos/maxdez86/brimax-life/environments/prod"),
        expect.stringContaining("api --method PUT --header Accept: application/vnd.github+json repos/maxdez86/brimax-life/environments/dev"),
        expect.stringContaining(
          "secret set AWS_ROLE_TO_ASSUME_PROD --env prod --repo maxdez86/brimax-life --body arn:aws:iam::183286346090:role/stage-deploy-role"
        )
      ])
    );
  });
});
