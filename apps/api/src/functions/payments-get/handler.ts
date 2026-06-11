import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { PaymentService } from "../../domain/payment-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse, noContentResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { withWarmup } from "../../lib/warmup";

const service = new PaymentService();

async function onGetPayment(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse(cors);
  }

  try {
    const paymentId = event.pathParameters?.paymentId;

    if (!paymentId) {
      throw new AppError("Missing payment id.", 400);
    }

    const payment = await service.getPayment(paymentId);

    return jsonResponse(200, {
      ok: true,
      payment
    }, cors);
  } catch (error) {
    if (error instanceof AppError) {
      reportHandledError(error, {
        context: { paymentId: event.pathParameters?.paymentId, requestId: event.requestContext.requestId },
        metric: "PAYMENT_LOOKUP_FAILED"
      });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, {
      context: { paymentId: event.pathParameters?.paymentId, requestId: event.requestContext.requestId },
      metric: "PAYMENT_LOOKUP_FAILED",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected payment lookup error." }, cors);
  }
}

export const handler = withWarmup(wrapLambdaHandler(onGetPayment));
