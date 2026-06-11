import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { RsvpSubmissionRequestSchema } from "@brimax/contracts";
import { RsvpService } from "../../domain/rsvp-service";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { AppError } from "../../lib/errors";
import { verifyLookupProof } from "../../lib/lookup-proof";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { withWarmup } from "../../lib/warmup";
import { getAppSecret } from "../../services/secrets-manager/app-secrets";

const service = new RsvpService();

async function onSubmitRsvp(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  try {
    const idempotencyKey = event.headers["idempotency-key"] ?? event.headers["Idempotency-Key"];
    let requestBody: unknown;
    try {
      requestBody = JSON.parse(event.body ?? "{}");
    } catch {
      throw new AppError("Invalid JSON body.", 400);
    }
    const parsedRequest = RsvpSubmissionRequestSchema.parse(requestBody);
    await verifyLookupProof(event, parsedRequest.invitationCode);
    const { response, notificationSent } = await service.submit(parsedRequest);

    console.info(
      JSON.stringify({
        metric: "RSVP_SUBMITTED",
        invitationCode: response.invitationCode,
        status: response.status,
        notificationSent,
        idempotencyKeyPresent: Boolean(idempotencyKey?.trim())
      })
    );

    console.info(
      JSON.stringify({
        metric: notificationSent ? "RSVP_EMAIL_SENT" : "RSVP_EMAIL_SKIPPED",
        invitationCode: response.invitationCode
      })
    );

    return jsonResponse(200, response, cors);
  } catch (error) {
    if (error instanceof ZodError) {
      reportHandledError(error, {
        context: { requestId: event.requestContext.requestId },
        message: "Invalid RSVP payload.",
        metric: "RSVP_SUBMIT_FAILED",
        statusCode: 400
      });
      return jsonResponse(400, { message: "Invalid RSVP payload.", issues: error.issues }, cors);
    }

    if (error instanceof AppError) {
      reportHandledError(error, {
        context: { requestId: event.requestContext.requestId },
        metric: "RSVP_SUBMIT_FAILED"
      });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, {
      context: { requestId: event.requestContext.requestId },
      metric: "RSVP_SUBMIT_FAILED",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected RSVP error." }, cors);
  }
}

export const handler = withWarmup(wrapLambdaHandler(onSubmitRsvp), () =>
  getAppSecret("lookupProofSecret")
);
