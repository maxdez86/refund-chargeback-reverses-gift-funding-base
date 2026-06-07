import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { CreateGuestMessageRequestSchema } from "@brimax/contracts";
import { GuestMessageService } from "../../domain/guest-message-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { verifyTurnstile } from "../../lib/turnstile";

const service = new GuestMessageService();

async function onCreateGuestMessage(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  try {
    await verifyTurnstile(event);

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(event.body ?? "{}");
    } catch {
      throw new AppError("Invalid JSON body.", 400);
    }

    const parsedRequest = CreateGuestMessageRequestSchema.parse(requestBody);
    const { response, notificationSent } = await service.create(parsedRequest);

    console.info(
      JSON.stringify({
        metric: "GUEST_MESSAGE_CREATED",
        messageId: response.message.messageId,
        notificationSent
      })
    );

    return jsonResponse(200, response, cors);
  } catch (error) {
    if (error instanceof ZodError) {
      reportHandledError(error, {
        context: { requestId: event.requestContext.requestId },
        message: "Invalid guest message payload.",
        metric: "GUEST_MESSAGE_CREATE_FAILED",
        statusCode: 400
      });
      return jsonResponse(400, { message: "Invalid guest message payload.", issues: error.issues }, cors);
    }

    if (error instanceof AppError) {
      reportHandledError(error, {
        context: { requestId: event.requestContext.requestId },
        metric: "GUEST_MESSAGE_CREATE_FAILED"
      });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, {
      context: { requestId: event.requestContext.requestId },
      metric: "GUEST_MESSAGE_CREATE_FAILED",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected guest message submit error." }, cors);
  }
}

export const handler = wrapLambdaHandler(onCreateGuestMessage);
