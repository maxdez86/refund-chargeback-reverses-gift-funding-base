import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { RsvpService } from "../../domain/rsvp-service";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { AppError } from "../../lib/errors";

const service = new RsvpService();

export async function handler(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  try {
    const idempotencyKey = event.headers["idempotency-key"] ?? event.headers["Idempotency-Key"];
    let requestBody: unknown;
    try {
      requestBody = JSON.parse(event.body ?? "{}");
    } catch {
      throw new AppError("Invalid JSON body.", 400);
    }
    const { response, notificationSent } = await service.submit(requestBody);

    console.info(
      JSON.stringify({
        metric: "RSVP_SUBMITTED",
        invitationCode: response.invitationCode,
        householdId: response.householdId,
        status: response.status,
        notificationSent,
        idempotencyKeyPresent: Boolean(idempotencyKey?.trim())
      })
    );

    console.info(
      JSON.stringify({
        metric: notificationSent ? "RSVP_EMAIL_SENT" : "RSVP_EMAIL_SKIPPED",
        invitationCode: response.invitationCode,
        householdId: response.householdId
      })
    );

    return jsonResponse(200, response, cors);
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonResponse(400, { message: "Invalid RSVP payload.", issues: error.issues }, cors);
    }

    if (error instanceof AppError) {
      console.error(
        JSON.stringify({
          metric: "RSVP_SUBMIT_FAILED",
          statusCode: error.statusCode,
          message: error.message
        })
      );
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    console.error(
      JSON.stringify({
        metric: "RSVP_SUBMIT_FAILED",
        statusCode: 500,
        message: error instanceof Error ? error.message : "Unexpected RSVP error."
      })
    );
    return jsonResponse(500, { message: "Unexpected RSVP error." }, cors);
  }
}
