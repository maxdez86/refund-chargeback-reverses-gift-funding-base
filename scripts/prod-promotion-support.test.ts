import test from "node:test";
import assert from "node:assert/strict";
import { resolveAsaasApiKey } from "./lib/prod-promotion-support.ts";

const originalAsaasApiKey = process.env.ASAAS_API_KEY;

test("resolveAsaasApiKey returns the trimmed env value", () => {
  process.env.ASAAS_API_KEY = "  test-asaas-key  ";

  assert.equal(resolveAsaasApiKey(), "test-asaas-key");
});

test("resolveAsaasApiKey throws when ASAAS_API_KEY is missing", () => {
  delete process.env.ASAAS_API_KEY;

  assert.throws(() => resolveAsaasApiKey(), /Missing required environment variable ASAAS_API_KEY\./);
});

test.after(() => {
  if (originalAsaasApiKey === undefined) {
    delete process.env.ASAAS_API_KEY;
    return;
  }

  process.env.ASAAS_API_KEY = originalAsaasApiKey;
});
