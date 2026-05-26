import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { PaymentService } from "../../domain/payment-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse, noContentResponse } from "../../lib/http";

const service = new PaymentService();
let isColdStart = true;

export async function handler(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse(cors);
  }

  const startedAt = Date.now();
  const requestId = event.requestContext.requestId;
  const coldStart = isColdStart;
  isColdStart = false;

  try {
    let requestBody: unknown;
    try {
      requestBody = JSON.parse(event.body ?? "{}");
    } catch {
      throw new AppError("Invalid JSON body.", 400);
    }
    const idempotencyKey = event.headers["idempotency-key"] ?? event.headers["Idempotency-Key"];
    const response = await service.createPayment(requestBody, idempotencyKey);

    console.info(JSON.stringify({ metric: "PAYMENT_CREATED", paymentId: response.payment.paymentId }));
    console.info(
      JSON.stringify({
        metric: "PAYMENT_CREATE_TIMING",
        requestId,
        paymentId: response.payment.paymentId,
        giftId: response.payment.gift.id,
        paymentMethod: response.payment.paymentMethod,
        idempotencyKeyPresent: Boolean(idempotencyKey?.trim()),
        coldStart,
        durationMs: Date.now() - startedAt,
        outcome: "success"
      })
    );

    return jsonResponse(201, response, cors);
  } catch (error) {
    const requestBody =
      event.body && event.body.trim()
        ? safeJsonParseObject(event.body)
        : undefined;
    const giftId = typeof requestBody?.giftId === "string" ? requestBody.giftId : undefined;
    const paymentMethod =
      typeof requestBody?.paymentMethod === "string" ? requestBody.paymentMethod : undefined;
    const logTiming = (statusCode: number, reason: string) => {
      console.info(
        JSON.stringify({
          metric: "PAYMENT_CREATE_TIMING",
          requestId,
          giftId,
          paymentMethod,
          idempotencyKeyPresent: Boolean(
            (event.headers["idempotency-key"] ?? event.headers["Idempotency-Key"])?.trim()
          ),
          coldStart,
          durationMs: Date.now() - startedAt,
          outcome: "failure",
          statusCode,
          reason
        })
      );
    };

    if (error instanceof ZodError) {
      console.error(JSON.stringify({ metric: "PAYMENT_CREATE_FAILED", reason: "validation" }));
      logTiming(400, "validation");
      return jsonResponse(400, { message: "Invalid payment payload.", issues: error.issues }, cors);
    }

    if (error instanceof AppError) {
      console.error(
        JSON.stringify({ metric: "PAYMENT_CREATE_FAILED", reason: error.message, statusCode: error.statusCode })
      );
      logTiming(error.statusCode, error.message);
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    console.error(JSON.stringify({ metric: "PAYMENT_CREATE_FAILED", reason: "unexpected" }));
    logTiming(500, "unexpected");
    return jsonResponse(500, { message: "Unexpected payment creation error." }, cors);
  }
}

function safeJsonParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
