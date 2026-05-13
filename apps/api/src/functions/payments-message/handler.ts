import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { PaymentMessageService } from "../../domain/payment-message-service";
import { AppError } from "../../lib/errors";
import { jsonResponse, noContentResponse } from "../../lib/http";

const service = new PaymentMessageService();

export async function handler(event: APIGatewayProxyEventV2) {
  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse();
  }

  try {
    const paymentId = event.pathParameters?.paymentId;

    if (!paymentId) {
      throw new AppError("Missing payment id.", 400);
    }

    const requestBody = JSON.parse(event.body ?? "{}");
    const response = await service.createMessage(paymentId, requestBody);

    return jsonResponse(200, response);
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonResponse(400, { message: "Invalid payment message payload.", issues: error.issues });
    }

    if (error instanceof AppError) {
      return jsonResponse(error.statusCode, { message: error.message });
    }

    return jsonResponse(500, { message: "Unexpected payment message error." });
  }
}
