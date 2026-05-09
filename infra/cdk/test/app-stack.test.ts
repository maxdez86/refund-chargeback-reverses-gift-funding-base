import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AppStack } from "../lib/stacks/app-stack";
import { DataStack } from "../lib/stacks/data-stack";

describe("AppStack", () => {
  it("creates the payment API, webhook queue, secrets, and Lambda handlers", { timeout: 15000 }, () => {
    const app = new cdk.App();
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
      stage: "dev",
      table: dataStack.table
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.resourceCountIs("AWS::ApiGatewayV2::DomainName", 1);
    template.resourceCountIs("AWS::SQS::Queue", 2);
    template.resourceCountIs("AWS::SecretsManager::Secret", 2);
    template.resourceCountIs("AWS::Lambda::Function", 5);

    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /payments"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /payments/{paymentId}"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /webhooks/asaas"
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "api.brimax.life"
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

    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '"PAYMENT_CREATE_FAILED"',
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricNamespace: "Brimax/Payments"
        })
      ])
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Threshold: 1
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      Runtime: "nodejs20.x"
    });
    template.hasOutput("AsaasWebhookUrl", {});
    template.hasOutput("ApiCustomDomainName", {});
    template.hasOutput("ApiCustomDomainUrl", {});
    template.hasOutput("RawExecuteApiUrl", {});
    template.hasOutput("ApiCustomDomainRegionalTarget", {});
    template.hasOutput("ApiCustomDomainRegionalHostedZoneId", {});

    expect(template.toJSON()).toBeDefined();
  });
});
