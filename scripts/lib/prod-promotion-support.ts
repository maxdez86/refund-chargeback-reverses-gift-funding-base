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

export async function resolveWeddingTableName() {
  const explicit = process.env.WEDDING_TABLE_NAME?.trim();
  if (explicit) {
    return explicit;
  }

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
    (candidate) => candidate.OutputKey === "WeddingTableName"
  )?.OutputValue;

  if (!output) {
    throw new Error(`Could not resolve WeddingTableName output from ${stackName}.`);
  }

  return output;
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
