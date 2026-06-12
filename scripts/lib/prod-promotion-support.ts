import { DescribeStacksCommand, CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { PAYMENT_GIFTS_BY_ID, type PaymentGift } from "../../packages/config/src/gifts.ts";
import { PRODUCTION_INVITATIONS } from "../seed-dev.ts";

export const PROD_PROMOTION_TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
export const PROD_PROMOTION_INVITATION_CODE = "AB2345";
export const PROD_PROMOTION_GIFT_ID = "g-batedeira";
export const PROD_PROMOTION_GIFT_QUANTITY = 1;
export const PROD_PROMOTION_PAYMENT_METHOD = "PIX";

export function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

export function resolveStage() {
  return process.env.STAGE?.trim() || "dev";
}

export function resolveApiBaseUrl() {
  const explicit = process.env.API_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const apiDomain = process.env.API_DOMAIN?.trim();
  if (apiDomain) {
    return `https://${apiDomain}`;
  }

  throw new Error("Missing API_BASE_URL or API_DOMAIN.");
}

export function resolvePaymentsStackName() {
  const explicit = process.env.PAYMENTS_STACK_NAME?.trim();
  if (explicit) {
    return explicit;
  }

  const stage = resolveStage();
  return stage === "dev" ? "dev-BrimaxAppStack" : "BrimaxAppStack";
}

async function resolvePaymentsStackOutput(outputKey: string) {
  const client = new CloudFormationClient({
    region: requiredEnv("AWS_REGION")
  });
  const stackName = resolvePaymentsStackName();
  const response = await client.send(
    new DescribeStacksCommand({
      StackName: stackName
    })
  );

  const output = response.Stacks?.[0]?.Outputs?.find(
    (candidate) => candidate.OutputKey === outputKey
  )?.OutputValue;

  if (!output) {
    throw new Error(`Could not resolve ${outputKey} output from ${stackName}.`);
  }

  return output;
}

export async function resolveWeddingTableName() {
  const explicit = process.env.WEDDING_TABLE_NAME?.trim();
  if (explicit) {
    return explicit;
  }

  return resolvePaymentsStackOutput("WeddingTableName");
}

export function createDocumentClient() {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: requiredEnv("AWS_REGION")
    })
  );
}

export function resolveIntegrationInvitationCode() {
  return process.env.PROD_PROMOTION_INVITATION_CODE?.trim() || PROD_PROMOTION_INVITATION_CODE;
}

export function resolveIntegrationInvitation() {
  const code = resolveIntegrationInvitationCode();
  const invitation = PRODUCTION_INVITATIONS.find((candidate) => candidate.invitationCode === code);

  if (!invitation) {
    throw new Error(`Could not find seeded invitation ${code} in PRODUCTION_INVITATIONS.`);
  }

  return invitation;
}

export function resolveIntegrationGift(): PaymentGift {
  const giftId = process.env.PROD_PROMOTION_GIFT_ID?.trim() || PROD_PROMOTION_GIFT_ID;
  const gift = PAYMENT_GIFTS_BY_ID.get(giftId);

  if (!gift) {
    throw new Error(`Could not find configured integration gift ${giftId}.`);
  }

  return gift;
}

