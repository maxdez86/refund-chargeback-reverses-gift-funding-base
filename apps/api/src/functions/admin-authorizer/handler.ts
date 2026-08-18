import type { Context } from "aws-lambda";
import {
  parseBearerToken,
  verifyGoogleAdminToken,
  type GoogleIdTokenVerifier
} from "../../lib/admin-google-auth";
import { getAdminAuthEnv } from "../../lib/env";
import { headerValue } from "../../lib/http";
import { wrapLambdaHandler } from "../../lib/sentry";

type AuthorizerEvent = {
  headers?: Record<string, string | undefined>;
  routeKey?: string;
  requestContext?: { requestId?: string };
};

type AuthorizerResponse = {
  isAuthorized: boolean;
  context?: Record<string, string>;
};

export function createAdminAuthorizer(verifier?: GoogleIdTokenVerifier) {
  return async (event: AuthorizerEvent, _context: Context): Promise<AuthorizerResponse> => {
    const adminEnv = getAdminAuthEnv();
    const requestContext = {
      requestId: event.requestContext?.requestId,
      route: event.routeKey,
      stage: adminEnv.stage
    };
    const token = parseBearerToken(headerValue(event.headers ?? {}, "authorization"));

    if (!token) {
      console.warn(JSON.stringify({ metric: "ADMIN_AUTH_DENIED", reason: "malformed_bearer", ...requestContext }));
      return { isAuthorized: false };
    }

    const result = await verifyGoogleAdminToken(token, {
      audience: adminEnv.googleWebClientId,
      hostedDomain: adminEnv.hostedDomain,
      verifier
    });

    if (!result.ok) {
      console.warn(JSON.stringify({ metric: "ADMIN_AUTH_DENIED", reason: result.reason, ...requestContext }));
      if (result.reason === "verification_failed") {
        console.warn(JSON.stringify({
          metric: "ADMIN_AUTH_VERIFICATION_FAILED",
          reason: result.reason,
          ...requestContext
        }));
      }
      return { isAuthorized: false };
    }

    console.info(JSON.stringify({
      metric: "ADMIN_AUTH_ALLOWED",
      subject: result.identity.subject,
      email: result.identity.email,
      ...requestContext
    }));

    return {
      isAuthorized: true,
      context: {
        subject: result.identity.subject,
        email: result.identity.email,
        hostedDomain: result.identity.hostedDomain,
        ...(result.identity.name ? { name: result.identity.name } : {}),
        ...(result.identity.pictureUrl ? { pictureUrl: result.identity.pictureUrl } : {})
      }
    };
  };
}

export const handler = wrapLambdaHandler(createAdminAuthorizer());
