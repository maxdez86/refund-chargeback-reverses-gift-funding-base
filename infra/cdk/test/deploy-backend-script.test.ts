import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const deployScript = readFileSync(path.join(repoRoot, "scripts/deploy-backend.sh"), "utf8");

describe("deploy-backend.sh", () => {
  it("deploys only the explicitly requested backend stacks", () => {
    const deployCommand = deployScript.slice(
      deployScript.indexOf("pnpm --filter @brimax/infra-cdk cdk deploy")
    );

    expect(deployCommand).toContain('"${PAYMENTS_DATA_STACK_NAME}"');
    expect(deployCommand).toContain('"${PAYMENTS_STACK_NAME}"');
    expect(deployCommand).toContain('"${PAYMENTS_OBSERVABILITY_STACK_NAME}"');
    expect(deployCommand).toContain("--exclusively");
    expect(deployCommand).not.toContain("LANDING_EDGE_STACK_NAME");
  });
});
