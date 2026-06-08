import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const bootstrapScript = path.join(repoRoot, "scripts/bootstrap-github-oidc.sh");

const tempDirs: string[] = [];

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content, { mode: 0o755 });
}

function createHarness(stage: "dev" | "prod", missingStacks: string[] = []) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "bootstrap-github-oidc-"));
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

if [[ "$1" == "iam" && "$2" == "get-open-id-connect-provider" ]]; then
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

  case " ${missingStacks.join(" ")} " in
    *" \${stack_name} "*)
      echo "missing stack: \${stack_name}" >&2
      exit 255
      ;;
  esac

  case "\${stack_name}|\${query}" in
    "BrimaxPlatformStack|Stacks[0].Outputs[?OutputKey=='TofuStateBucketName'].OutputValue | [0]")
      echo "prod-state-bucket"
      ;;
    "BrimaxPlatformStack|Stacks[0].Outputs[?OutputKey=='TofuLockTableName'].OutputValue | [0]")
      echo "prod-lock-table"
      ;;
    "dev-BrimaxPlatformStack|Stacks[0].Outputs[?OutputKey=='TofuStateBucketName'].OutputValue | [0]")
      echo "dev-state-bucket"
      ;;
    "dev-BrimaxPlatformStack|Stacks[0].Outputs[?OutputKey=='TofuLockTableName'].OutputValue | [0]")
      echo "dev-lock-table"
      ;;
    "BrimaxGithubOidcStack|Stacks[0].Outputs[?OutputKey=='GithubActionsDeployRoleArn'].OutputValue | [0]")
      echo "arn:aws:iam::183286346090:role/brimax-github-actions-prod-deploy"
      ;;
    "dev-BrimaxGithubOidcStack|Stacks[0].Outputs[?OutputKey=='GithubActionsDeployRoleArn'].OutputValue | [0]")
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

  writeExecutable(
    path.join(binDir, "pnpm"),
    `#!/usr/bin/env bash
set -euo pipefail
stack_name=""
previous=""

for arg in "$@"; do
  if [[ "\${previous}" == "deploy" ]]; then
    stack_name="\${arg}"
    break
  fi

  previous="\${arg}"
done

printf 'pnpm|stage=%s|stack=%s|root=%s|api=%s|www=%s|state=%s|lock=%s|args=%s\\n' \
  "\${STAGE:-}" \
  "\${stack_name}" \
  "\${ROOT_DOMAIN:-}" \
  "\${API_DOMAIN:-}" \
  "\${WWW_DOMAIN:-}" \
  "\${GITHUB_OIDC_STATE_BUCKET_NAME:-}" \
  "\${GITHUB_OIDC_LOCK_TABLE_NAME:-}" \
  "$*" >> "${logFile}"
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

function runBootstrap(stage: "dev" | "prod", missingStacks: string[] = []) {
  const harness = createHarness(stage, missingStacks);
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

describe("bootstrap-github-oidc.sh", () => {
  it("bootstraps dev first, then prod, and only updates the dev GitHub environment", () => {
    const result = runBootstrap("dev");

    expect(result.status).toBe(0);

    const pnpmLines = logLines(result.log, "pnpm|");
    expect(pnpmLines).toEqual([
      expect.stringContaining("pnpm|stage=dev|stack=dev-BrimaxGithubOidcStack|root=dev.brimax.life|api=api.dev.brimax.life|www=www.dev.brimax.life|state=dev-state-bucket|lock=dev-lock-table"),
      expect.stringContaining("pnpm|stage=prod|stack=BrimaxGithubOidcStack|root=brimax.life|api=api.brimax.life|www=www.brimax.life|state=prod-state-bucket|lock=prod-lock-table")
    ]);

    expect(logLines(result.log, "setup|")).toEqual([
      "setup|stage=dev|role=arn:aws:iam::183286346090:role/brimax-github-actions-dev-deploy"
    ]);
  });

  it("bootstraps prod first, then dev, and only updates the prod GitHub environment", () => {
    const result = runBootstrap("prod");

    expect(result.status).toBe(0);

    const pnpmLines = logLines(result.log, "pnpm|");
    expect(pnpmLines).toEqual([
      expect.stringContaining("pnpm|stage=prod|stack=BrimaxGithubOidcStack|root=brimax.life|api=api.brimax.life|www=www.brimax.life|state=prod-state-bucket|lock=prod-lock-table"),
      expect.stringContaining("pnpm|stage=dev|stack=dev-BrimaxGithubOidcStack|root=dev.brimax.life|api=api.dev.brimax.life|www=www.dev.brimax.life|state=dev-state-bucket|lock=dev-lock-table")
    ]);

    expect(logLines(result.log, "setup|")).toEqual([
      "setup|stage=prod|role=arn:aws:iam::183286346090:role/brimax-github-actions-prod-deploy"
    ]);
  });

  it("warns and skips the opposite stage when its platform stack is missing", () => {
    const result = runBootstrap("dev", ["BrimaxPlatformStack"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "Warning: skipping prod GitHub OIDC bootstrap because BrimaxPlatformStack is missing or incomplete."
    );

    expect(logLines(result.log, "pnpm|")).toEqual([
      expect.stringContaining("pnpm|stage=dev|stack=dev-BrimaxGithubOidcStack")
    ]);
    expect(logLines(result.log, "setup|")).toEqual([
      "setup|stage=dev|role=arn:aws:iam::183286346090:role/brimax-github-actions-dev-deploy"
    ]);
  });

  it("fails when the selected stage platform stack is missing", () => {
    const result = runBootstrap("prod", ["BrimaxPlatformStack"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Could not resolve required CloudFormation output TofuStateBucketName from BrimaxPlatformStack."
    );
    expect(logLines(result.log, "pnpm|")).toEqual([]);
    expect(logLines(result.log, "setup|")).toEqual([]);
  });
});
