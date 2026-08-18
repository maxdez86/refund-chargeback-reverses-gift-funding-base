# Google Workspace administrator SSO

The administrative dashboard uses Google Identity Services in the browser and
an API Gateway HTTP API Lambda authorizer in AWS. The browser sends the Google
ID token as `Authorization: Bearer <google-id-token>`; the backend accepts only
verified members of the `brimax.life` Google Workspace hosted domain.

## Manual Google Cloud setup

Google Cloud configuration and real OAuth client IDs are intentionally not
created by this repository:

1. Configure the OAuth consent audience as **Internal** to the Brimax Workspace
   organization.
2. Create two separate OAuth 2.0 **Web application** clients. Never reuse one
   client across stages.
3. Configure the production client with the authorized JavaScript origin
   `https://brimax.life`. `https://www.brimax.life` redirects to the canonical
   host and only needs registration if it is changed to serve the dashboard.
4. Configure the development client with `https://dev.brimax.life`. Add
   `http://localhost:5173` and `http://127.0.0.1:5173` only when local dashboard
   development is required. Never add localhost to the production client.
5. Put the production client ID in `.env` and the development client ID in
   `.env.dev` as `GOOGLE_WEB_CLIENT_ID`. Keep
   `ADMIN_GOOGLE_HOSTED_DOMAIN=brimax.life` in both files.
6. Configure the same two public values as stage-specific GitHub Environment
   variables named `GOOGLE_WEB_CLIENT_ID` and
   `ADMIN_GOOGLE_HOSTED_DOMAIN` for `prod` and `dev`.

Do not commit either environment file. OAuth client IDs are public identifiers,
not passwords, so CDK passes the active value directly to the authorizer Lambda
environment rather than storing it in the JSON application secret.

## Stage isolation

The authorizer validates one exact audience: the client ID supplied by the
active stage. Production never accepts the development ID and development
never accepts the production ID. Both stages additionally require the exact
Google hosted-domain claim `hd=brimax.life`.

Use the repository wrappers so the correct environment file is loaded:

```bash
pnpm deploy:backend
BRIMAX_ENV_FILE=.env.dev pnpm deploy:backend
```

The backend deploy stops before CDK when either administrator configuration
value is missing. `scripts/landing-env.sh` also derives the matching public
Vite variables and rejects conflicting explicit frontend values.

## API behavior

Every `/admin/*` route uses the same cached Lambda authorizer. Missing or empty
`Authorization` identity sources are rejected by API Gateway with `401` before
Lambda runs. A supplied token that is malformed, expired, invalid, for the
wrong audience, or outside the Workspace policy is denied with `403`. Clients
must not depend on a finer 401/403 distinction from HTTP API Lambda authorizers.

Successful `GET /admin/session` responses follow
`AdminSessionResponseSchema` from `@brimax/contracts`. Identity is derived only
from verified authorizer context. Google `sub` is the stable identifier; email
is display and audit context.

Authorizer results are cached for 30 seconds by bearer token. Google account or
Workspace changes are not queried on every request, so an already issued token
can remain valid until its token expiry, with up to 30 additional seconds of
API Gateway cache reuse. Immediate directory revocation requires a separate
Google Admin SDK design.

Never log, paste, or persist Google ID tokens. Operational logs contain only
the request metadata, decision reason, and identity fields obtained after
successful cryptographic verification.
