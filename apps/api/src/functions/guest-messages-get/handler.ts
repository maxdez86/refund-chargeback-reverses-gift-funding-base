import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { GuestMessageService } from "../../domain/guest-message-service";

const service = new GuestMessageService();

export async function handler(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  try {
    const cursor = event.queryStringParameters?.cursor ?? null;
    const response = await service.list(cursor);
    return jsonResponse(200, response, cors);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    return jsonResponse(500, { message: "Unexpected guest messages lookup error." }, cors);
  }
}
