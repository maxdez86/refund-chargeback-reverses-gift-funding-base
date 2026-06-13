import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const validatorPath = path.join(repoRoot, "scripts/validate-github-env-writers.rb");

const expectedJobs = {
  "deploy-dev.yml": [
    "deploy-frontend",
    "apply-dev-sentry",
    "deploy-backend",
    "apply-dev-landing-dns",
    "apply-dev-api-dns",
    "sync-dev-asaas-webhook"
  ],
  "deploy-prod.yml": [
    "deploy-frontend",
    "apply-prod-sentry",
    "deploy-backend",
    "apply-prod-landing-dns",
    "apply-prod-api-dns",
    "sync-prod-asaas-webhook",
    "apply-prod-ses-dns"
  ]
} as const;

const webhookRequiredKeys = [
  "STAGE",
  "AWS_REGION",
  "ROOT_DOMAIN",
  "CONTACT_EMAIL",
  "API_DOMAIN",
  "ASAAS_ENV",
  "ASAAS_API_BASE_URL",
  "ASAAS_API_KEY",
  "ASAAS_WEBHOOK_TOKEN"
];

const secretKeys = new Set(["ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN"]);
const tempDirs: string[] = [];

type Workflow = {
  jobs: Record<string, { steps: Array<{ env: Record<string, string>; run: string }> }>;
};

function mappingFor(key: string) {
  const context = secretKeys.has(key) ? "secrets" : "vars";
  return "$" + `{{ ${context}.${key} }}`;
}

function createWriterStep(fileName: string, jobName: string) {
  const environment = fileName === "deploy-dev.yml" ? "dev" : "prod";
  const destination = environment === "dev" ? ".env.dev" : ".env";
  const requiredKeys = jobName.includes("asaas-webhook") ? webhookRequiredKeys : ["STAGE"];

  return {
    env: Object.fromEntries(requiredKeys.map((key) => [key, mappingFor(key)])),
    run: [
      `bash scripts/write-github-env-file.sh ${destination} full-stage ${environment} \\`,
      `  ${requiredKeys.join(" ")}`
    ].join("\n")
  };
}

function createWorkflow(fileName: keyof typeof expectedJobs): Workflow {
  return {
    jobs: Object.fromEntries(
      expectedJobs[fileName].map((jobName) => [
        jobName,
        { steps: [createWriterStep(fileName, jobName)] }
      ])
    )
  };
}

function createFixture(
  mutate?: (workflows: Record<keyof typeof expectedJobs, Workflow>) => void
) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "github-env-writer-validator-"));
  tempDirs.push(tempDir);

  const workflows = {
    "deploy-dev.yml": createWorkflow("deploy-dev.yml"),
    "deploy-prod.yml": createWorkflow("deploy-prod.yml")
  };
  mutate?.(workflows);

  const paths = (Object.keys(workflows) as Array<keyof typeof workflows>).map((fileName) => {
    const filePath = path.join(tempDir, fileName);
    writeFileSync(filePath, JSON.stringify(workflows[fileName]));
    return filePath;
  });

  return paths;
}

function runValidator(workflowPaths?: string[]) {
  return spawnSync("ruby", [validatorPath, ...(workflowPaths ?? [])], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("validate-github-env-writers.rb", () => {
  it("accepts scoped dev and prod webhook writers", () => {
    const result = runValidator(createFixture());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("validated 13 full-stage env writer mappings");
  });

  it("reports a missing required mapping", () => {
    const paths = createFixture((workflows) => {
      delete workflows["deploy-dev.yml"].jobs["sync-dev-asaas-webhook"].steps[0].env.API_DOMAIN;
    });

    const result = runValidator(paths);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sync-dev-asaas-webhook");
    expect(result.stderr).toContain("missing required mappings: API_DOMAIN");
  });

  it("reports a variable sourced from secrets", () => {
    const paths = createFixture((workflows) => {
      workflows["deploy-dev.yml"].jobs["sync-dev-asaas-webhook"].steps[0].env.API_DOMAIN =
        "${{ secrets.API_DOMAIN }}";
    });

    const result = runValidator(paths);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("API_DOMAIN");
    expect(result.stderr).toContain("${{ vars.API_DOMAIN }}");
  });

  it("reports a secret sourced from vars", () => {
    const paths = createFixture((workflows) => {
      workflows["deploy-prod.yml"].jobs["sync-prod-asaas-webhook"].steps[0].env.ASAAS_API_KEY =
        "${{ vars.ASAAS_API_KEY }}";
    });

    const result = runValidator(paths);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ASAAS_API_KEY");
    expect(result.stderr).toContain("${{ secrets.ASAAS_API_KEY }}");
  });

  it("reports an unknown required key", () => {
    const paths = createFixture((workflows) => {
      workflows["deploy-dev.yml"].jobs["sync-dev-asaas-webhook"].steps[0].run += " UNKNOWN_KEY";
    });

    const result = runValidator(paths);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown required keys: UNKNOWN_KEY");
  });

  it("reports an incorrectly sourced optional known mapping", () => {
    const paths = createFixture((workflows) => {
      workflows["deploy-prod.yml"].jobs["sync-prod-asaas-webhook"].steps[0].env.SENTRY_AUTH_TOKEN =
        "${{ vars.SENTRY_AUTH_TOKEN }}";
    });

    const result = runValidator(paths);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SENTRY_AUTH_TOKEN");
    expect(result.stderr).toContain("${{ secrets.SENTRY_AUTH_TOKEN }}");
  });

  it("reports an omitted expected writer job", () => {
    const paths = createFixture((workflows) => {
      delete workflows["deploy-dev.yml"].jobs["apply-dev-api-dns"];
    });

    const result = runValidator(paths);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing full-stage env writers: deploy-dev.yml:apply-dev-api-dns");
  });

  it("reports a newly added writer job", () => {
    const paths = createFixture((workflows) => {
      workflows["deploy-prod.yml"].jobs["unexpected-writer"] = {
        steps: [createWriterStep("deploy-prod.yml", "unexpected-writer")]
      };
    });

    const result = runValidator(paths);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "unexpected full-stage env writers: deploy-prod.yml:unexpected-writer"
    );
  });

  it("reports duplicate writers in an expected job", () => {
    const paths = createFixture((workflows) => {
      const job = workflows["deploy-dev.yml"].jobs["deploy-frontend"];
      job.steps.push(createWriterStep("deploy-dev.yml", "deploy-frontend"));
    });

    const result = runValidator(paths);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "duplicate full-stage env writers: deploy-dev.yml:deploy-frontend"
    );
  });

  it("accepts all full-stage writers in the repository workflows", () => {
    const result = runValidator();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("validated 13 full-stage env writer mappings");
  });
});
