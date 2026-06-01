import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { PaymentMessageService } from "../../domain/payment-message-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse, noContentResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";

const service = new PaymentMessageService();

async function onCreatePaymentMessage(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse(cors);
  }

  try {
    const paymentId = event.pathParameters?.paymentId;

    if (!paymentId) {
      throw new AppError("Missing payment id.", 400);
    }

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(event.body ?? "{}");
    } catch {
      throw new AppError("Invalid JSON body.", 400);
    }

    const response = await service.createMessage(paymentId, requestBody);

    return jsonResponse(200, response, cors);
  } catch (error) {
    if (error instanceof ZodError) {
      reportHandledError(error, {
        context: { paymentId: event.pathParameters?.paymentId, requestId: event.requestContext.requestId },
        message: "Invalid payment message payload.",
        metric: "PAYMENT_MESSAGE_CREATE_FAILED",
        statusCode: 400
      });
      return jsonResponse(400, { message: "Invalid payment message payload.", issues: error.issues }, cors);
    }

    if (error instanceof AppError) {
      reportHandledError(error, {
        context: { paymentId: event.pathParameters?.paymentId, requestId: event.requestContext.requestId },
        metric: "PAYMENT_MESSAGE_CREATE_FAILED"
      });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, {
      context: { paymentId: event.pathParameters?.paymentId, requestId: event.requestContext.requestId },
      metric: "PAYMENT_MESSAGE_CREATE_FAILED",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected payment message error." }, cors);
  }
}

export const handler = wrapLambdaHandler(onCreatePaymentMessage);
