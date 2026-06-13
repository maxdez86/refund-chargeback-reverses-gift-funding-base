import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { PaymentDiscardService } from "../../domain/payment-discard-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse, noContentResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { withWarmup } from "../../lib/warmup";
import { getAppSecret } from "../../services/secrets-manager/app-secrets";

const service = new PaymentDiscardService();

async function onDiscardPayment(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse(cors);
  }

  try {
    const paymentId = event.pathParameters?.paymentId?.trim();
    if (!paymentId) {
      throw new AppError("Missing payment id.", 400);
    }

    const idempotencyKey =
      event.headers["idempotency-key"] ?? event.headers["Idempotency-Key"];
    const response = await service.discard(paymentId, idempotencyKey?.trim());

    console.info(JSON.stringify({ metric: "PAYMENT_DISCARDED", paymentId }));
    return jsonResponse(200, response, cors);
  } catch (error) {
    if (error instanceof AppError) {
      reportHandledError(error, {
        context: {
          paymentId: event.pathParameters?.paymentId,
          requestId: event.requestContext.requestId
        },
        metric: "PAYMENT_DISCARD_FAILED"
      });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, {
      context: {
        paymentId: event.pathParameters?.paymentId,
        requestId: event.requestContext.requestId
      },
      metric: "PAYMENT_DISCARD_FAILED",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected payment discard error." }, cors);
  }
}

export const handler = withWarmup(wrapLambdaHandler(onDiscardPayment), () =>
  getAppSecret("asaasApiKey")
);
