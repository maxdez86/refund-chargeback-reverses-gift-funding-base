import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { AdminInvitationProvisioningService } from "../../domain/admin-invitation-provisioning-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";

const service = new AdminInvitationProvisioningService();

/**
 * `DELETE /admin/invitations/{invitationCode}/guests/{guestId}`.
 *
 * Removes one guest and prunes the answer they left, then answers with the invitation's remaining
 * guest list and recomputed aggregate — the same envelope the guest-update route returns. There is
 * no request body: the guest is fully identified by the path. Removing the last guest is a 409.
 */
async function onAdminInvitationGuestRemove(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);
  const invitationCode = event.pathParameters?.invitationCode;
  const guestId = event.pathParameters?.guestId;

  try {
    if (!invitationCode || !guestId) {
      throw new AppError("Missing invitation code or guest id.", 400);
    }

    const response = await service.removeGuest(invitationCode, guestId);
    return jsonResponse(200, response, cors);
  } catch (error) {
    const context = { invitationCode, guestId, requestId: event.requestContext.requestId };

    if (error instanceof AppError) {
      reportHandledError(error, { context, metric: "ADMIN_INVITATION_GUEST_REMOVE_FAILED" });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, { context, metric: "ADMIN_INVITATION_GUEST_REMOVE_FAILED", statusCode: 500 });
    return jsonResponse(500, { message: "Unexpected guest removal error." }, cors);
  }
}

export const handler = wrapLambdaHandler(onAdminInvitationGuestRemove);
