import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { InvitationService } from "../../domain/invitation-service";
import { AppError } from "../../lib/errors";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { issueLookupProof } from "../../lib/lookup-proof";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { verifyTurnstile } from "../../lib/turnstile";
import { withWarmup } from "../../lib/warmup";
import { getAppSecret } from "../../services/secrets-manager/app-secrets";

const service = new InvitationService();

async function onGetInvitation(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  try {
    // Start the DynamoDB read concurrently with the Turnstile verify, but gate
    // the response on verify: an unverified caller always gets 403, so the
    // lookup result (or its 400/404) never leaks ahead of verification. Worst
    // case a bot with a bad token costs one gated point read.
    const invitationCode = event.pathParameters?.code;
    const invitationPromise = invitationCode
      ? service.getInvitation(invitationCode)
      : Promise.reject(new AppError("Missing invitation code.", 400));
    // No unhandledRejection if verify throws before the lookup settles.
    void invitationPromise.catch(() => {});

    await verifyTurnstile(event);

    const invitation = await invitationPromise;
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

// Priming any one key refreshes the whole-bucket secret cache, covering both
// turnstileSecretKey (verifyTurnstile) and lookupProofSecret (issueLookupProof).
export const handler = withWarmup(wrapLambdaHandler(onGetInvitation), () =>
  getAppSecret("turnstileSecretKey")
);
