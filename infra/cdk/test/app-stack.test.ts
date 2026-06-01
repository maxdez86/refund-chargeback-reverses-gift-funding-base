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
      apiDomain: "api.brimax.life",
      asaasApiKey: "asaas-api-key-test",
      asaasWebhookToken: "asaas-webhook-token-test",
      contactEmail: "casamento@brimax.life",
      sentryDsn: "https://public@example.ingest.sentry.io/123456",
      stage: "dev",
      table: dataStack.table,
      turnstileSecretKey: "1x0000000000000000000000000000000AA"
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.resourceCountIs("AWS::ApiGatewayV2::DomainName", 1);
    template.resourceCountIs("AWS::SQS::Queue", 2);
    template.resourceCountIs("AWS::SecretsManager::Secret", 4);
    template.resourceCountIs("AWS::SES::EmailIdentity", 2);
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
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "api.brimax.life",
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
      Name: "/dev/brimax/asaas/api-key",
      SecretString: "{\"apiKey\":\"asaas-api-key-test\"}"
    });
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "/dev/brimax/asaas/webhook-token",
      SecretString: "{\"token\":\"asaas-webhook-token-test\"}"
    });
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "/dev/brimax/rsvp/lookup-proof-secret",
      GenerateSecretString: Match.objectLike({
        ExcludePunctuation: true,
        GenerateStringKey: "secretKey"
      })
    });
    template.hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "casamento@brimax.life"
    });
    template.hasResourceProperties("AWS::SES::EmailIdentity", {
      EmailIdentity: "brimax.life",
      DkimSigningAttributes: {
        NextSigningKeyLength: "RSA_2048_BIT"
      },
      MailFromAttributes: {
        BehaviorOnMxFailure: "REJECT_MESSAGE",
        MailFromDomain: "mail.brimax.life"
      },
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
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

    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '"PAYMENT_CREATE_FAILED"',
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricNamespace: "Brimax/Payments"
        })
      ])
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      MemorySize: 1024,
      Runtime: "nodejs20.x",
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      MemorySize: 512,
      Runtime: "nodejs20.x",
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: Match.stringLikeRegexp("^/aws/lambda/"),
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
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          CONTACT_EMAIL: "casamento@brimax.life",
          EMAIL_FROM: "Casamento Brimax <casamento@brimax.life>",
          EMAIL_CONFIGURATION_SET_NAME: Match.anyValue(),
          LOOKUP_PROOF_SECRET_ARN: Match.anyValue(),
          SENTRY_DSN: "https://public@example.ingest.sentry.io/123456",
          RSVP_NOTIFICATION_TO: "casamento@brimax.life"
        })
      }
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
    template.hasOutput("SesDkimDnsTokenName1", {});
    template.hasOutput("SesDkimDnsTokenValue1", {});
    template.hasOutput("SesDkimDnsTokenName2", {});
    template.hasOutput("SesDkimDnsTokenValue2", {});
    template.hasOutput("SesDkimDnsTokenName3", {});
    template.hasOutput("SesDkimDnsTokenValue3", {});

    expect(template.toJSON()).toBeDefined();
  });
});
