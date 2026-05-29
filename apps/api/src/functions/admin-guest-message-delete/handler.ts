import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { GuestMessageService } from "../../domain/guest-message-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";

const service = new GuestMessageService();

export async function handler(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  try {
    const messageId = event.pathParameters?.messageId;

    if (!messageId) {
      throw new AppError("Missing guest message id.", 400);
    }

    const response = await service.delete(messageId);
    return jsonResponse(200, response, cors);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    return jsonResponse(500, { message: "Unexpected guest message delete error." }, cors);
  }
}
