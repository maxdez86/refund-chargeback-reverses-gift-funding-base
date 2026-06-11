import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { GiftService } from "../../domain/gift-service";
import { corsHeaders, jsonResponse, noContentResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { withWarmup } from "../../lib/warmup";

const service = new GiftService();

async function onGetGifts(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse(cors);
  }

  try {
    const response = await service.getGifts();
    return jsonResponse(200, response, cors);
  } catch (error) {
    reportHandledError(error, {
      context: { requestId: event.requestContext.requestId },
      metric: "GIFTS_LOOKUP_FAILED",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected gift lookup error." }, cors);
  }
}

export const handler = withWarmup(wrapLambdaHandler(onGetGifts));
