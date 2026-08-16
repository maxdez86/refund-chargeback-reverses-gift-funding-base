import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AppStack } from "../lib/stacks/app-stack";
import { DataStack } from "../lib/stacks/data-stack";
import { applyCostAllocationTags } from "./support/tags";

describe("AppStack", () => {
  it("creates the payment API, webhook queue, secrets, and Lambda handlers", { timeout: 30000 }, () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "dev");
    const dataStack = new DataStack(app, "AppDataStack", {
      stage: "dev"
    });
    const stack = new AppStack(app, "PaymentAppStack", {
      apiCertificate: acm.Certificate.fromCertificateArn(
        app,
        "ImportedApiCertificate",
        "arn:aws:acm:us-east-1:123456789012:certificate/test-api"
      ),
      apiDomain: "api.dev.brimax.life",
      asaasApiKey: "asaas-api-key-test",
      asaasWebhookToken: "asaas-webhook-token-test",
      contactEmail: "casamento-dev@brimax.life",
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
    // webhook queue + DLQ, checkout-expiry queue + DLQ, and guest-message
    // notification queue + DLQ.
    template.resourceCountIs("AWS::SQS::Queue", 6);
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
      RouteKey: "DELETE /admin/guest-messages/{messageId}"
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
        '?"CHECKOUT_EXPIRY_SWEEP_FAILED" ?"CHECKOUT_EXPIRY_SWEEP_ITEM_FAILED"',
      LogGroupName: {
        Ref: Match.stringLikeRegexp("^CheckoutExpiryWorkerFunctionLogGroup")
      },
      MetricTransformations: [
        {
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
    // The checkout-expiry worker consumes its queue with batchSize 1 and a
    // maxConcurrency floor of 2 (NOT reserved concurrency).
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 1,
      ScalingConfig: {
        MaximumConcurrency: 2
      }
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
});
