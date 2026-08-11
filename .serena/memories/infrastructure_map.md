# Infrastructure map

- `infra/cdk/bin/app.ts` composes Platform, Certificate, Data, App, Edge, and Observability stacks.
- Platform owns account-level deployment support; Certificate owns ACM; Data owns the DynamoDB table.
- App consumes the API certificate, table, stage, and deploy-time vendor secrets to create Lambda/API resources.
- Edge consumes the landing certificate and built web assets to create CloudFront delivery.
- Observability consumes the distribution, HTTP API, and table for dashboards and alarms.
- CDK owns AWS resources only. OpenTofu owns Cloudflare records.
- OpenTofu modules separately own certificate validation, edge DNS, API DNS, SES DNS, Sentry DNS, and zone settings.
- Certificate flow: CDK emits ACM validation requirements, OpenTofu writes validation records, ACM issues, then CDK deploys Edge and OpenTofu points DNS to deployed targets.
- Serena indexes the TypeScript CDK code. Inspect OpenTofu `.tf` files with `rg` and focused file reads because the Serena Terraform backend requires HashiCorp Terraform, which this OpenTofu repository intentionally does not install.

Use mem:repository_map for workspace ownership. Follow the closest infrastructure `AGENTS.md` for rules.
