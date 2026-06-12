import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const bootstrapScript = path.join(repoRoot, "scripts/bootstrap-github-oidc-github.sh");

const tempDirs: string[] = [];

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content, { mode: 0o755 });
}

function createHarness(stage: "dev" | "prod") {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "bootstrap-github-oidc-github-"));
  tempDirs.push(tempDir);

  const binDir = path.join(tempDir, "bin");
  mkdirSync(binDir, { recursive: true });

  const logFile = path.join(tempDir, "commands.log");
  const envFile = path.join(tempDir, ".env.test");
  const setupScript = path.join(tempDir, "fake-setup-github-environment.sh");

  writeFileSync(
    envFile,
    [
      `STAGE=${stage}`,
      "AWS_REGION=us-east-1",
      "AWS_PROFILE=test-profile",
      "GITHUB_TOKEN=test-token"
    ].join("\n")
  );

  writeExecutable(
    path.join(binDir, "aws"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'aws|%s\\n' "$*" >> "${logFile}"

if [[ "$1" == "sts" && "$2" == "get-caller-identity" ]]; then
  echo "183286346090"
  exit 0
fi

if [[ "$1" == "cloudformation" && "$2" == "describe-stacks" ]]; then
  stack_name=""
  query=""

  while (( "$#" > 0 )); do
    case "$1" in
      --stack-name)
        stack_name="$2"
        shift 2
        ;;
      --query)
        query="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  case "\${stack_name}|\${query}" in
    "BrimaxGithubOidcStack|Stacks[0].Outputs[?OutputKey=='GithubActionsProdDeployRoleArn'].OutputValue | [0]")
      echo "arn:aws:iam::183286346090:role/brimax-github-actions-prod-deploy"
      ;;
    "BrimaxGithubOidcStack|Stacks[0].Outputs[?OutputKey=='GithubActionsDevDeployRoleArn'].OutputValue | [0]")
      echo "arn:aws:iam::183286346090:role/brimax-github-actions-dev-deploy"
      ;;
    *)
      echo "unexpected cloudformation lookup: \${stack_name} | \${query}" >&2
      exit 1
      ;;
  esac

  exit 0
fi

echo "unexpected aws invocation: $*" >&2
exit 1
`
  );

  // A pnpm shim that logs any invocation so the test can prove this command
  // never runs a CDK deploy.
  writeExecutable(
    path.join(binDir, "pnpm"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'pnpm|%s\\n' "$*" >> "${logFile}"
`
  );

  writeExecutable(
    setupScript,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'setup|stage=%s|role=%s\\n' "\${STAGE:-}" "$1" >> "${logFile}"
`
  );

  return {
    env: {
      ...process.env,
      AWS_BIN: path.join(binDir, "aws"),
      BRIMAX_ENV_FILE: envFile,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      PNPM_BIN: path.join(binDir, "pnpm"),
      SETUP_GITHUB_ENVIRONMENT_SCRIPT: setupScript
    },
    logFile,
    tempDir
  };
}

function runBootstrap(stage: "dev" | "prod") {
  const harness = createHarness(stage);
  const result = spawnSync("bash", [bootstrapScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: harness.env
  });

  const log = readFileSync(harness.logFile, "utf8");

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

describe("bootstrap-github-oidc-github.sh", () => {
  it("resolves the dev deploy role from the shared stack and refreshes the dev environment", { timeout: 10000 }, () => {
    const result = runBootstrap("dev");

    expect(result.status).toBe(0);

    expect(logLines(result.log, "aws|")).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "cloudformation describe-stacks --region us-east-1 --profile test-profile --stack-name BrimaxGithubOidcStack --query Stacks[0].Outputs[?OutputKey=='GithubActionsDevDeployRoleArn'].OutputValue | [0] --output text"
        )
      ])
    );

    expect(logLines(result.log, "setup|")).toEqual([
      "setup|stage=dev|role=arn:aws:iam::183286346090:role/brimax-github-actions-dev-deploy"
    ]);

    // The CDK half moved out: this command never deploys a stack.
    expect(logLines(result.log, "pnpm|")).toEqual([]);
  });

  it("resolves the prod deploy role from the shared stack and refreshes the prod environment", () => {
    const result = runBootstrap("prod");

    expect(result.status).toBe(0);

    expect(logLines(result.log, "aws|")).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "cloudformation describe-stacks --region us-east-1 --profile test-profile --stack-name BrimaxGithubOidcStack --query Stacks[0].Outputs[?OutputKey=='GithubActionsProdDeployRoleArn'].OutputValue | [0] --output text"
        )
      ])
    );

    expect(logLines(result.log, "setup|")).toEqual([
      "setup|stage=prod|role=arn:aws:iam::183286346090:role/brimax-github-actions-prod-deploy"
    ]);

    expect(logLines(result.log, "pnpm|")).toEqual([]);
  });
});
