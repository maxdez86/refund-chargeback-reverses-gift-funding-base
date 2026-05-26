import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { PaymentService } from "../../domain/payment-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse, noContentResponse } from "../../lib/http";

const service = new PaymentService();

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

    const payment = await service.getPayment(paymentId);

    return jsonResponse(200, {
      ok: true,
      payment
    }, cors);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    return jsonResponse(500, { message: "Unexpected payment lookup error." }, cors);
  }
}
