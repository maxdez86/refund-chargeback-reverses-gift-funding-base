import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AppStack } from "../lib/stacks/app-stack";
import { DataStack } from "../lib/stacks/data-stack";

describe("AppStack", () => {
  it("creates the payment API, webhook queue, secrets, and Lambda handlers", () => {
    const app = new cdk.App();
    const dataStack = new DataStack(app, "AppDataStack", {
      stage: "dev"
    });
    const stack = new AppStack(app, "PaymentAppStack", {
      stage: "dev",
      table: dataStack.table
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
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

    expect(template.toJSON()).toBeDefined();
  });
});
