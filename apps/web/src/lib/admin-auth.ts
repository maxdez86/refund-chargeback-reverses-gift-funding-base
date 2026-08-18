export type AppStage = "dev" | "prod";
export type AdminSessionMode = "fixture" | "live";

export type AdminRuntimeConfig = {
  stage: AppStage;
  googleClientId: string;
  hostedDomain: string;
  sessionMode: AdminSessionMode;
};

export type AdminTokenClaims = {
  subject: string;
  email: string;
  hostedDomain: string;
  expiresAtMs: number;
  name?: string;
  pictureUrl?: string;
};

export type CredentialValidation =
  | { ok: true; claims: AdminTokenClaims }
  | { ok: false; reason: "access-denied" | "expired" | "invalid"; message: string };

type PublicEnv = Record<string, string | boolean | undefined>;

export function getAdminRuntimeConfig(env: PublicEnv = import.meta.env): AdminRuntimeConfig {
  const stage = env.VITE_APP_STAGE;
  const sessionMode = env.VITE_ADMIN_SESSION_MODE;
  const googleClientId = env.VITE_GOOGLE_WEB_CLIENT_ID;
  const hostedDomain = env.VITE_ADMIN_GOOGLE_HOSTED_DOMAIN;

  if (stage !== "dev" && stage !== "prod") {
    throw new Error("VITE_APP_STAGE deve ser dev ou prod.");
  }
  if (sessionMode !== "fixture" && sessionMode !== "live") {
    throw new Error("VITE_ADMIN_SESSION_MODE deve ser fixture ou live.");
  }
  if (stage === "prod" && sessionMode === "fixture") {
    throw new Error("Dados de demonstração não podem ser usados em produção.");
  }
  if (typeof googleClientId !== "string" || googleClientId.trim() === "") {
    throw new Error("VITE_GOOGLE_WEB_CLIENT_ID não está configurado.");
  }
  if (hostedDomain !== "brimax.life") {
    throw new Error("VITE_ADMIN_GOOGLE_HOSTED_DOMAIN deve ser brimax.life.");
  }

  return { stage, sessionMode, googleClientId, hostedDomain };
}

export function validateGoogleCredential(
  credential: string,
  config: Pick<AdminRuntimeConfig, "googleClientId" | "hostedDomain">,
  nowMs = Date.now()
): CredentialValidation {
  const payload = decodeJwtPayload(credential);
  if (!payload) {
    return { ok: false, reason: "invalid", message: "A credencial do Google é inválida." };
  }

  if (payload.aud !== config.googleClientId || typeof payload.exp !== "number") {
    return { ok: false, reason: "invalid", message: "A credencial não pertence a este aplicativo." };
  }
  if (payload.exp * 1000 <= nowMs) {
    return { ok: false, reason: "expired", message: "Sua sessão do Google expirou. Entre novamente." };
  }
  if (
    payload.email_verified !== true ||
    payload.hd !== config.hostedDomain ||
    typeof payload.email !== "string"
  ) {
    return {
      ok: false,
      reason: "access-denied",
      message: `Use uma conta verificada do domínio ${config.hostedDomain}.`
    };
  }
  if (typeof payload.sub !== "string" || payload.sub === "") {
    return { ok: false, reason: "invalid", message: "A identidade do Google está incompleta." };
  }

  return {
    ok: true,
    claims: {
      subject: payload.sub,
      email: payload.email,
      hostedDomain: payload.hd,
      expiresAtMs: payload.exp * 1000,
      ...(typeof payload.name === "string" && payload.name ? { name: payload.name } : {}),
      ...(typeof payload.picture === "string" && payload.picture
        ? { pictureUrl: payload.picture }
        : {})
    }
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = atob(padded);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
