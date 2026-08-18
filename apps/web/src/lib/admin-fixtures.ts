import type { AdminSessionResponse } from "@brimax/contracts";
import type { AdminTokenClaims } from "@/lib/admin-auth";

export function createFixtureAdminSession(claims: AdminTokenClaims): AdminSessionResponse {
  return {
    authenticated: true,
    stage: "dev",
    admin: {
      subject: claims.subject,
      email: claims.email,
      hostedDomain: "brimax.life",
      ...(claims.name ? { name: claims.name } : {}),
      ...(claims.pictureUrl ? { pictureUrl: claims.pictureUrl } : {})
    }
  };
}
