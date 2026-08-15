import { createHmac } from "node:crypto";
import type { WhatsappWebhookEvent } from "@brimax/contracts";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { jsonResponse } from "../../lib/http";
import { safeEqual } from "../../lib/security";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { getAppSecret } from "../../services/secrets-manager/app-secrets";
import { parseWhatsappWebhook } from "../../services/whatsapp/webhook-parser";

function headerValue(headers: Record<string, string | undefined>, name: string) {
  const expected = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === expected);
  return entry?.[1];
}

function rawBody(event: APIGatewayProxyEventV2) {
  const body = event.body ?? "";

  if (!event.isBase64Encoded) {
    return body;
  }

  try {
    return Buffer.from(body, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function verifySignature(raw: string, signature: string | undefined, appSecret: string) {
  if (!signature || !appSecret) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", appSecret).update(raw).digest("hex")}`;
  return safeEqual(signature.trim(), expected);
}

function eventCategory(event: WhatsappWebhookEvent) {
  if (event.type.startsWith("status_")) return "status";
  if (event.type === "unknown_event" || event.type === "invalid_payload") return "parser";
  return "message";
}

function logReceipt(event: WhatsappWebhookEvent, requestId: string) {
  const errorCodes =
    "errors" in event
      ? event.errors.flatMap((error) => (error.code === undefined ? [] : [error.code]))
      : event.type === "unknown_event"
        ? event.errorCodes
        : [];

  console.info(
    JSON.stringify({
      metric: "WHATSAPP_WEBHOOK_RECEIVED",
      requestId,
      category: eventCategory(event),
      eventType: event.type,
      messageId: "messageId" in event ? event.messageId : undefined,
      status: "status" in event ? event.status : undefined,
      buttonId: event.type === "button_reply" ? event.buttonId : undefined,
      listReplyId: event.type === "list_reply" ? event.listReplyId : undefined,
      originalType:
        event.type === "unsupported_message"
          ? event.originalMessageType
          : event.type === "unknown_event"
            ? event.originalType
            : undefined,
      errorCodes: errorCodes.length > 0 ? errorCodes : undefined,
      duplicateWithinPayload: event.duplicateWithinPayload
    })
  );
}

async function onWhatsappWebhook(event: APIGatewayProxyEventV2) {
  const method = event.requestContext.http.method;

  if (method === "GET") {
    const parameters = event.queryStringParameters ?? {};
    const verificationToken = await getAppSecret("whatsappVerifyToken");

    if (
      parameters["hub.mode"] !== "subscribe" ||
      !parameters["hub.challenge"] ||
      !verificationToken ||
      !safeEqual(parameters["hub.verify_token"] ?? "", verificationToken)
    ) {
      console.error(
        JSON.stringify({
          metric: "WHATSAPP_WEBHOOK_VERIFY_FAILED",
          requestId: event.requestContext.requestId
        })
      );
      return jsonResponse(403, { message: "Forbidden." });
    }

    return {
      statusCode: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: parameters["hub.challenge"]
    };
  }

  if (method !== "POST") {
    return jsonResponse(405, { message: "Method not allowed." });
  }

  const raw = rawBody(event);
  const appSecret = await getAppSecret("whatsappAppSecret");

  if (!raw || !verifySignature(raw, headerValue(event.headers, "x-hub-signature-256"), appSecret)) {
    console.error(
      JSON.stringify({
        metric: "WHATSAPP_WEBHOOK_AUTH_FAILED",
        requestId: event.requestContext.requestId
      })
    );
    return jsonResponse(403, { message: "Forbidden." });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    reportHandledError(new Error("Invalid WhatsApp webhook JSON body."), {
      context: { requestId: event.requestContext.requestId },
      message: "Invalid WhatsApp webhook JSON body.",
      metric: "WHATSAPP_WEBHOOK_PAYLOAD_INVALID",
      statusCode: 400
    });
    return jsonResponse(400, { message: "Invalid JSON body." });
  }

  const result = parseWhatsappWebhook(parsed);
  if (result.outcome === "invalid_payload") {
    reportHandledError(new Error("Invalid WhatsApp webhook payload."), {
      context: {
        requestId: event.requestContext.requestId,
        parseOutcome: result.outcome,
        reason: result.reason,
        issueCount: result.issueCount
      },
      message: "Invalid WhatsApp webhook payload.",
      metric: "WHATSAPP_WEBHOOK_PAYLOAD_INVALID",
      statusCode: 400
    });
    return jsonResponse(400, { message: "Invalid WhatsApp webhook payload." });
  }

  console.info(
    JSON.stringify({
      metric: "WHATSAPP_WEBHOOK_PARSED",
      requestId: event.requestContext.requestId,
      parseOutcome: result.outcome,
      eventCount: result.events.length,
      duplicateEventCount: result.duplicateEventIds.length
    })
  );
  for (const parsedEvent of result.events) {
    logReceipt(parsedEvent, event.requestContext.requestId);
  }
  return jsonResponse(200, { ok: true, received: true });
}

export const handler = wrapLambdaHandler(onWhatsappWebhook);
