import test from "node:test";
import assert from "node:assert/strict";
import {
  createAsaasPixChargeForExternalReference,
  findOrCreateAsaasCustomer,
  resolveAsaasApiKey
} from "./lib/prod-promotion-support.ts";
import { resolveWhatsappIntegrationInvitationCode } from "./lib/prod-promotion-support.ts";

const originalAsaasApiKey = process.env.ASAAS_API_KEY;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("resolveAsaasApiKey returns the trimmed env value", () => {
  process.env.ASAAS_API_KEY = "  test-asaas-key  ";

  assert.equal(resolveAsaasApiKey(), "test-asaas-key");
});

test("resolveAsaasApiKey throws when ASAAS_API_KEY is missing", () => {
  delete process.env.ASAAS_API_KEY;

  assert.throws(() => resolveAsaasApiKey(), /Missing required environment variable ASAAS_API_KEY\./);
});

test("resolveWhatsappIntegrationInvitationCode is deterministic and valid for a GitHub run", () => {
  const original = process.env.GITHUB_RUN_ID;
  process.env.GITHUB_RUN_ID = "1234567890";
  assert.equal(resolveWhatsappIntegrationInvitationCode(), "ZX9232");
  if (original === undefined) delete process.env.GITHUB_RUN_ID;
  else process.env.GITHUB_RUN_ID = original;
});

test("findOrCreateAsaasCustomer reuses an existing customer matched by cpf", async () => {
  const calls: Array<{ init?: RequestInit; url: URL }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({ init, url: new URL(String(input)) });

    return jsonResponse({
      data: [{ id: "cus_existing" }]
    });
  };

  const customer = await findOrCreateAsaasCustomer({
    apiBaseUrl: "https://api-sandbox.asaas.com/v3",
    apiKey: "asaas-key",
    payer: {
      cpf: "12345678900",
      email: "tester@example.com",
      name: "Test User",
      phone: "5511999999999"
    },
    fetchImpl: fetchMock
  });

  assert.equal(customer.id, "cus_existing");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url.pathname, "/v3/customers");
  assert.equal(calls[0]?.url.searchParams.get("cpfCnpj"), "12345678900");
  assert.equal(calls[0]?.init?.method, "GET");
});

test("findOrCreateAsaasCustomer creates a customer when no cpf match exists", async () => {
  const calls: Array<{ body?: string; init?: RequestInit; url: URL }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({
      body: typeof init?.body === "string" ? init.body : undefined,
      init,
      url: new URL(String(input))
    });

    if (calls.length === 1) {
      return jsonResponse({ data: [] });
    }

    return jsonResponse({ id: "cus_created" });
  };

  const customer = await findOrCreateAsaasCustomer({
    apiBaseUrl: "https://api-sandbox.asaas.com/v3",
    apiKey: "asaas-key",
    payer: {
      cpf: "12345678900",
      email: "tester@example.com",
      name: "Test User"
    },
    fetchImpl: fetchMock
  });

  assert.equal(customer.id, "cus_created");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url.pathname, "/v3/customers");
  assert.equal(calls[1]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[1]?.body ?? "{}"), {
    cpfCnpj: "12345678900",
    email: "tester@example.com",
    name: "Test User",
    notificationDisabled: true
  });
});

test("createAsaasPixChargeForExternalReference creates a direct PIX charge", async () => {
  const calls: Array<{ body?: string; init?: RequestInit; url: URL }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({
      body: typeof init?.body === "string" ? init.body : undefined,
      init,
      url: new URL(String(input))
    });

    return jsonResponse({ id: "pay_direct_1" });
  };

  const payment = await createAsaasPixChargeForExternalReference({
    amountCents: 500,
    apiBaseUrl: "https://api-sandbox.asaas.com/v3",
    apiKey: "asaas-key",
    customerId: "cus_123",
    description: "Prod promotion fallback payment-1",
    externalReference: "payment-1",
    fetchImpl: fetchMock
  });

  assert.equal(payment.id, "pay_direct_1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url.pathname, "/v3/payments");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]?.body ?? "{}"), {
    billingType: "PIX",
    customer: "cus_123",
    description: "Prod promotion fallback payment-1",
    dueDate: new Date().toISOString().slice(0, 10),
    externalReference: "payment-1",
    value: 5
  });
});

test("findOrCreateAsaasCustomer surfaces Asaas customer creation errors", async () => {
  const fetchMock: typeof fetch = async (_input, init) => {
    if (init?.method === "GET") {
      return jsonResponse({ data: [] });
    }

    return jsonResponse(
      {
        errors: [{ description: "Invalid CPF." }]
      },
      400
    );
  };

  await assert.rejects(
    () =>
      findOrCreateAsaasCustomer({
        apiBaseUrl: "https://api-sandbox.asaas.com/v3",
        apiKey: "asaas-key",
        payer: {
          cpf: "12345678900",
          email: "tester@example.com",
          name: "Test User"
        },
        fetchImpl: fetchMock
      }),
    /Invalid CPF\./
  );
});

test("createAsaasPixChargeForExternalReference surfaces Asaas payment creation errors", async () => {
  const fetchMock: typeof fetch = async () =>
    jsonResponse(
      {
        message: "Charge amount below minimum."
      },
      400
    );

  await assert.rejects(
    () =>
      createAsaasPixChargeForExternalReference({
        amountCents: 500,
        apiBaseUrl: "https://api-sandbox.asaas.com/v3",
        apiKey: "asaas-key",
        customerId: "cus_123",
        description: "Prod promotion fallback payment-1",
        externalReference: "payment-1",
        fetchImpl: fetchMock
      }),
    /Charge amount below minimum\./
  );
});

test.after(() => {
  if (originalAsaasApiKey === undefined) {
    delete process.env.ASAAS_API_KEY;
    return;
  }

  process.env.ASAAS_API_KEY = originalAsaasApiKey;
});
