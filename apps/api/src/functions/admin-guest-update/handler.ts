import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { AdminGuestRsvpService } from "../../domain/admin-guest-rsvp-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";

const service = new AdminGuestRsvpService();

/**
 * `PATCH /admin/invitations/{invitationCode}/guests/{guestId}`.
 *
 * Corrects one guest's RSVP status, seed child flag, or confirmed age band. Answers with the
 * invitation's full guest list and recomputed aggregate so the dashboard reconciles without a
 * refetch, and with the plain `{ message }` envelope on failure — there is no error code to key on,
 * so the client maps by HTTP status.
 */
async function onAdminGuestUpdate(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);
  const invitationCode = event.pathParameters?.invitationCode;
  const guestId = event.pathParameters?.guestId;

  try {
    if (!invitationCode || !guestId) {
      throw new AppError("Missing invitation code or guest id.", 400);
    }

    const response = await service.updateGuest(invitationCode, guestId, parseBody(event.body));
    return jsonResponse(200, response, cors);
  } catch (error) {
    const context = { invitationCode, guestId, requestId: event.requestContext.requestId };

    if (error instanceof ZodError) {
      reportHandledError(error, { context, metric: "ADMIN_GUEST_UPDATE_FAILED", statusCode: 400 });
      return jsonResponse(400, { message: "Invalid guest update request." }, cors);
    }

    if (error instanceof AppError) {
      reportHandledError(error, { context, metric: "ADMIN_GUEST_UPDATE_FAILED" });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, { context, metric: "ADMIN_GUEST_UPDATE_FAILED", statusCode: 500 });
    return jsonResponse(500, { message: "Unexpected guest update error." }, cors);
  }
}

/** A malformed body is a client error, not a 500, so the parse failure is folded into validation. */
function parseBody(body: string | undefined) {
  try {
    return JSON.parse(body ?? "{}");
  } catch {
    throw new AppError("Invalid guest update request.", 400);
  }
}

export const handler = wrapLambdaHandler(onAdminGuestUpdate);
