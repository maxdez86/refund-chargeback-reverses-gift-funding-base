import { createHmac, timingSafeEqual } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getEnv } from "./env";
import { AppError } from "./errors";
import { getAppSecret } from "../services/secrets-manager/app-secrets";

const LOOKUP_PROOF_TTL_MS = 30 * 60 * 1000;

type LookupProofPayload = {
  exp: number;
  invitationCode: string;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

async function getLookupProofSecret() {
  const secretArn = getEnv().appSecretArn;
  if (!secretArn) {
    throw new AppError("Verificação do convite indisponível.", 500);
  }

  const secret = await getAppSecret("lookupProofSecret");
  if (!secret) {
    throw new AppError("Verificação do convite indisponível.", 500);
  }

  return secret;
}

async function signPayload(encodedPayload: string) {
  const secret = await getLookupProofSecret();
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export async function issueLookupProof(invitationCode: string) {
  const payload: LookupProofPayload = {
    exp: Date.now() + LOOKUP_PROOF_TTL_MS,
    invitationCode
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await signPayload(encodedPayload);

  return {
    lookupProof: `${encodedPayload}.${signature}`,
    lookupProofExpiresAt: new Date(payload.exp).toISOString()
  };
}

export async function verifyLookupProof(
  event: APIGatewayProxyEventV2,
  invitationCode: string
) {
  const proof =
    event.headers["x-rsvp-lookup-proof"] ??
    event.headers["X-Rsvp-Lookup-Proof"];

  if (!proof) {
    throw new AppError("Verificação do convite ausente.", 403);
  }

  const [encodedPayload, signature] = proof.split(".");
  if (!encodedPayload || !signature) {
    throw new AppError("Verificação do convite inválida.", 403);
  }

  const expectedSignature = await signPayload(encodedPayload);
  const actualSignatureBuffer = Buffer.from(signature, "utf8");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    actualSignatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(actualSignatureBuffer, expectedSignatureBuffer)
  ) {
    throw new AppError("Verificação do convite inválida.", 403);
  }

  let payload: LookupProofPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as LookupProofPayload;
  } catch {
    throw new AppError("Verificação do convite inválida.", 403);
  }

  if (
    !payload ||
    typeof payload.exp !== "number" ||
    typeof payload.invitationCode !== "string"
  ) {
    throw new AppError("Verificação do convite inválida.", 403);
  }

  if (payload.exp <= Date.now()) {
    throw new AppError("Verificação do convite expirou. Localize o convite novamente.", 403);
  }

  if (payload.invitationCode !== invitationCode) {
    throw new AppError("Verificação do convite não corresponde ao RSVP.", 403);
  }
}