export function resolveIntegrationGiftQuantity() {
  const raw = process.env.PROD_PROMOTION_GIFT_QUANTITY?.trim();
  if (!raw) {
    return PROD_PROMOTION_GIFT_QUANTITY;
  }

  const quantity = Number.parseInt(raw, 10);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Invalid PROD_PROMOTION_GIFT_QUANTITY value: ${raw}`);
  }

  return quantity;
}

export function resolveAsaasApiKey() {
  return requiredEnv("ASAAS_API_KEY");
}

export function resolveAsaasApiBaseUrl() {
  const explicit = process.env.ASAAS_API_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  return resolveStage() === "dev" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
}

export type AsaasTestPayer = {
  cpf: string;
  email: string;
  id?: string;
  name: string;
  phone?: string;
};

type AsaasApiErrorItem = {
  description?: string;
};

type AsaasCustomerRecord = {
  id: string;
};

type AsaasListResponse<T> = {
  data?: T[];
  errors?: AsaasApiErrorItem[];
  message?: string;
};

type AsaasPaymentRecord = {
  id: string;
};

function extractAsaasErrorMessage(parsed: { errors?: AsaasApiErrorItem[]; message?: string }, responseStatus: number) {
  const descriptions = parsed.errors
    ?.map((error) => error.description?.trim())
    .filter((description): description is string => Boolean(description));

  if (descriptions && descriptions.length > 0) {
    return descriptions.join(" | ");
  }

  if (typeof parsed.message === "string" && parsed.message.trim()) {
    return parsed.message;
  }

  return `Asaas request failed with status ${responseStatus}.`;
}

async function asaasRequest<T>(input: {
  apiBaseUrl: string;
  apiKey: string;
  body?: unknown;
  fetchImpl?: typeof fetch;
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | undefined>;
}) {
  const url = new URL(`${input.apiBaseUrl.replace(/\/+$/, "")}${input.path}`);

  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
  }

  const response = await (input.fetchImpl ?? fetch)(url, {
    body: input.body ? JSON.stringify(input.body) : undefined,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      access_token: input.apiKey
    },
    method: input.method ?? "GET"
  });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as { errors?: AsaasApiErrorItem[]; message?: string }) : {};

  if (!response.ok) {
    throw new Error(extractAsaasErrorMessage(parsed, response.status));
  }

  return parsed as T;
}

export function resolvePaymentsTestPayer(): AsaasTestPayer {
  const phone = process.env.PAYMENTS_TEST_PAYER_PHONE?.trim();

  return {
    cpf: requiredEnv("PAYMENTS_TEST_PAYER_CPF"),
    email: requiredEnv("PAYMENTS_TEST_PAYER_EMAIL"),
    name: requiredEnv("PAYMENTS_TEST_PAYER_NAME"),
    ...(phone ? { phone } : {})
  };
}

export async function findOrCreateAsaasCustomer(
  input: {
    apiBaseUrl: string;
    apiKey: string;
    payer: AsaasTestPayer;
    fetchImpl?: typeof fetch;
  }
) {
  const existing = await asaasRequest<AsaasListResponse<AsaasCustomerRecord>>({
    apiBaseUrl: input.apiBaseUrl,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    path: "/customers",
    query: {
      cpfCnpj: input.payer.cpf
    }
  });

  const existingCustomer = existing.data?.find((candidate) => typeof candidate.id === "string" && candidate.id);
  if (existingCustomer?.id) {
    return existingCustomer;
  }

  return asaasRequest<AsaasCustomerRecord>({
    apiBaseUrl: input.apiBaseUrl,
    apiKey: input.apiKey,
    body: {
      cpfCnpj: input.payer.cpf,
      email: input.payer.email,
      mobilePhone: input.payer.phone,
      name: input.payer.name,
      notificationDisabled: true
    },
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: "/customers"
  });
}

export async function createAsaasPixChargeForExternalReference(input: {
  amountCents: number;
  apiBaseUrl: string;
  apiKey: string;
  customerId: string;
  description: string;
  externalReference: string;
  fetchImpl?: typeof fetch;
}) {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new Error(`Invalid Asaas charge amountCents: ${input.amountCents}`);
  }

  return asaasRequest<AsaasPaymentRecord>({
    apiBaseUrl: input.apiBaseUrl,
    apiKey: input.apiKey,
    body: {
      billingType: "PIX",
      customer: input.customerId,
      description: input.description,
      dueDate: new Date().toISOString().slice(0, 10),
      externalReference: input.externalReference,
      value: input.amountCents / 100
    },
    fetchImpl: input.fetchImpl,
    method: "POST",
    path: "/payments"
  });
}

export async function fetchStoredPayment(documentClient: DynamoDBDocumentClient, tableName: string, paymentId: string) {
  const response = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        PK: `PAYMENT#${paymentId}`,
        SK: "PAYMENT"
      }
    })
  );

  const item = response.Item as
    | {
        asaasCheckoutId?: string;
        asaasPaymentId?: string;
      }
    | undefined;

  if (!item) {
    throw new Error(`Could not find payment row for ${paymentId} in ${tableName}.`);
  }

  return {
    asaasCheckoutId: item.asaasCheckoutId,
    asaasPaymentId: item.asaasPaymentId
  };
}
