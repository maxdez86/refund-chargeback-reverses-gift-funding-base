import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const scriptPath = path.join(repoRoot, "scripts/write-github-env-file.sh");

const tempDirs: string[] = [];

function createTempDir() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "write-github-env-file-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function createFullStageEnv(stage: "dev" | "prod") {
  const rootDomain = stage === "dev" ? "dev.brimax.life" : "brimax.life";

  return {
    ...process.env,
    STAGE: stage,
    AWS_REGION: "us-east-1",
    ROOT_DOMAIN: rootDomain,
    CONTACT_EMAIL: "casamento@brimax.life",
    API_DOMAIN: `api.${rootDomain}`,
    WWW_DOMAIN: `www.${rootDomain}`,
    CLOUDFLARE_API_TOKEN: "test-cloudflare-token",
    CLOUDFLARE_ZONE_ID: "test-zone",
    OBSERVABILITY_ALERT_EMAIL: "alerts@example.com",
    XRAY_ENABLED: "true",
    ASAAS_ENV: "sandbox",
    ASAAS_API_BASE_URL: "https://api-sandbox.asaas.com/v3",
    ASAAS_API_KEY: "test-asaas-key",
    ASAAS_WEBHOOK_TOKEN: "test-asaas-webhook-token",
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    TURNSTILE_SITE_KEY: "test-turnstile-site",
    PAYMENTS_TEST_GIFT_ID: "g-test",
    PAYMENTS_TEST_GIFT_QUANTITY: "1",
    PAYMENTS_TEST_PAYER_NAME: "Test User",
    PAYMENTS_TEST_PAYER_EMAIL: "test@example.com",
    PAYMENTS_TEST_PAYER_CPF: "12345678900",
    PAYMENTS_TEST_PAYER_PHONE: "5511999999999",
    TOFU_STATE_KEY_PREFIX: "brimax-life",
    SENTRY_AUTH_TOKEN: "test-sentry-token",
    SENTRY_ORG: "brimax",
    SENTRY_TEAM_SLUG: "brimax-life"
  };
}

function runScript(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync("bash", [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
    }
  }
});

