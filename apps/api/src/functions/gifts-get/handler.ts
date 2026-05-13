import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { GiftService } from "../../domain/gift-service";
import { jsonResponse, noContentResponse } from "../../lib/http";

const service = new GiftService();

export async function handler(event: APIGatewayProxyEventV2) {
  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse();
  }

  try {
    const response = await service.getGifts();
    return jsonResponse(200, response);
  } catch {
    return jsonResponse(500, { message: "Unexpected gift lookup error." });
  }
}
