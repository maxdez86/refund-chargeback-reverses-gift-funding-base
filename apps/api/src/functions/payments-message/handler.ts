import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { PaymentMessageService } from "../../domain/payment-message-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse, noContentResponse } from "../../lib/http";

const service = new PaymentMessageService();

export async function handler(event: APIGatewayProxyEventV2) {
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
      return jsonResponse(400, { message: "Invalid payment message payload.", issues: error.issues }, cors);
    }

    if (error instanceof AppError) {
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    return jsonResponse(500, { message: "Unexpected payment message error." }, cors);
  }
}
