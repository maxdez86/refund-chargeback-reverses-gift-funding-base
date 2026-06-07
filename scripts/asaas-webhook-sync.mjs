#!/usr/bin/env node
import { runFromEnv } from "./lib/asaas-webhook-sync.mjs";

try {
  const result = await runFromEnv();
  console.info(JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
