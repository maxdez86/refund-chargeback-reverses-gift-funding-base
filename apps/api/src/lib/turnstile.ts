import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getAppSecret } from "../services/secrets-manager/app-secrets";
import { getEnv } from "./env";
import { AppError } from "./errors";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 4_000;

type SiteverifyResponse = {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
};

/**
 * Verifies a Cloudflare Turnstile token attached to the incoming request.
 *
 * - In environments where APP_SECRET_ARN is unset (local dev, unit tests),
 *   this is a no-op so callers don't need to mock Cloudflare.
 * - When configured, the token MUST be present and validate, or the call
 *   throws AppError(403). Tokens are single-use; callers are expected to
 *   request a fresh one for each protected action.
 */
export async function verifyTurnstile(event: APIGatewayProxyEventV2) {
  const secretArn = getEnv().appSecretArn;

  if (!secretArn) {
    return;
  }

  const token = event.headers["x-turnstile-token"] ?? event.headers["X-Turnstile-Token"];

  if (!token) {
    throw new AppError("Verificação anti-bot ausente.", 403);
  }

  const secret = await getAppSecret("turnstileSecretKey");

  if (!secret) {
    throw new AppError("Verificação anti-bot indisponível.", 500);
  }

  const body = new URLSearchParams({ secret, response: token });
  const remoteIp = event.requestContext.http.sourceIp;
  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS);

  let parsed: SiteverifyResponse;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal
    });

    parsed = (await response.json()) as SiteverifyResponse;
  } catch (error) {
    console.error(
      JSON.stringify({
        metric: "TURNSTILE_VERIFY_ERROR",
        message: error instanceof Error ? error.message : "unknown"
      })
    );
    throw new AppError("Verificação anti-bot indisponível.", 503);
  } finally {
    clearTimeout(timeout);
  }

  if (!parsed.success) {
    console.error(
      JSON.stringify({
        metric: "TURNSTILE_VERIFY_REJECTED",
        errorCodes: parsed["error-codes"] ?? []
      })
    );
    throw new AppError("Verificação anti-bot falhou.", 403);
  }
}
