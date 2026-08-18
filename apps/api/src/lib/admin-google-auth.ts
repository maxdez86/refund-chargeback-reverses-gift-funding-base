import { OAuth2Client, type TokenPayload } from "google-auth-library";

export const GOOGLE_ID_TOKEN_ISSUER = "https://accounts.google.com";

export type AdminIdentity = {
  subject: string;
  email: string;
  hostedDomain: string;
  name?: string;
  pictureUrl?: string;
};

export type AdminVerificationFailureReason =
  | "expired"
  | "invalid_audience"
  | "invalid_email"
  | "invalid_hosted_domain"
  | "invalid_issuer"
  | "invalid_subject"
  | "verification_failed";

export type AdminVerificationResult =
  | { ok: true; identity: AdminIdentity }
  | { ok: false; reason: AdminVerificationFailureReason };

export type GoogleIdTokenVerifier = {
  verifyIdToken(options: {
    idToken: string;
    audience: string;
  }): Promise<{ getPayload(): TokenPayload | undefined }>;
};

const googleVerifier = new OAuth2Client();

export function parseBearerToken(authorization: string | undefined) {
  if (!authorization) return null;

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

export async function verifyGoogleAdminToken(
  idToken: string,
  options: {
    audience: string;
    hostedDomain: string;
    nowSeconds?: number;
    verifier?: GoogleIdTokenVerifier;
  }
): Promise<AdminVerificationResult> {
  let payload: TokenPayload | undefined;

  try {
    const ticket = await (options.verifier ?? googleVerifier).verifyIdToken({
      idToken,
      audience: options.audience
    });
    payload = ticket.getPayload();
  } catch {
    return { ok: false, reason: "verification_failed" };
  }

  if (!payload || payload.iss !== GOOGLE_ID_TOKEN_ISSUER) {
    return { ok: false, reason: "invalid_issuer" };
  }
  if (payload.aud !== options.audience) {
    return { ok: false, reason: "invalid_audience" };
  }
  if (typeof payload.exp !== "number" || payload.exp <= (options.nowSeconds ?? Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { ok: false, reason: "invalid_subject" };
  }
  if (
    payload.email_verified !== true ||
    typeof payload.email !== "string" ||
    payload.email.length === 0
  ) {
    return { ok: false, reason: "invalid_email" };
  }
  if (payload.hd !== options.hostedDomain) {
    return { ok: false, reason: "invalid_hosted_domain" };
  }

  return {
    ok: true,
    identity: {
      subject: payload.sub,
      email: payload.email,
      hostedDomain: payload.hd,
      ...(typeof payload.name === "string" && payload.name.trim().length > 0
        ? { name: payload.name }
        : {}),
      ...(isHttpUrl(payload.picture) ? { pictureUrl: payload.picture } : {})
    }
  };
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
