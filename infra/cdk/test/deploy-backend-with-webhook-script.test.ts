import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
const deployScript = readFileSync(
  path.join(repoRoot, "scripts/deploy-backend-and-sync-asaas-webhook.sh"),
  "utf8"
);

describe("deploy-backend-and-sync-asaas-webhook.sh", () => {
  it("deploys backend, initializes and applies API DNS, then synchronizes Asaas", () => {
    const commands = [
      "pnpm deploy:backend",
      "pnpm opentofu:api-dns:init",
      "pnpm opentofu:api-dns:apply -auto-approve",
      "pnpm asaas:webhook:sync"
    ];

    for (const [index, command] of commands.entries()) {
      expect(deployScript).toContain(command);

      if (index > 0) {
        expect(deployScript.indexOf(command)).toBeGreaterThan(
          deployScript.indexOf(commands[index - 1])
        );
      }
    }
  });
});
