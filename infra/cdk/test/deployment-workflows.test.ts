import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

function readWorkflow(name: string) {
  return readFileSync(path.join(repoRoot, ".github/workflows", name), "utf8");
}

describe.each([
  {
    envFile: ".env",
    envPrefix: "",
    job: "sync-prod-asaas-webhook",
    name: "deploy-prod.yml",
    apiDnsJob: "apply-prod-api-dns"
  },
  {
    envFile: ".env.dev",
    envPrefix: "BRIMAX_ENV_FILE=.env.dev ",
    job: "sync-dev-asaas-webhook",
    name: "deploy-dev.yml",
    apiDnsJob: "apply-dev-api-dns"
  }
])("$name", ({ apiDnsJob, envFile, envPrefix, job, name }) => {
  const workflow = readWorkflow(name);

  it("routes webhook implementation changes to synchronization", () => {
    expect(workflow).toContain("sync_asaas_webhook: ${{ steps.filter.outputs.sync_asaas_webhook }}");
    expect(workflow).toContain(`- '.github/workflows/${name}'`);
    expect(workflow).toContain("- 'scripts/asaas-webhook-sync.mjs'");
    expect(workflow).toContain("- 'scripts/lib/asaas-webhook-sync.mjs'");
    expect(workflow).toContain("- 'scripts/sync-asaas-webhook.sh'");
    expect(workflow).toContain("- 'scripts/payments-env.sh'");
    expect(workflow).toContain("- 'scripts/landing-env.sh'");
  });

  it("wires the stage-specific Google administrator configuration", () => {
    expect(workflow).toContain("GOOGLE_WEB_CLIENT_ID: ${{ vars.GOOGLE_WEB_CLIENT_ID }}");
    expect(workflow).toContain(
      "ADMIN_GOOGLE_HOSTED_DOMAIN: ${{ vars.ADMIN_GOOGLE_HOSTED_DOMAIN }}"
    );
    expect(workflow).toContain(
      "VITE_ADMIN_SESSION_MODE: ${{ vars.VITE_ADMIN_SESSION_MODE }}"
    );
    expect(workflow).not.toContain("vars.VITE_GOOGLE_WEB_CLIENT_ID");
  });

  it("synchronizes only after backend and API DNS prerequisites", () => {
    const jobDefinition = workflow.slice(workflow.indexOf(`  ${job}:`));

    expect(jobDefinition).toContain("- deploy-backend");
    expect(jobDefinition).toContain(`- ${apiDnsJob}`);
    expect(jobDefinition).toContain(
      "contains(fromJSON('[\"success\",\"skipped\"]'), needs.deploy-backend.result)"
    );
    expect(jobDefinition).toContain(
      `contains(fromJSON('["success","skipped"]'), needs.${apiDnsJob}.result)`
    );
    expect(jobDefinition).toContain(`${envPrefix}pnpm asaas:webhook:sync`);
    expect(jobDefinition).toContain(`rm -f ${envFile}`);
  });
});
