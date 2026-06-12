import { runFromCli } from "./lib/diagnose-asaas-webhook.mjs";

runFromCli().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
