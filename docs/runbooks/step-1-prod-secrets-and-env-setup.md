# Step 1 Runbook: Production Secrets & Environment Configuration

This runbook guides the configuration and verification of all production secrets, OAuth client credentials, and environment variables required by PR #165 (v2.0.0).

---

## 1. Overview of Required Environment Variables

When deploying the production backend (`pnpm deploy:backend`), CDK populates AWS Secrets Manager and Lambda environment variables from the `.env` file loaded by [`scripts/landing-env.sh`](file:///home/maxreis86/consulting/brimax-life/scripts/landing-env.sh).

| Category | Variable / Secret Name | Required Value / Description | Destination |
|---|---|---|---|
| **Core** | `STAGE` | `prod` | Runtime & Stacks |
| | `AWS_PROFILE` | `personal-stg` | AWS CLI & CDK |
| | `AWS_REGION` | `us-east-1` | AWS Region |
| **WhatsApp Cloud API** | `WHATSAPP_ACCESS_TOKEN` | System User Permanent Token with `whatsapp_business_messaging` | AWS Secrets Manager (`whatsappAccessToken`) |
| | `WHATSAPP_APP_SECRET` | App Secret from Meta App Dashboard (used for webhook HMAC verification) | AWS Secrets Manager (`whatsappAppSecret`) |
| | `WHATSAPP_PHONE_NUMBER_ID` | Numeric Phone Number ID for the production WhatsApp WABA number | Lambda Environment |
| | `WHATSAPP_VERIFY_TOKEN` | Secret string shared with Meta Webhook configuration for `hub.verify_token` challenge | AWS Secrets Manager (`whatsappVerifyToken`) |
| **Google Workspace SSO** | `GOOGLE_WEB_CLIENT_ID` | OAuth 2.0 Web Client ID from Google Cloud Console | Lambda Environment |
| | `ADMIN_GOOGLE_HOSTED_DOMAIN` | `brimax.life` (Hard-pinned by contract) | Lambda Environment |
| **Frontend Admin Config** | `VITE_GOOGLE_WEB_CLIENT_ID` | Same as `GOOGLE_WEB_CLIENT_ID` | Frontend Build Env |
| | `VITE_ADMIN_GOOGLE_HOSTED_DOMAIN` | `brimax.life` | Frontend Build Env |
| | `VITE_ADMIN_SESSION_MODE` | `live` (Never set to `fixture` in production) | Frontend Build Env |
| **Payments & Edge** | `ASAAS_API_KEY` | Production Asaas API Key | AWS Secrets Manager (`asaasApiKey`) |
| | `ASAAS_WEBHOOK_TOKEN` | Production Asaas Webhook Token | AWS Secrets Manager (`asaasWebhookToken`) |
| | `TURNSTILE_SECRET_KEY` | Production Cloudflare Turnstile Secret Key | AWS Secrets Manager (`turnstileSecretKey`) |
| | `TURNSTILE_SITE_KEY` | Production Cloudflare Turnstile Site Key | Frontend Build Env |
| | `SENTRY_DSN` | Backend Sentry DSN (from OpenTofu Sentry module) | Lambda Environment |
| | `OBSERVABILITY_ALERT_EMAIL` | Production alert email destination | SNS Topic Subscription |

---

## 2. Setting Up Meta WhatsApp Cloud API Credentials

1. **Permanent Access Token:**
   - In Meta Business Manager, create or verify a **System User** with Admin permissions.
   - Assign the System User to the WhatsApp Business Account with `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
   - Generate a permanent System User token and assign it to `WHATSAPP_ACCESS_TOKEN`.
2. **App Secret:**
   - In Meta Developer Dashboard (`developers.facebook.com`), open your App Settings > Basic.
   - Copy the **App Secret** to `WHATSAPP_APP_SECRET`.
3. **Phone Number ID:**
   - In the WhatsApp Business Account dashboard, navigate to API Setup > Step 1.
   - Copy the **Phone number ID** (numeric ID) to `WHATSAPP_PHONE_NUMBER_ID`.
4. **Webhook Verify Token:**
   - Generate a random 32+ character string (e.g. `openssl rand -hex 24`).
   - Assign it to `WHATSAPP_VERIFY_TOKEN` in `.env`.
   - Configure Meta Webhooks for WhatsApp:
     - Callback URL: `https://api.brimax.life/webhooks/whatsapp`
     - Verify Token: The same string chosen above.
     - Webhook Subscription Fields: `messages`.

---

## 3. Setting Up Google Workspace Admin SSO

1. **Google Cloud OAuth 2.0 Credentials:**
   - In Google Cloud Console, navigate to **APIs & Services > Credentials**.
   - Select or create the OAuth 2.0 Client ID (Application type: **Web application**).
   - Authorized JavaScript origins:
     - `https://brimax.life`
     - `https://www.brimax.life`
   - Copy the Client ID (e.g. `1234567890-abcdef.apps.googleusercontent.com`) to `GOOGLE_WEB_CLIENT_ID` and `VITE_GOOGLE_WEB_CLIENT_ID`.
2. **Hosted Domain Enforcement:**
   - Ensure `ADMIN_GOOGLE_HOSTED_DOMAIN=brimax.life` and `VITE_ADMIN_GOOGLE_HOSTED_DOMAIN=brimax.life`.

---

## 4. Pre-Deployment Validation Checklist

Run the following checks locally before executing `pnpm deploy:backend`:

```bash
# 1. Source production environment
set -a
source .env
set +a

# 2. Validate environment file integrity
bash scripts/validate-github-env-file.sh .env full-stage prod

# 3. Test CDK synthesis with production credentials
pnpm synth
```

> [!CAUTION]
> Never commit real production secrets into Git. Keep `.env` gitignored and distribute credentials securely.
