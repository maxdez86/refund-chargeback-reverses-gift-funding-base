import { DescribeStacksCommand, CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PAYMENT_GIFTS_BY_ID, type PaymentGift } from "../../packages/config/src/gifts.ts";
import { PRODUCTION_INVITATIONS } from "../seed-dev.ts";

const execFileAsync = promisify(execFile);

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

export async function resolveAppSecretArn() {
  const explicit = process.env.APP_SECRET_ARN?.trim();
  if (explicit) {
    return explicit;
  }

  return resolvePaymentsStackOutput("AppSecretArn");
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

export async function fetchPaymentsAppSecretValue(key: "asaasApiKey" | "asaasWebhookToken") {
  const secretArn = await resolveAppSecretArn();
  const { stdout } = await execFileAsync("aws", [
    "secretsmanager",
    "get-secret-value",
    "--secret-id",
    secretArn,
    "--region",
    requiredEnv("AWS_REGION"),
    "--query",
    "SecretString",
    "--output",
    "text"
  ]);

  if (!stdout.trim()) {
    throw new Error(`Resolved app secret ${secretArn} has no SecretString payload.`);
  }

  const parsed = JSON.parse(stdout) as Partial<Record<"asaasApiKey" | "asaasWebhookToken", string>>;
  const value = parsed[key]?.trim();

  if (!value) {
    throw new Error(`Resolved app secret ${secretArn} does not contain ${key}.`);
  }

  return value;
}

export async function resolveAsaasApiKey() {
  const explicit = process.env.ASAAS_API_KEY?.trim();
  if (explicit) {
    return explicit;
  }

  return fetchPaymentsAppSecretValue("asaasApiKey");
}

export function resolveAsaasApiBaseUrl() {
  const explicit = process.env.ASAAS_API_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  return resolveStage() === "dev" ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3";
}

type AsaasPaymentLookupResult = {
  checkoutSession?: string;
  externalReference?: string;
  id?: string;
};

async function asaasListRequest(
  apiBaseUrl: string,
  apiKey: string,
  query: Record<string, string>,
  fetchImpl: typeof fetch
) {
  const url = new URL(`${apiBaseUrl.replace(/\/+$/, "")}/payments`);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      access_token: apiKey
    },
    method: "GET"
  });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as { data?: AsaasPaymentLookupResult[]; errors?: unknown; message?: string }) : {};

  if (!response.ok) {
    throw new Error(
      typeof parsed.message === "string"
        ? parsed.message
        : `Asaas list payments request failed with status ${response.status}.`
    );
  }

  return parsed.data ?? [];
}

export async function listAsaasPaymentsByExternalReference(
  apiBaseUrl: string,
  apiKey: string,
  externalReference: string,
  fetchImpl: typeof fetch = fetch
) {
  return asaasListRequest(apiBaseUrl, apiKey, { externalReference }, fetchImpl);
}

export async function listAsaasPaymentsByCheckoutSession(
  apiBaseUrl: string,
  apiKey: string,
  checkoutSession: string,
  fetchImpl: typeof fetch = fetch
) {
  return asaasListRequest(apiBaseUrl, apiKey, { checkoutSession }, fetchImpl);
}

export async function pollForAsaasPaymentId(input: {
  apiBaseUrl: string;
  apiKey: string;
  externalReference: string;
  fetchImpl?: typeof fetch;
  knownAsaasCheckoutId?: string;
  paymentId: string;
  pollIntervalMs: number;
  timeoutMs: number;
}) {
  const deadline = Date.now() + input.timeoutMs;
  const fetchImpl = input.fetchImpl ?? fetch;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    const byExternalReference = await listAsaasPaymentsByExternalReference(
      input.apiBaseUrl,
      input.apiKey,
      input.externalReference,
      fetchImpl
    );
    const matchedByExternalReference = byExternalReference.find((payment) => typeof payment.id === "string" && payment.id);

    if (matchedByExternalReference?.id) {
      return {
        attempts,
        asaasPaymentId: matchedByExternalReference.id,
        lookupSource: "externalReference" as const
      };
    }

    if (input.knownAsaasCheckoutId) {
      const byCheckoutSession = await listAsaasPaymentsByCheckoutSession(
        input.apiBaseUrl,
        input.apiKey,
        input.knownAsaasCheckoutId,
        fetchImpl
      );
      const matchedByCheckoutSession = byCheckoutSession.find((payment) => typeof payment.id === "string" && payment.id);

      if (matchedByCheckoutSession?.id) {
        return {
          attempts,
          asaasPaymentId: matchedByCheckoutSession.id,
          lookupSource: "checkoutSession" as const
        };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, input.pollIntervalMs));
  }

  const checkoutDetail = input.knownAsaasCheckoutId ? ` Stored asaasCheckoutId=${input.knownAsaasCheckoutId}.` : "";
  throw new Error(
    `Timed out resolving Asaas payment id for paymentId=${input.paymentId} via externalReference.${checkoutDetail} Fallback webhook scenario could not start because Asaas did not expose a payment record yet.`
  );
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
