import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { PaymentService } from "../../domain/payment-service";
import { AppError } from "../../lib/errors";
import { jsonResponse, noContentResponse } from "../../lib/http";

const service = new PaymentService();

export async function handler(event: APIGatewayProxyEventV2) {
  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse();
  }

  try {
    const requestBody = JSON.parse(event.body ?? "{}");
    const idempotencyKey = event.headers["idempotency-key"] ?? event.headers["Idempotency-Key"];
    const response = await service.createPayment(requestBody, idempotencyKey);

    console.info(JSON.stringify({ metric: "PAYMENT_CREATED", paymentId: response.payment.paymentId }));

    return jsonResponse(201, response);
  } catch (error) {
    if (error instanceof ZodError) {
      console.error(JSON.stringify({ metric: "PAYMENT_CREATE_FAILED", reason: "validation" }));
      return jsonResponse(400, { message: "Invalid payment payload.", issues: error.issues });
    }

    if (error instanceof AppError) {
      console.error(
        JSON.stringify({ metric: "PAYMENT_CREATE_FAILED", reason: error.message, statusCode: error.statusCode })
      );
      return jsonResponse(error.statusCode, { message: error.message });
    }

    console.error(JSON.stringify({ metric: "PAYMENT_CREATE_FAILED", reason: "unexpected" }));
    return jsonResponse(500, { message: "Unexpected payment creation error." });
  }
}
