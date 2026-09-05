import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AppStack } from "../lib/stacks/app-stack";
import { DataStack } from "../lib/stacks/data-stack";
import { applyCostAllocationTags } from "./support/tags";

describe("AppStack", () => {
  it("creates the payment API, webhook queue, secrets, and Lambda handlers", { timeout: 60000 }, () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "dev");
    const dataStack = new DataStack(app, "AppDataStack", {
      stage: "dev"
    });
    const stack = new AppStack(app, "PaymentAppStack", {
      adminGoogleHostedDomain: "brimax.life",
      apiCertificate: acm.Certificate.fromCertificateArn(
        app,
        "ImportedApiCertificate",
        "arn:aws:acm:us-east-1:123456789012:certificate/test-api"
      ),
      apiDomain: "api.dev.brimax.life",
      asaasApiKey: "asaas-api-key-test",
      asaasWebhookToken: "asaas-webhook-token-test",
      contactEmail: "casamento-dev@brimax.life",
      googleWebClientId: "dev-client.apps.googleusercontent.com",
      rootDomain: "dev.brimax.life",
      sentryDsn: "https://public@example.ingest.sentry.io/123456",
      stage: "dev",
      table: dataStack.table,
      turnstileSecretKey: "1x0000000000000000000000000000000AA",
      whatsappAccessToken: "whatsapp-access-token-test",
      whatsappAppSecret: "whatsapp-app-secret-test",
      whatsappPhoneNumberId: "123456789",
      whatsappVerifyToken: "whatsapp-verify-token-test",
      wwwDomain: "www.dev.brimax.life",
      xrayEnabled: true
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.resourceCountIs("AWS::ApiGatewayV2::DomainName", 1);
    // webhook, checkout-expiry, guest-message notification, and WhatsApp RSVP
    // queues each have a primary queue and DLQ.
    template.resourceCountIs("AWS::SQS::Queue", 10);
    template.hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 120,
      RedrivePolicy: {
        deadLetterTargetArn: Match.anyValue(),
        maxReceiveCount: 5
      }
    });
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      BatchSize: 5
    });
    template.resourceCountIs("AWS::SecretsManager::Secret", 1);
    template.resourceCountIs("AWS::SES::EmailIdentity", 0);
    template.resourceCountIs("AWS::SES::ConfigurationSet", 1);
    template.resourceCountIs("AWS::SES::ConfigurationSetEventDestination", 1);
    template.resourceCountIs("Custom::LogRetention", 0);

    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /payments"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /payments/{paymentId}"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /payments/{paymentId}/discard"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /gifts"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /guest-messages"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /guest-messages"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /admin/session",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /admin/dashboard",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "DELETE /admin/guest-messages/{messageId}",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "PATCH /admin/invitations/{invitationCode}/guests/{guestId}",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /admin/invitations/{invitationCode}/confirm-all",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /admin/invitations",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /admin/invitations/next-code",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "DELETE /admin/invitations/{invitationCode}",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /admin/invitations/{invitationCode}/guests",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "DELETE /admin/invitations/{invitationCode}/guests/{guestId}",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /payments/{paymentId}/message"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /webhooks/asaas"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /webhooks/whatsapp"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /webhooks/whatsapp"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /admin/whatsapp/messages",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /admin/whatsapp/invitations/{invitationCode}/send-rsvp",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /admin/whatsapp/invitations/{invitationCode}/messages",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /admin/whatsapp/invitations/{invitationCode}",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /admin/whatsapp/messages/{commandId}",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "PUT /admin/whatsapp/invitations/{invitationCode}/phone",
      AuthorizationType: "CUSTOM",
      AuthorizerId: Match.anyValue()
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerPayloadFormatVersion: "2.0",
      AuthorizerResultTtlInSeconds: 30,
      AuthorizerType: "REQUEST",
      EnableSimpleResponses: true,
      IdentitySource: ["$request.header.Authorization"],
      Name: "dev-brimax-google-admin-authorizer"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: {
        AllowHeaders: [
          "authorization",
          "content-type",
          "idempotency-key",
          "x-turnstile-token",
          "x-rsvp-lookup-proof"
        ],
        AllowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        AllowOrigins: ["https://dev.brimax.life", "https://www.dev.brimax.life"],
        MaxAge: 600
      }
    });
    for (const [, metricName] of [
      ['"WHATSAPP_RSVP_SEND"', "whatsapp-rsvp-send-dev"],
      ['"WHATSAPP_RSVP_SEND_FAILURE"', "whatsapp-rsvp-send-failure-dev"],
      ['"WHATSAPP_RSVP_WORKER_OUTCOME"', "whatsapp-rsvp-worker-outcome-dev"],
      ['"WHATSAPP_RSVP_WORKER_RECONCILIATION_REQUIRED"', "whatsapp-rsvp-reconciliation-required-dev"],
      ['"WHATSAPP_RSVP_BRANCH"', "whatsapp-rsvp-branch-dev"],
      ['"WHATSAPP_RSVP_INBOUND_CORRELATION"', "whatsapp-rsvp-inbound-correlation-dev"],
      ['"WHATSAPP_WEBHOOK_WORKER_OUTCOME"', "whatsapp-webhook-worker-outcome-dev"],
      ['"WHATSAPP_OPERATOR_TEXT_SEND"', "whatsapp-operator-text-send-dev"]
    ] as const) {
      template.hasResourceProperties("AWS::Logs::MetricFilter", {
        MetricTransformations: Match.arrayWith([Match.objectLike({ MetricName: metricName, MetricNamespace: "Brimax/Payments" })])
      });
    }
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "api.dev.brimax.life",
      Tags: {
        project: "brimax-life",
        stage: "dev"
      }
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      Tags: {
        project: "brimax-life",
        stage: "dev"
      }
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::ApiMapping", {
      Stage: "$default"
    });
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "/dev/brimax/app-secrets",
      GenerateSecretString: Match.objectLike({
        ExcludePunctuation: true,
        GenerateStringKey: "lookupProofSecret",
        SecretStringTemplate: Match.serializedJson({
          asaasApiKey: "asaas-api-key-test",
          asaasWebhookToken: "asaas-webhook-token-test",
          turnstileSecretKey: "1x0000000000000000000000000000000AA",
          whatsappAccessToken: "whatsapp-access-token-test",
          whatsappAppSecret: "whatsapp-app-secret-test",
          whatsappVerifyToken: "whatsapp-verify-token-test"
        })
      })
    });
    template.hasOutput("WhatsAppWebhookUrl", {
      Value: "https://api.dev.brimax.life/webhooks/whatsapp"
    });
    template.hasOutput("WhatsappQueueUrl", {
      Value: Match.anyValue()
    });
    // Non-prod secret is disposable for clean pre-launch teardown.
    template.hasResource("AWS::SecretsManager::Secret", {
      DeletionPolicy: "Delete"
    });
    template.hasResourceProperties("AWS::SES::ConfigurationSet", {
      Name: "brimax-dev-transactional",
      ReputationOptions: {
        ReputationMetricsEnabled: true
      },
      DeliveryOptions: {
        TlsPolicy: "REQUIRE"
      },
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
    });
    template.hasResourceProperties("AWS::SES::ConfigurationSetEventDestination", {
      EventDestination: {
        CloudWatchDestination: {
          DimensionConfigurations: Match.arrayWith([
            Match.objectLike({
              DefaultDimensionValue: Match.anyValue(),
              DimensionName: "ses:configuration-set",
              DimensionValueSource: "messageTag"
            })
          ])
        },
        Enabled: true,
        MatchingEventTypes: ["delivery", "bounce", "complaint"]
      }
    });

    // Keep-warm: 9 guest-facing functions chunked into 2 rules (≤5 targets each),
    // plus the checkout-expiry schedule => 3 EventBridge rules.
    template.resourceCountIs("AWS::Events::Rule", 3);
    template.hasResourceProperties("AWS::Events::Rule", {
      Name: "dev-brimax-keep-warm-0",
      ScheduleExpression: "rate(4 minutes)",
      Targets: Match.arrayWith([
        Match.objectLike({
          Input: "{\"warmer\":true}",
          RetryPolicy: {
            MaximumRetryAttempts: 0
          }
        })
      ])
    });
    template.hasResourceProperties("AWS::Events::Rule", {
      Name: "dev-brimax-keep-warm-1",
      ScheduleExpression: "rate(4 minutes)"
    });
    // Checkout-expiry correctness floor: every minute, feeding the SAME queue the
    // GET /gifts trigger uses (target is the queue ARN, with a JSON Input).
    template.hasResourceProperties("AWS::Events::Rule", {
      Name: "dev-brimax-checkout-expiry-schedule",
      ScheduleExpression: "rate(1 minute)",
      Targets: Match.arrayWith([
        Match.objectLike({
          Arn: Match.anyValue(),
          Input: "{\"source\":\"schedule\"}"
        })
      ])
    });
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com"
    });

    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '"PAYMENT_CREATE_FAILED"',
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricNamespace: "Brimax/Payments"
        })
      ])
    });
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '"WEBHOOK_PAYMENT_NOT_FOUND"',
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricName: "asaas-webhook-processor-webhook-payment-not-found-dev",
          MetricNamespace: "Brimax/Payments"
        })
      ])
    });
    // The sweep failure metric now lives on the worker log group, not GET /gifts.
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern:
        '{ $.stage = "dev" && ($.metric = "CHECKOUT_EXPIRY_SWEEP_FAILED" || $.metric = "CHECKOUT_EXPIRY_SWEEP_ITEM_FAILED") }',
      LogGroupName: {
        Ref: Match.stringLikeRegexp("^CheckoutExpiryWorkerFunctionLogGroup")
      },
      MetricTransformations: [
        {
          Dimensions: [
            {
              Key: "Stage",
              Value: "$.stage"
            }
          ],
          MetricName: "checkout-expiry-worker-sweep-failed",
          MetricNamespace: "Brimax/Payments",
          MetricValue: "1"
        }
      ]
    });
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '"CHECKOUT_EXPIRY_PROTECTED_STALE"',
      LogGroupName: {
        Ref: Match.stringLikeRegexp("^CheckoutExpiryWorkerFunctionLogGroup")
      },
      MetricTransformations: [
        {
          MetricName: "checkout-expiry-protected-stale",
          MetricNamespace: "Brimax/Payments",
          MetricValue: "1"
        }
      ]
    });
    // The enqueue-failure metric stays on the GET /gifts log group.
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '"CHECKOUT_EXPIRY_TRIGGER_ENQUEUE_FAILED"',
      LogGroupName: {
        Ref: Match.stringLikeRegexp("^GetGiftsFunctionLogGroup")
      },
      MetricTransformations: [
        {
          MetricName: "checkout-expiry-trigger-enqueue-failed",
          MetricNamespace: "Brimax/Payments",
          MetricValue: "1"
        }
      ]
    });
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '?"WHATSAPP_WEBHOOK_AUTH_FAILED" ?"WHATSAPP_WEBHOOK_VERIFY_FAILED"',
      LogGroupName: {
        Ref: Match.stringLikeRegexp("^WhatsAppWebhookFunctionLogGroup")
      },
      MetricTransformations: [
        {
          MetricName: "whatsapp-webhook-auth-failed-dev",
          MetricNamespace: "Brimax/Payments",
          MetricValue: "1"
        }
      ]
    });
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '"ADMIN_AUTH_DENIED"',
      MetricTransformations: [
        {
          MetricName: "admin-auth-denied-dev",
          MetricNamespace: "Brimax/Admin",
          MetricValue: "1"
        }
      ]
    });
    // The checkout-expiry worker consumes its queue with batchSize 1 and a
    // maxConcurrency floor of 2 (NOT reserved concurrency).
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 1,
      ScalingConfig: {
        MaximumConcurrency: 2
      }
    });
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 5,
      ScalingConfig: { MaximumConcurrency: 2 },
      FunctionResponseTypes: ["ReportBatchItemFailures"]
    });
    // The Asaas webhook processor reports per-record failures, so one poison
    // message cannot redeliver the nine siblings that already succeeded.
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 10,
      FunctionResponseTypes: ["ReportBatchItemFailures"]
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      MemorySize: 1024,
      Runtime: "nodejs24.x",
      TracingConfig: {
        Mode: "Active"
      },
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      MemorySize: 512,
      Runtime: "nodejs24.x",
      TracingConfig: {
        Mode: "Active"
      },
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: Match.stringLikeRegexp("^/aws/lambda/"),
      RetentionInDays: 365,
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
    });
    template.hasResourceProperties("AWS::SQS::Queue", {
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
    });
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      AccessLogSettings: Match.objectLike({
        DestinationArn: Match.anyValue(),
        Format: Match.anyValue()
      }),
      Tags: {
        project: "brimax-life",
        stage: "dev"
      }
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          ALLOWED_ORIGINS: "https://dev.brimax.life,https://www.dev.brimax.life",
          CONTACT_EMAIL: "casamento-dev@brimax.life",
          EMAIL_FROM: "Casamento Brimax <casamento-dev@brimax.life>",
          EMAIL_CONFIGURATION_SET_NAME: Match.anyValue(),
          APP_SECRET_ARN: Match.anyValue(),
          HOSTED_CHECKOUT_SUCCESS_URL: "https://dev.brimax.life",
          PAYMENTS_SITE_BASE_URL: "https://dev.brimax.life",
          SENTRY_DSN: "https://public@example.ingest.sentry.io/123456",
          SITE_BASE_URL: "https://dev.brimax.life",
          XRAY_ENABLED: "true",
          RSVP_NOTIFICATION_TO: "casamento-dev@brimax.life",
          WHATSAPP_PHONE_NUMBER_ID: "123456789"
        })
      }
    });
    template.hasResourceProperties("AWS::IAM::Role", {
      ManagedPolicyArns: Match.arrayWith([
        {
          "Fn::Join": Match.arrayWith([
            "",
            Match.arrayWith([
              "arn:",
              { Ref: "AWS::Partition" },
              ":iam::aws:policy/AWSXRayDaemonWriteAccess"
            ])
          ])
        }
      ])
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["ses:SendEmail", "ses:SendRawEmail"]),
            Effect: "Allow",
            Resource: "*"
          })
        ])
      }
    });

    const resources = template.toJSON().Resources as Record<
      string,
      { Properties?: Record<string, unknown>; Type: string }
    >;
    const adminRoutes = Object.values(resources).filter(
      (resource) =>
        resource.Type === "AWS::ApiGatewayV2::Route" &&
        String(resource.Properties?.RouteKey).includes(" /admin/")
    );
    expect(adminRoutes).toHaveLength(16);
    const adminAuthorizerIds = new Set(
      adminRoutes.map((route) => JSON.stringify(route.Properties?.AuthorizerId))
    );
    expect(adminAuthorizerIds.size).toBe(1);
    for (const route of adminRoutes) {
      expect(route.Properties).toMatchObject({ AuthorizationType: "CUSTOM" });
      expect(route.Properties).toHaveProperty("AuthorizerId");
    }
    expect(JSON.stringify(adminRoutes)).not.toContain("AWS_IAM");

    const webhookRoutes = Object.values(resources).filter(
      (resource) =>
        resource.Type === "AWS::ApiGatewayV2::Route" &&
        String(resource.Properties?.RouteKey).includes(" /webhooks/")
    );
    expect(webhookRoutes).toHaveLength(3);
    for (const route of webhookRoutes) {
      expect(route.Properties).not.toHaveProperty("AuthorizerId");
      expect(route.Properties?.AuthorizationType ?? "NONE").toBe("NONE");
    }

    const adminAuthorizerFunctionEntry = Object.entries(resources).find(
      ([logicalId, resource]) =>
        logicalId.startsWith("AdminAuthorizerFunction") &&
        resource.Type === "AWS::Lambda::Function"
    );
    expect(adminAuthorizerFunctionEntry).toBeDefined();
    expect(adminAuthorizerFunctionEntry?.[1].Properties).toMatchObject({
      MemorySize: 256,
      Timeout: 10,
      Environment: {
        Variables: {
          ADMIN_GOOGLE_HOSTED_DOMAIN: "brimax.life",
          GOOGLE_WEB_CLIENT_ID: "dev-client.apps.googleusercontent.com",
          STAGE: "dev"
        }
      }
    });
    const adminAuthorizerRoleLogicalId = (
      adminAuthorizerFunctionEntry?.[1].Properties?.Role as { "Fn::GetAtt": [string, string] }
    )["Fn::GetAtt"][0];
    const adminAuthorizerPolicies = Object.values(resources).filter(
      (resource) =>
        resource.Type === "AWS::IAM::Policy" &&
        JSON.stringify(resource.Properties?.Roles).includes(adminAuthorizerRoleLogicalId)
    );
    const adminAuthorizerPolicyJson = JSON.stringify(adminAuthorizerPolicies);
    expect(adminAuthorizerPolicyJson).not.toMatch(/dynamodb|secretsmanager|sqs|ses:/i);
    const adminDashboardFunctionEntry = Object.entries(resources).find(
      ([logicalId, resource]) =>
        logicalId.startsWith("AdminDashboardFunction") &&
        resource.Type === "AWS::Lambda::Function"
    );
    expect(adminDashboardFunctionEntry).toBeDefined();
    expect(adminDashboardFunctionEntry?.[1].Properties).toMatchObject({
      Handler: "index.handler",
      Runtime: "nodejs24.x",
      Timeout: 10,
      Environment: {
        Variables: expect.objectContaining({
          ALLOWED_ORIGINS: "https://dev.brimax.life,https://www.dev.brimax.life",
          STAGE: "dev",
          WEDDING_TABLE_NAME: expect.anything()
        })
      }
    });
    expect(stack.alarmedFunctions.map((fn) => fn.node.id)).toContain("AdminDashboardFunction");
    expect(stack.applicationLogGroups.map((group) => group.node.id)).toContain(
      "AdminDashboardFunctionLogGroup"
    );

    const adminDashboardRoleLogicalId = (
      adminDashboardFunctionEntry?.[1].Properties?.Role as { "Fn::GetAtt": [string, string] }
    )["Fn::GetAtt"][0];
    const adminDashboardPolicies = Object.values(resources).filter(
      (resource) =>
        resource.Type === "AWS::IAM::Policy" &&
        JSON.stringify(resource.Properties?.Roles).includes(adminDashboardRoleLogicalId)
    );
    const adminDashboardPolicyJson = JSON.stringify(adminDashboardPolicies);
    expect(adminDashboardPolicyJson).toContain("dynamodb:GetItem");
    expect(adminDashboardPolicyJson).toContain("dynamodb:Scan");
    expect(adminDashboardPolicyJson).not.toMatch(
      /dynamodb:(?:BatchWriteItem|DeleteItem|PutItem|UpdateItem)/
    );
    expect(adminDashboardPolicyJson).not.toMatch(/secretsmanager|sqs:|ses:/i);

    const adminDashboardRouteEntry = Object.entries(resources).find(
      ([, resource]) =>
        resource.Type === "AWS::ApiGatewayV2::Route" &&
        resource.Properties?.RouteKey === "GET /admin/dashboard"
    );
    const adminDashboardRouteEntries = Object.entries(resources).filter(
      ([, resource]) =>
        resource.Type === "AWS::ApiGatewayV2::Route" &&
        resource.Properties?.RouteKey === "GET /admin/dashboard"
    );
    expect(adminDashboardRouteEntries).toHaveLength(1);
    const adminDashboardIntegrationEntry = Object.entries(resources).find(
      ([, resource]) =>
        resource.Type === "AWS::ApiGatewayV2::Integration" &&
        JSON.stringify(resource.Properties?.IntegrationUri).includes(
          adminDashboardFunctionEntry?.[0] ?? "missing-function"
        )
    );
    expect(adminDashboardIntegrationEntry).toBeDefined();
    expect(JSON.stringify(adminDashboardRouteEntry?.[1].Properties?.Target)).toContain(
      adminDashboardIntegrationEntry?.[0]
    );
    const defaultStageEntry = Object.entries(resources).find(
      ([, resource]) => resource.Type === "AWS::ApiGatewayV2::Stage"
    );
    expect(adminDashboardRouteEntry).toBeDefined();
    expect(
      (defaultStageEntry?.[1] as { DependsOn?: string[] } | undefined)?.DependsOn
    ).toContain(adminDashboardRouteEntry?.[0]);
    const getGiftsFunctionEntry = Object.entries(resources).find(
      ([logicalId, resource]) =>
        logicalId.startsWith("GetGiftsFunction") && resource.Type === "AWS::Lambda::Function"
    );
    expect(getGiftsFunctionEntry).toBeDefined();

    const discardPaymentFunctionEntry = Object.entries(resources).find(
      ([logicalId, resource]) =>
        logicalId.startsWith("DiscardPaymentFunction") &&
        resource.Type === "AWS::Lambda::Function"
    );
    expect(discardPaymentFunctionEntry).toBeDefined();

    const discardPaymentRoleLogicalId = (
      discardPaymentFunctionEntry?.[1].Properties?.Role as {
        "Fn::GetAtt": [string, string];
      }
    )["Fn::GetAtt"][0];
    const discardPaymentPolicy = Object.values(resources).find(
      (resource) =>
        resource.Type === "AWS::IAM::Policy" &&
        JSON.stringify(resource.Properties?.Roles).includes(discardPaymentRoleLogicalId)
    );
    expect(discardPaymentPolicy).toBeDefined();

    const discardPaymentPolicyJson = JSON.stringify(
      discardPaymentPolicy?.Properties?.PolicyDocument
    );
    expect(discardPaymentPolicyJson).toContain("dynamodb:GetItem");
    expect(discardPaymentPolicyJson).toContain("dynamodb:UpdateItem");
    expect(discardPaymentPolicyJson).toContain("dynamodb:ConditionCheckItem");
    expect(discardPaymentPolicyJson).toContain("secretsmanager:GetSecretValue");
    expect(discardPaymentPolicyJson).not.toContain("dynamodb:Scan");
    expect(discardPaymentPolicyJson).not.toContain("dynamodb:PutItem");
    expect(discardPaymentPolicyJson).not.toContain("/index/*");
    expect(discardPaymentPolicyJson).not.toContain("sqs:");
    expect(discardPaymentPolicyJson).not.toContain("ses:");

    const getGiftsRoleLogicalId = (
      getGiftsFunctionEntry?.[1].Properties?.Role as { "Fn::GetAtt": [string, string] }
    )["Fn::GetAtt"][0];
    const getGiftsPolicy = Object.values(resources).find(
      (resource) =>
        resource.Type === "AWS::IAM::Policy" &&
        JSON.stringify(resource.Properties?.Roles).includes(getGiftsRoleLogicalId)
    );
    expect(getGiftsPolicy).toBeDefined();

    const getGiftsPolicyStatements = (
      getGiftsPolicy?.Properties?.PolicyDocument as {
        Statement: Array<{ Action: string | string[]; Resource: unknown }>;
      }
    ).Statement;
    const getGiftsPolicyActions = getGiftsPolicyStatements.flatMap((statement) =>
      Array.isArray(statement.Action) ? statement.Action : [statement.Action]
    );

    // GET /gifts is now read-only on the table (batch read) + send-only on the
    // expiry queue. It must NOT carry any table write permission.
    expect(getGiftsPolicyActions).toEqual(
      expect.arrayContaining([
        "dynamodb:BatchGetItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "sqs:SendMessage"
      ])
    );
    expect(getGiftsPolicyActions).not.toContain("dynamodb:UpdateItem");
    expect(getGiftsPolicyActions).not.toContain("dynamodb:PutItem");
    expect(getGiftsPolicyActions).not.toContain("dynamodb:DeleteItem");
    expect(getGiftsPolicyActions).not.toContain("dynamodb:BatchWriteItem");

    const readStatement = getGiftsPolicyStatements.find((statement) =>
      (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes(
        "dynamodb:Query"
      )
    );
    expect(JSON.stringify(readStatement?.Resource)).toContain("/index/*");

    // The checkout-expiry worker holds full read/write on the table (it runs the
    // expiry TransactWriteItems) plus consume on its queue.
    const workerFunctionEntry = Object.entries(resources).find(
      ([logicalId, resource]) =>
        logicalId.startsWith("CheckoutExpiryWorkerFunction") &&
        resource.Type === "AWS::Lambda::Function"
    );
    expect(workerFunctionEntry).toBeDefined();
    expect(workerFunctionEntry?.[1].Properties?.MemorySize).toBe(512);
    expect(workerFunctionEntry?.[1].Properties?.Timeout).toBe(60);

    const workerRoleLogicalId = (
      workerFunctionEntry?.[1].Properties?.Role as { "Fn::GetAtt": [string, string] }
    )["Fn::GetAtt"][0];
    const workerPolicy = Object.values(resources).find(
      (resource) =>
        resource.Type === "AWS::IAM::Policy" &&
        JSON.stringify(resource.Properties?.Roles).includes(workerRoleLogicalId)
    );
    const workerPolicyJson = JSON.stringify(workerPolicy?.Properties?.PolicyDocument);
    expect(workerPolicyJson).toContain("dynamodb:UpdateItem");
    expect(workerPolicyJson).toContain("dynamodb:PutItem");
    expect(workerPolicyJson).toContain("dynamodb:DeleteItem");
    expect(workerPolicyJson).toContain("sqs:ReceiveMessage");

    const webhookProcessorFunctionEntry = Object.entries(resources).find(
      ([logicalId, resource]) =>
        logicalId.startsWith("AsaasWebhookProcessorFunction") &&
        resource.Type === "AWS::Lambda::Function"
    );
    expect(webhookProcessorFunctionEntry).toBeDefined();
    expect(webhookProcessorFunctionEntry?.[1].Properties?.MemorySize).toBe(256);
    expect(webhookProcessorFunctionEntry?.[1].Properties?.Timeout).toBe(30);

    // The guest-message create handler enqueues the notification (send-only on
    // the notification queue) and no longer holds SES send — that moved to the
    // async notify worker.
    const createGuestMessagesEntry = Object.entries(resources).find(
      ([logicalId, resource]) =>
        logicalId.startsWith("CreateGuestMessagesFunction") &&
        resource.Type === "AWS::Lambda::Function"
    );
    expect(createGuestMessagesEntry).toBeDefined();
    const createGuestMessagesRoleLogicalId = (
      createGuestMessagesEntry?.[1].Properties?.Role as { "Fn::GetAtt": [string, string] }
    )["Fn::GetAtt"][0];
    const createGuestMessagesPolicy = Object.values(resources).find(
      (resource) =>
        resource.Type === "AWS::IAM::Policy" &&
        JSON.stringify(resource.Properties?.Roles).includes(createGuestMessagesRoleLogicalId)
    );
    const createGuestMessagesPolicyJson = JSON.stringify(
      createGuestMessagesPolicy?.Properties?.PolicyDocument
    );
    expect(createGuestMessagesPolicyJson).toContain("sqs:SendMessage");
    expect(createGuestMessagesPolicyJson).not.toContain("ses:");

    // The notify worker consumes the notification queue and owns the SES send.
    const notifyFunctionEntry = Object.entries(resources).find(
      ([logicalId, resource]) =>
        logicalId.startsWith("GuestMessageNotifyFunction") &&
        resource.Type === "AWS::Lambda::Function"
    );
    expect(notifyFunctionEntry).toBeDefined();
    const notifyRoleLogicalId = (
      notifyFunctionEntry?.[1].Properties?.Role as { "Fn::GetAtt": [string, string] }
    )["Fn::GetAtt"][0];
    const notifyPolicy = Object.values(resources).find(
      (resource) =>
        resource.Type === "AWS::IAM::Policy" &&
        JSON.stringify(resource.Properties?.Roles).includes(notifyRoleLogicalId)
    );
    const notifyPolicyJson = JSON.stringify(notifyPolicy?.Properties?.PolicyDocument);
    expect(notifyPolicyJson).toContain("ses:SendEmail");
    expect(notifyPolicyJson).toContain("sqs:ReceiveMessage");

    // The WhatsApp webhook worker consumes the webhook queue and enqueues automated replies to the RSVP queue.
    const whatsappWebhookWorkerEntry = Object.entries(resources).find(
      ([logicalId, resource]) =>
        logicalId.startsWith("WhatsappWebhookWorkerFunction") &&
        resource.Type === "AWS::Lambda::Function"
    );
    expect(whatsappWebhookWorkerEntry).toBeDefined();
    const whatsappWebhookWorkerRoleLogicalId = (
      whatsappWebhookWorkerEntry?.[1].Properties?.Role as { "Fn::GetAtt": [string, string] }
    )["Fn::GetAtt"][0];
    const whatsappWebhookWorkerPolicy = Object.values(resources).find(
      (resource) =>
        resource.Type === "AWS::IAM::Policy" &&
        JSON.stringify(resource.Properties?.Roles).includes(whatsappWebhookWorkerRoleLogicalId)
    );
    const whatsappWebhookWorkerPolicyJson = JSON.stringify(
      whatsappWebhookWorkerPolicy?.Properties?.PolicyDocument
    );
    expect(whatsappWebhookWorkerPolicyJson).toContain("sqs:ReceiveMessage");
    expect(whatsappWebhookWorkerPolicyJson).toContain("sqs:SendMessage");

    const rsvpFunctionEntry = Object.entries(resources).find(
      ([logicalId, resource]) =>
        logicalId.startsWith("RsvpFunction") && resource.Type === "AWS::Lambda::Function"
    );
    expect(rsvpFunctionEntry).toBeDefined();
    const rsvpRoleLogicalId = (
      rsvpFunctionEntry?.[1].Properties?.Role as { "Fn::GetAtt": [string, string] }
    )["Fn::GetAtt"][0];
    const rsvpPolicy = Object.values(resources).find(
      (resource) => resource.Type === "AWS::IAM::Policy" &&
        JSON.stringify(resource.Properties?.Roles).includes(rsvpRoleLogicalId)
    );
    const rsvpPolicyJson = JSON.stringify(rsvpPolicy?.Properties?.PolicyDocument);
    expect(rsvpPolicyJson).toContain("sqs:SendMessage");
    expect(rsvpPolicyJson).not.toContain("sqs:ReceiveMessage");

    for (const resource of Object.values(template.findResources("AWS::Lambda::Function"))) {
      expect(resource.Properties).not.toHaveProperty("FunctionName");
    }

    template.hasOutput("AsaasWebhookUrl", {});
    template.hasOutput("ApiCustomDomainName", {});
    template.hasOutput("ApiCustomDomainUrl", {});
    template.hasOutput("RawExecuteApiUrl", {});
    template.hasOutput("ApiCustomDomainRegionalTarget", {});
    template.hasOutput("ApiCustomDomainRegionalHostedZoneId", {});
    template.hasOutput("SesSenderEmailIdentity", {});
    template.hasOutput("SesSenderDomainIdentity", {});
    template.hasOutput("SesConfigurationSetName", {});
    template.hasOutput("SesMailFromDomain", {});
    template.hasOutput("SesMailFromMxValue", {});
    template.hasOutput("SesMailFromTxtValue", {});

    expect(template.toJSON()).toBeDefined();
  });

  it("wires only the production Google audience into the production authorizer", () => {
    const app = new cdk.App({ context: { "aws:cdk:bundling-stacks": [] } });
    const dataStack = new DataStack(app, "ProdAuthDataStack", { stage: "prod" });
    const stack = new AppStack(app, "ProdAuthAppStack", {
      adminGoogleHostedDomain: "brimax.life",
      apiCertificate: acm.Certificate.fromCertificateArn(
        app,
        "ProdAuthCertificate",
        "arn:aws:acm:us-east-1:123456789012:certificate/test-prod-api"
      ),
      apiDomain: "api.brimax.life",
      asaasApiKey: "test",
      asaasWebhookToken: "test",
      contactEmail: "casamento@brimax.life",
      googleWebClientId: "prod-client.apps.googleusercontent.com",
      rootDomain: "brimax.life",
      sentryDsn: "https://public@example.ingest.sentry.io/123456",
      stage: "prod",
      table: dataStack.table,
      turnstileSecretKey: "test",
      whatsappAccessToken: "test",
      whatsappAppSecret: "test",
      whatsappPhoneNumberId: "123456789",
      whatsappVerifyToken: "test",
      wwwDomain: "www.brimax.life",
      xrayEnabled: false
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          ADMIN_GOOGLE_HOSTED_DOMAIN: "brimax.life",
          GOOGLE_WEB_CLIENT_ID: "prod-client.apps.googleusercontent.com",
          STAGE: "prod"
        })
      }
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerPayloadFormatVersion: "2.0",
      AuthorizerResultTtlInSeconds: 30,
      EnableSimpleResponses: true,
      IdentitySource: ["$request.header.Authorization"]
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: Match.objectLike({
        AllowHeaders: Match.arrayWith(["authorization"]),
        AllowMethods: Match.arrayWith(["PUT", "PATCH"]),
        AllowOrigins: ["https://brimax.life", "https://www.brimax.life"]
      })
    });
    const resources = template.toJSON().Resources as Record<
      string,
      { Properties?: Record<string, unknown>; Type: string }
    >;
    const protectedRoutes = Object.values(resources).filter(
      (resource) =>
        resource.Type === "AWS::ApiGatewayV2::Route" &&
        String(resource.Properties?.RouteKey).includes(" /admin/")
    );
    expect(protectedRoutes).toHaveLength(16);
    expect(protectedRoutes.every((route) => route.Properties?.AuthorizationType === "CUSTOM")).toBe(true);
    expect(new Set(protectedRoutes.map((route) => JSON.stringify(route.Properties?.AuthorizerId))).size).toBe(1);
    const authorizerInvokePermissions = Object.values(resources).filter(
      (resource) =>
        resource.Type === "AWS::Lambda::Permission" &&
        resource.Properties?.Principal === "apigateway.amazonaws.com" &&
        JSON.stringify(resource.Properties?.SourceArn).includes("authorizers")
    );
    expect(authorizerInvokePermissions).toHaveLength(1);
    expect(JSON.stringify(template.toJSON())).not.toContain(
      "dev-client.apps.googleusercontent.com"
    );
  });
});
