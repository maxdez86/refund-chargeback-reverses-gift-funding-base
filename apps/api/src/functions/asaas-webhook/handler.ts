import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getEnv } from "../../lib/env";
import { jsonResponse, noContentResponse } from "../../lib/http";
import { rawBodyHash, safeEqual } from "../../lib/security";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { PaymentRepository } from "../../services/dynamodb/repositories/payment-repository";
import { getSecretValue } from "../../services/secrets-manager/secret-cache";

const repository = new PaymentRepository();
const sqsClient = new SQSClient({});

type AsaasWebhookPayload = {
  event?: string;
  payment?: {
    id?: string;
    checkoutSession?: string;
    externalReference?: string;
  };
  id?: string;
  externalReference?: string;
};

function parseWebhookSecret(secretValue: string) {
  try {
    const parsed = JSON.parse(secretValue) as { value?: string; token?: string };
    return parsed.value ?? parsed.token ?? secretValue;
  } catch {
    return secretValue;
  }
}

async function onAsaasWebhook(event: APIGatewayProxyEventV2) {
  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse();
  }

  const tokenHeader = event.headers["asaas-access-token"] ?? event.headers["Asaas-Access-Token"];
  const webhookSecretArn = getEnv().asaasWebhookSecretArn;
  const webhookSecret = parseWebhookSecret(await getSecretValue(webhookSecretArn));

  if (!tokenHeader || !safeEqual(tokenHeader, webhookSecret)) {
    console.error(JSON.stringify({ metric: "WEBHOOK_AUTH_FAILED" }));
    return jsonResponse(403, { message: "Forbidden." });
  }

  const rawBody = event.body ?? "{}";
  let payload: AsaasWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as AsaasWebhookPayload;
  } catch {
    reportHandledError(new Error("Invalid webhook JSON body."), {
      context: { requestId: event.requestContext.requestId },
      message: "Invalid webhook JSON body.",
      metric: "WEBHOOK_PAYLOAD_INVALID",
      statusCode: 400
    });
    return jsonResponse(400, { message: "Invalid JSON body." });
  }
  const eventId = rawBodyHash(rawBody);
  const accepted = await repository.recordWebhookEventIfNew({
    eventId,
    eventType: String(payload.event ?? "UNKNOWN"),
    payload: rawBody,
    asaasPaymentId: payload.payment?.id ?? payload.id,
    asaasCheckoutId: payload.payment?.checkoutSession,
    externalReference: payload.payment?.externalReference ?? payload.externalReference
  });

  if (accepted) {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: getEnv().webhookQueueUrl,
        MessageBody: JSON.stringify({ eventId })
      })
    );
  } else {
    console.info(JSON.stringify({ metric: "WEBHOOK_DUPLICATE", eventId }));
  }

  return jsonResponse(200, {
    ok: true,
    duplicate: !accepted,
    eventId
  });
}

export const handler = wrapLambdaHandler(onAsaasWebhook);
