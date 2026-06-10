import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const bootstrapScript = path.join(repoRoot, "scripts/bootstrap-github-oidc-cdk.sh");

const tempDirs: string[] = [];

function writeExecutable(filePath: string, content: string) {
  writeFileSync(filePath, content, { mode: 0o755 });
}

function createHarness(
  stage: "dev" | "prod",
  missingStacks: string[] = [],
  existingStacks: string[] = ["BrimaxPlatformStack", "dev-BrimaxPlatformStack", "BrimaxGithubOidcStack"],
  providerExists = true
) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "bootstrap-github-oidc-cdk-"));
  tempDirs.push(tempDir);

  const binDir = path.join(tempDir, "bin");
  mkdirSync(binDir, { recursive: true });

  const logFile = path.join(tempDir, "commands.log");
  const envFile = path.join(tempDir, ".env.test");

  writeFileSync(
    envFile,
    [
      `STAGE=${stage}`,
      "AWS_REGION=us-east-1",
      "AWS_PROFILE=test-profile"
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
  if [[ "${providerExists ? "true" : "false"}" == "true" ]]; then
    exit 0
  fi

  echo "provider does not exist" >&2
  exit 254
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

  case " ${existingStacks.join(" ")} " in
    *" \${stack_name} "*)
      ;;
    *)
      echo "stack does not exist: \${stack_name}" >&2
      exit 255
      ;;
  esac

  if [[ -z "\${query}" ]]; then
    echo "exists"
    exit 0
  fi

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
    *)
      echo "unexpected cloudformation lookup: \${stack_name} | \${query}" >&2
      exit 1
      ;;
  esac

  exit 0
fi

if [[ "$1" == "cloudformation" && "$2" == "delete-stack" ]]; then
  stack_name=""

  while (( "$#" > 0 )); do
    case "$1" in
      --stack-name)
        stack_name="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  printf 'aws-delete|stack=%s\\n' "\${stack_name}" >> "${logFile}"
  exit 0
fi

if [[ "$1" == "cloudformation" && "$2" == "wait" && "$3" == "stack-delete-complete" ]]; then
  stack_name=""

  while (( "$#" > 0 )); do
    case "$1" in
      --stack-name)
        stack_name="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  printf 'aws-wait-delete|stack=%s\\n' "\${stack_name}" >> "${logFile}"
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

  return {
    env: {
      ...process.env,
      AWS_BIN: path.join(binDir, "aws"),
      BRIMAX_ENV_FILE: envFile,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      PNPM_BIN: path.join(binDir, "pnpm")
    },
    logFile,
    tempDir
  };
}

function runBootstrap(
  stage: "dev" | "prod",
  missingStacks: string[] = [],
  existingStacks?: string[],
  providerExists = true
) {
  const harness = createHarness(stage, missingStacks, existingStacks, providerExists);
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

describe("bootstrap-github-oidc-cdk.sh", () => {
  it("deploys the shared stack and never touches GitHub when STAGE=dev", () => {
    const result = runBootstrap("dev");

    expect(result.status).toBe(0);

    expect(logLines(result.log, "pnpm|")).toEqual([
      expect.stringContaining("pnpm|stage=dev|stack=BrimaxGithubOidcStack")
    ]);

    expect(logLines(result.log, "aws|")).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "cloudformation describe-stacks --region us-east-1 --profile test-profile --stack-name dev-BrimaxPlatformStack --query Stacks[0].Outputs[?OutputKey=='TofuStateBucketName'].OutputValue | [0] --output text"
        ),
        expect.stringContaining(
          "cloudformation describe-stacks --region us-east-1 --profile test-profile --stack-name BrimaxPlatformStack --query Stacks[0].Outputs[?OutputKey=='TofuStateBucketName'].OutputValue | [0] --output text"
        )
      ])
    );

    // The GitHub half moved out: no setup call and no role-ARN output lookups here.
    expect(logLines(result.log, "setup|")).toEqual([]);
    expect(result.log).not.toContain("GithubActionsDevDeployRoleArn");
    expect(result.log).not.toContain("GithubActionsProdDeployRoleArn");
  });

  it("uses the same CDK deploy shape whether the provider already exists or not", () => {
    const result = runBootstrap("dev", [], undefined, false);

    expect(result.status).toBe(0);
    expect(logLines(result.log, "pnpm|")).toEqual([
      expect.stringContaining("pnpm|stage=dev|stack=BrimaxGithubOidcStack")
    ]);
  });

  it("deletes the legacy dev oidc stack before deploying the shared stack", () => {
    const result = runBootstrap("prod", [], [
      "BrimaxPlatformStack",
      "dev-BrimaxPlatformStack",
      "BrimaxGithubOidcStack",
      "dev-BrimaxGithubOidcStack"
    ]);

    expect(result.status).toBe(0);
    expect(logLines(result.log, "aws-delete|")).toEqual([
      "aws-delete|stack=dev-BrimaxGithubOidcStack"
    ]);
    expect(logLines(result.log, "aws-wait-delete|")).toEqual([
      "aws-wait-delete|stack=dev-BrimaxGithubOidcStack"
    ]);
    expect(logLines(result.log, "pnpm|")).toEqual([
      expect.stringContaining("pnpm|stage=prod|stack=BrimaxGithubOidcStack")
    ]);
  });

  it("deploys the shared stack and never touches GitHub when STAGE=prod", () => {
    const result = runBootstrap("prod");

    expect(result.status).toBe(0);

    expect(logLines(result.log, "pnpm|")).toEqual([
      expect.stringContaining("pnpm|stage=prod|stack=BrimaxGithubOidcStack")
    ]);

    expect(logLines(result.log, "setup|")).toEqual([]);
    expect(result.log).not.toContain("GithubActionsDevDeployRoleArn");
    expect(result.log).not.toContain("GithubActionsProdDeployRoleArn");
  });

  it("fails when the prod platform stack is missing because the shared stack needs both stages", () => {
    const result = runBootstrap("dev", ["BrimaxPlatformStack"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Could not resolve required CloudFormation output TofuStateBucketName from BrimaxPlatformStack."
    );
    expect(logLines(result.log, "pnpm|")).toEqual([]);
  });

  it("fails when the dev platform stack is missing because the shared stack needs both stages", () => {
    const result = runBootstrap("prod", ["dev-BrimaxPlatformStack"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Could not resolve required CloudFormation output TofuStateBucketName from dev-BrimaxPlatformStack."
    );
    expect(logLines(result.log, "pnpm|")).toEqual([]);
  });
});
