import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { GuestMessageService } from "../../domain/guest-message-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";

const service = new GuestMessageService();

async function onDeleteGuestMessage(event: APIGatewayProxyEventV2) {
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
      reportHandledError(error, {
        context: { messageId: event.pathParameters?.messageId, requestId: event.requestContext.requestId },
        metric: "GUEST_MESSAGE_DELETE_FAILED"
      });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, {
      context: { messageId: event.pathParameters?.messageId, requestId: event.requestContext.requestId },
      metric: "GUEST_MESSAGE_DELETE_FAILED",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected guest message delete error." }, cors);
  }
}

export const handler = wrapLambdaHandler(onDeleteGuestMessage);
