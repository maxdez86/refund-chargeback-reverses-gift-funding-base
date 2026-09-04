import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { AdminGuestRsvpService } from "../../domain/admin-guest-rsvp-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";

const service = new AdminGuestRsvpService();

/**
 * `POST /admin/invitations/{invitationCode}/confirm-all`.
 *
 * Confirms the selected guests of one invitation in a single write. Guests left out of the payload
 * keep the status they already had. Shares the guest-update route's response and error envelopes.
 */
async function onConfirmInvitationGuests(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);
  const invitationCode = event.pathParameters?.invitationCode;

  try {
    if (!invitationCode) {
      throw new AppError("Missing invitation code.", 400);
    }

    const response = await service.confirmGuests(invitationCode, parseBody(event.body));
    return jsonResponse(200, response, cors);
  } catch (error) {
    const context = { invitationCode, requestId: event.requestContext.requestId };

    if (error instanceof ZodError) {
      reportHandledError(error, { context, metric: "ADMIN_CONFIRM_GUESTS_FAILED", statusCode: 400 });
      return jsonResponse(400, { message: "Invalid guest confirmation request." }, cors);
    }

    if (error instanceof AppError) {
      reportHandledError(error, { context, metric: "ADMIN_CONFIRM_GUESTS_FAILED" });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, { context, metric: "ADMIN_CONFIRM_GUESTS_FAILED", statusCode: 500 });
    return jsonResponse(500, { message: "Unexpected guest confirmation error." }, cors);
  }
}

/** A malformed body is a client error, not a 500, so the parse failure is folded into validation. */
function parseBody(body: string | undefined) {
  try {
    return JSON.parse(body ?? "{}");
  } catch {
    throw new AppError("Invalid guest confirmation request.", 400);
  }
}

export const handler = wrapLambdaHandler(onConfirmInvitationGuests);
