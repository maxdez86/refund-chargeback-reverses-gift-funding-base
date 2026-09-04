import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { AdminInvitationCodeService } from "../../domain/admin-invitation-code-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";

const service = new AdminInvitationCodeService();

async function onAdminInvitationNextCode(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  try {
    return jsonResponse(200, await service.getNextCode(), cors);
  } catch (error) {
    const context = { requestId: event.requestContext.requestId };
    if (error instanceof AppError) {
      reportHandledError(error, { context, metric: "ADMIN_INVITATION_NEXT_CODE_FAILED" });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }
    reportHandledError(error, { context, metric: "ADMIN_INVITATION_NEXT_CODE_FAILED", statusCode: 500 });
    return jsonResponse(500, { message: "Unexpected invitation code suggestion error." }, cors);
  }
}

export const handler = wrapLambdaHandler(onAdminInvitationNextCode);
