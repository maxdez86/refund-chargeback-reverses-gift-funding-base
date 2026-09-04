import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { AdminInvitationProvisioningService } from "../../domain/admin-invitation-provisioning-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";

const service = new AdminInvitationProvisioningService();

/**
 * `DELETE /admin/invitations/{invitationCode}`.
 *
 * Hard-deletes the invitation, its guests, its RSVP, its WhatsApp history and its phone lookup.
 * There is no request body and no `ZodError` branch, since the code is the whole input. Answers
 * with what was removed so the operator can see the blast radius.
 */
async function onAdminInvitationDelete(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);
  const invitationCode = event.pathParameters?.invitationCode;

  try {
    if (!invitationCode) {
      throw new AppError("Missing invitation code.", 400);
    }

    const response = await service.deleteInvitation(invitationCode);
    return jsonResponse(200, response, cors);
  } catch (error) {
    const context = { invitationCode, requestId: event.requestContext.requestId };

    if (error instanceof AppError) {
      reportHandledError(error, { context, metric: "ADMIN_INVITATION_DELETE_FAILED" });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, { context, metric: "ADMIN_INVITATION_DELETE_FAILED", statusCode: 500 });
    return jsonResponse(500, { message: "Unexpected invitation delete error." }, cors);
  }
}

export const handler = wrapLambdaHandler(onAdminInvitationDelete);
