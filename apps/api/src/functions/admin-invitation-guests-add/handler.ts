import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { AdminInvitationProvisioningService } from "../../domain/admin-invitation-provisioning-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";

const service = new AdminInvitationProvisioningService();

/**
 * `POST /admin/invitations/{invitationCode}/guests`.
 *
 * Appends guests to an existing invitation. The server assigns each new slot as `max(sortOrder) + 1`
 * and derives the guest id from it, so a request carrying a slot is rejected rather than obeyed.
 * Shares the guest-update route's response and error envelopes.
 */
async function onAdminInvitationGuestsAdd(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);
  const invitationCode = event.pathParameters?.invitationCode;

  try {
    if (!invitationCode) {
      throw new AppError("Missing invitation code.", 400);
    }

    const response = await service.addGuests(invitationCode, parseBody(event.body));
    return jsonResponse(200, response, cors);
  } catch (error) {
    const context = { invitationCode, requestId: event.requestContext.requestId };

    if (error instanceof ZodError) {
      reportHandledError(error, { context, metric: "ADMIN_INVITATION_GUESTS_ADD_FAILED", statusCode: 400 });
      return jsonResponse(400, { message: "Invalid add guests request." }, cors);
    }

    if (error instanceof AppError) {
      reportHandledError(error, { context, metric: "ADMIN_INVITATION_GUESTS_ADD_FAILED" });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, { context, metric: "ADMIN_INVITATION_GUESTS_ADD_FAILED", statusCode: 500 });
    return jsonResponse(500, { message: "Unexpected add guests error." }, cors);
  }
}

/** A malformed body is a client error, not a 500, so the parse failure is folded into validation. */
function parseBody(body: string | undefined) {
  try {
    return JSON.parse(body ?? "{}");
  } catch {
    throw new AppError("Invalid add guests request.", 400);
  }
}

export const handler = wrapLambdaHandler(onAdminInvitationGuestsAdd);