describe("write-github-env-file.sh", () => {
  it("writes the expected full-stage env file for dev", () => {
    const tempDir = createTempDir();
    const envFile = path.join(tempDir, ".env.dev");

    const result = runScript([envFile, "full-stage"], createFullStageEnv("dev"));

    expect(result.status).toBe(0);
    expect(readFileSync(envFile, "utf8")).toBe(
      [
        "STAGE=dev",
        "AWS_REGION=us-east-1",
        "ROOT_DOMAIN=dev.brimax.life",
        "CONTACT_EMAIL=casamento@brimax.life",
        "API_DOMAIN=api.dev.brimax.life",
        "WWW_DOMAIN=www.dev.brimax.life",
        "CLOUDFLARE_API_TOKEN=test-cloudflare-token",
        "CLOUDFLARE_ZONE_ID=test-zone",
        "OBSERVABILITY_ALERT_EMAIL=alerts@example.com",
        "XRAY_ENABLED=true",
        "ASAAS_ENV=sandbox",
        "ASAAS_API_BASE_URL=https://api-sandbox.asaas.com/v3",
        "ASAAS_API_KEY=test-asaas-key",
        "ASAAS_WEBHOOK_TOKEN=test-asaas-webhook-token",
        "TURNSTILE_SECRET_KEY=test-turnstile-secret",
        "TURNSTILE_SITE_KEY=test-turnstile-site",
        "PAYMENTS_TEST_GIFT_ID=g-test",
        "PAYMENTS_TEST_GIFT_QUANTITY=1",
        "PAYMENTS_TEST_PAYER_NAME=Test\\ User",
        "PAYMENTS_TEST_PAYER_EMAIL=test@example.com",
        "PAYMENTS_TEST_PAYER_CPF=12345678900",
        "PAYMENTS_TEST_PAYER_PHONE=5511999999999",
        "TOFU_STATE_KEY_PREFIX=brimax-life",
        "SENTRY_AUTH_TOKEN=test-sentry-token",
        "SENTRY_ORG=brimax",
        "SENTRY_TEAM_SLUG=brimax-life",
        ""
      ].join("\n")
    );
  });

  it("writes the expected full-stage env file for prod", () => {
    const tempDir = createTempDir();
    const envFile = path.join(tempDir, ".env");

    const result = runScript([envFile, "full-stage"], createFullStageEnv("prod"));

    expect(result.status).toBe(0);
    expect(readFileSync(envFile, "utf8")).toContain("ROOT_DOMAIN=brimax.life\n");
    expect(readFileSync(envFile, "utf8")).toContain("API_DOMAIN=api.brimax.life\n");
    expect(readFileSync(envFile, "utf8")).toContain("WWW_DOMAIN=www.brimax.life\n");
  });

  it("writes the expected CI dev minimal env file", () => {
    const tempDir = createTempDir();
    const envFile = path.join(tempDir, ".env.dev");

    const result = runScript([envFile, "ci-dev-minimal"]);

    expect(result.status).toBe(0);
    expect(readFileSync(envFile, "utf8")).toBe(
      [
        "STAGE=dev",
        "AWS_REGION=us-east-1",
        "ROOT_DOMAIN=dev.brimax.life",
        "CONTACT_EMAIL=casamento-dev@brimax.life",
        "API_DOMAIN=api.dev.brimax.life",
        "WWW_DOMAIN=www.dev.brimax.life",
        "TURNSTILE_SITE_KEY=1x00000000000000000000AA",
        ""
      ].join("\n")
    );
  });

  it("runs validation successfully when required vars are present", () => {
    const tempDir = createTempDir();
    const envFile = path.join(tempDir, ".env.dev");

    const result = runScript(
      [envFile, "full-stage", "dev", "STAGE", "AWS_REGION", "ROOT_DOMAIN"],
      createFullStageEnv("dev")
    );

    expect(result.status).toBe(0);
    expect(existsSync(envFile)).toBe(true);
  });

  it("supports backend-scoped validation without unrelated vars", () => {
    const tempDir = createTempDir();
    const envFile = path.join(tempDir, ".env.dev");

    const env: NodeJS.ProcessEnv = { ...createFullStageEnv("dev") };
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_ZONE_ID;
    delete env.TURNSTILE_SITE_KEY;
    delete env.PAYMENTS_TEST_GIFT_ID;
    delete env.PAYMENTS_TEST_GIFT_QUANTITY;
    delete env.PAYMENTS_TEST_PAYER_NAME;
    delete env.PAYMENTS_TEST_PAYER_EMAIL;
    delete env.PAYMENTS_TEST_PAYER_CPF;
    delete env.PAYMENTS_TEST_PAYER_PHONE;

    const result = runScript(
      [
        envFile,
        "full-stage",
        "dev",
        "STAGE",
        "AWS_REGION",
        "ROOT_DOMAIN",
        "CONTACT_EMAIL",
        "API_DOMAIN",
        "WWW_DOMAIN",
        "OBSERVABILITY_ALERT_EMAIL",
        "XRAY_ENABLED",
        "ASAAS_ENV",
        "ASAAS_API_BASE_URL",
        "ASAAS_API_KEY",
        "ASAAS_WEBHOOK_TOKEN",
        "TOFU_STATE_KEY_PREFIX",
        "SENTRY_AUTH_TOKEN",
        "SENTRY_ORG",
        "SENTRY_TEAM_SLUG"
      ],
      env
    );

    expect(result.status).toBe(0);
  });

  it("fails backend-scoped validation when ASAAS_API_KEY is missing", () => {
    const tempDir = createTempDir();
    const envFile = path.join(tempDir, ".env.dev");

    const env: NodeJS.ProcessEnv = { ...createFullStageEnv("dev") };
    delete env.ASAAS_API_KEY;

    const result = runScript(
      [
        envFile,
        "full-stage",
        "dev",
        "STAGE",
        "AWS_REGION",
        "ROOT_DOMAIN",
        "CONTACT_EMAIL",
        "API_DOMAIN",
        "WWW_DOMAIN",
        "OBSERVABILITY_ALERT_EMAIL",
        "XRAY_ENABLED",
        "ASAAS_ENV",
        "ASAAS_API_BASE_URL",
        "ASAAS_API_KEY",
        "ASAAS_WEBHOOK_TOKEN",
        "TOFU_STATE_KEY_PREFIX",
        "SENTRY_AUTH_TOKEN",
        "SENTRY_ORG",
        "SENTRY_TEAM_SLUG"
      ],
      env
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing required GitHub environment vars/secrets for "dev": ASAAS_API_KEY');
  });

  it("fails validation when a required var is missing", () => {
    const tempDir = createTempDir();
    const envFile = path.join(tempDir, ".env");

    const env: NodeJS.ProcessEnv = { ...createFullStageEnv("prod") };
    delete env.SENTRY_AUTH_TOKEN;

    const result = runScript([envFile, "full-stage", "prod"], env);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing required GitHub environment vars/secrets for "prod": SENTRY_AUTH_TOKEN');
  });

  it("creates destination files for both .env.dev and .env paths", () => {
    const tempDir = createTempDir();
    const devFile = path.join(tempDir, ".env.dev");
    const prodFile = path.join(tempDir, ".env");

    const devResult = runScript([devFile, "ci-dev-minimal"]);
    const prodResult = runScript([prodFile, "full-stage"], createFullStageEnv("prod"));

    expect(devResult.status).toBe(0);
    expect(prodResult.status).toBe(0);
    expect(existsSync(devFile)).toBe(true);
    expect(existsSync(prodFile)).toBe(true);
  });
});
