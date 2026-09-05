import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getEnv } from "../../lib/env";
import { jsonResponse, noContentResponse } from "../../lib/http";
import { rawBodyHash, safeEqual } from "../../lib/security";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { annotateTrace, captureAwsClient, withTracedSubsegment } from "../../lib/xray";
import { PaymentRepository } from "../../services/dynamodb/repositories/payment-repository";
import { getAppSecret } from "../../services/secrets-manager/app-secrets";

const repository = new PaymentRepository();
const sqsClient = captureAwsClient(new SQSClient({}));

type AsaasWebhookPayload = {
  event?: string;
  payment?: {
    id?: string;
    checkoutSession?: string;
    externalReference?: string;
  };
  checkout?: {
    id?: string;
    callback?: {
      successUrl?: string;
      cancelUrl?: string;
      expiredUrl?: string;
    };
    externalReference?: string;
  };
  id?: string;
  externalReference?: string;
};

function parsePaymentIdFromCallbackUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const params = new URLSearchParams(hash);
    return params.get("paymentId") ?? undefined;
  } catch {
    return undefined;
  }
}

async function onAsaasWebhook(event: APIGatewayProxyEventV2) {
  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse();
  }

  const tokenHeader = event.headers["asaas-access-token"] ?? event.headers["Asaas-Access-Token"];
  const webhookSecret = await getAppSecret("asaasWebhookToken");

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
    asaasCheckoutId: payload.payment?.checkoutSession ?? payload.checkout?.id,
    externalReference:
      payload.payment?.externalReference ??
      payload.checkout?.externalReference ??
      parsePaymentIdFromCallbackUrl(payload.checkout?.callback?.successUrl) ??
      parsePaymentIdFromCallbackUrl(payload.checkout?.callback?.cancelUrl) ??
      parsePaymentIdFromCallbackUrl(payload.checkout?.callback?.expiredUrl) ??
      payload.externalReference
  });

  annotateTrace({
    asaas_payment_id: payload.payment?.id,
    duplicate: !accepted,
    entity_id: eventId,
    flow: "webhook"
  });

  if (accepted) {
    await withTracedSubsegment(
      "webhook.enqueue_event",
      {
        duplicate: false,
        entity_id: eventId,
        flow: "webhook"
      },
      async () =>
        sqsClient.send(
          new SendMessageCommand({
            QueueUrl: getEnv().webhookQueueUrl,
            MessageBody: JSON.stringify({ eventId })
          })
        )
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
