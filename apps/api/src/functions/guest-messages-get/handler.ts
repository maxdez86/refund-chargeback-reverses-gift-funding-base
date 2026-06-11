import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { withWarmup } from "../../lib/warmup";
import { GuestMessageService } from "../../domain/guest-message-service";

const service = new GuestMessageService();

async function onGetGuestMessages(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  try {
    const cursor = event.queryStringParameters?.cursor ?? null;
    const response = await service.list(cursor);
    return jsonResponse(200, response, cors);
  } catch (error) {
    if (error instanceof AppError) {
      reportHandledError(error, {
        context: { cursor: event.queryStringParameters?.cursor ?? null, requestId: event.requestContext.requestId },
        metric: "GUEST_MESSAGES_LOOKUP_FAILED"
      });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, {
      context: { cursor: event.queryStringParameters?.cursor ?? null, requestId: event.requestContext.requestId },
      metric: "GUEST_MESSAGES_LOOKUP_FAILED",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected guest messages lookup error." }, cors);
  }
}

export const handler = withWarmup(wrapLambdaHandler(onGetGuestMessages));
