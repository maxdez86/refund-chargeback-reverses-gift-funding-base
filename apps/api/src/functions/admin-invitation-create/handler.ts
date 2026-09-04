import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ZodError } from "zod";
import { AdminInvitationProvisioningService } from "../../domain/admin-invitation-provisioning-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";

const service = new AdminInvitationProvisioningService();

/**
 * `POST /admin/invitations`.
 *
 * Creates one invitation and its guests from an operator-supplied code. Answers with the full
 * dashboard row so the panel can insert it without a refetch, and with the plain `{ message }`
 * envelope on failure — there is no error code to key on, so the client maps by HTTP status. A
 * duplicate code is the 409.
 */
async function onAdminInvitationCreate(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  try {
    const response = await service.createInvitation(parseBody(event.body));
    return jsonResponse(201, response, cors);
  } catch (error) {
    const context = { requestId: event.requestContext.requestId };

    if (error instanceof ZodError) {
      reportHandledError(error, { context, metric: "ADMIN_INVITATION_CREATE_FAILED", statusCode: 400 });
      return jsonResponse(400, { message: "Invalid invitation request." }, cors);
    }

    if (error instanceof AppError) {
      reportHandledError(error, { context, metric: "ADMIN_INVITATION_CREATE_FAILED" });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, { context, metric: "ADMIN_INVITATION_CREATE_FAILED", statusCode: 500 });
    return jsonResponse(500, { message: "Unexpected invitation create error." }, cors);
  }
}

/** A malformed body is a client error, not a 500, so the parse failure is folded into validation. */
function parseBody(body: string | undefined) {
  try {
    return JSON.parse(body ?? "{}");
  } catch {
    throw new AppError("Invalid invitation request.", 400);
  }
}

export const handler = wrapLambdaHandler(onAdminInvitationCreate);
