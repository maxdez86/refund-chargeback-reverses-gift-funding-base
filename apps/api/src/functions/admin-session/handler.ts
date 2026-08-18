import { AdminSessionResponseSchema } from "@brimax/contracts";
import type { Context } from "aws-lambda";
import { resolveRuntimeStage } from "../../lib/env";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";

type AdminSessionEvent = {
  headers?: Record<string, string | undefined>;
  requestContext: {
    requestId?: string;
    authorizer?: { lambda?: Record<string, unknown> };
  };
};

async function onAdminSession(event: AdminSessionEvent, _context: Context) {
  const cors = corsHeaders(event.headers?.origin);

  try {
    const identity = event.requestContext.authorizer?.lambda;
    const response = AdminSessionResponseSchema.parse({
      authenticated: true,
      stage: resolveRuntimeStage(),
      admin: identity
    });

    return jsonResponse(200, response, cors);
  } catch (error) {
    reportHandledError(error, {
      context: { requestId: event.requestContext.requestId },
      message: "Invalid administrator authorizer context.",
      metric: "ADMIN_SESSION_CONTEXT_INVALID",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected administrator session error." }, cors);
  }
}

export const handler = wrapLambdaHandler(onAdminSession);
