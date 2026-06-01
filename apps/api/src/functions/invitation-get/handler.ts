import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { InvitationService } from "../../domain/invitation-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { issueLookupProof } from "../../lib/lookup-proof";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { verifyTurnstile } from "../../lib/turnstile";

const service = new InvitationService();

async function onGetInvitation(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  try {
    await verifyTurnstile(event);

    const invitationCode = event.pathParameters?.code;

    if (!invitationCode) {
      throw new AppError("Missing invitation code.", 400);
    }

    const invitation = await service.getInvitation(invitationCode);
    const proof = await issueLookupProof(invitation.invitationCode);

    return jsonResponse(
      200,
      {
        invitation,
        lookupProof: proof.lookupProof,
        lookupProofExpiresAt: proof.lookupProofExpiresAt
      },
      cors
    );
  } catch (error) {
    if (error instanceof AppError) {
      reportHandledError(error, {
        context: {
          invitationCode: event.pathParameters?.code,
          requestId: event.requestContext.requestId
        },
        metric: "INVITATION_LOOKUP_FAILED"
      });
      return jsonResponse(error.statusCode, { message: error.message }, cors);
    }

    reportHandledError(error, {
      context: {
        invitationCode: event.pathParameters?.code,
        requestId: event.requestContext.requestId
      },
      metric: "INVITATION_LOOKUP_FAILED",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected invitation lookup error." }, cors);
  }
}

export const handler = wrapLambdaHandler(onGetInvitation);
