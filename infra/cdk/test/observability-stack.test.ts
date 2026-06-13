import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AppStack } from "../lib/stacks/app-stack";
import { DataStack } from "../lib/stacks/data-stack";
import { EdgeStack } from "../lib/stacks/edge-stack";
import { ObservabilityStack } from "../lib/stacks/observability-stack";
import { applyCostAllocationTags } from "./support/tags";

describe("ObservabilityStack", () => {
  it("creates an alert topic, dashboard, and core operational alarms", { timeout: 30000 }, () => {
    const app = new cdk.App();
    applyCostAllocationTags(app, "prod");
    const dataStack = new DataStack(app, "ObservabilityDataStack", { stage: "prod" });
    const appStack = new AppStack(app, "ObservabilityAppStack", {
      apiCertificate: acm.Certificate.fromCertificateArn(
        app,
        "ObservabilityImportedApiCertificate",
        "arn:aws:acm:us-east-1:123456789012:certificate/test-api"
      ),
      apiDomain: "api.brimax.life",
      asaasApiKey: "asaas-api-key-test",
      asaasWebhookToken: "asaas-webhook-token-test",
      contactEmail: "casamento@brimax.life",
      rootDomain: "brimax.life",
      sentryDsn: "https://public@example.ingest.sentry.io/123456",
      stage: "prod",
      table: dataStack.table,
      turnstileSecretKey: "0x4AAAA-test-secret",
      wwwDomain: "www.brimax.life",
      xrayEnabled: true
    });
    const edgeStack = new EdgeStack(app, "ObservabilityEdgeStack", {
      rootDomain: "brimax.life",
      siteAssetPath: "test/fixtures/site",
      stage: "prod",
      wwwDomain: "www.brimax.life"
    });

    const stack = new ObservabilityStack(app, "ObservabilityStackUnderTest", {
      alertEmail: "alerts@example.com",
      alarmedFunctions: appStack.alarmedFunctions,
      applicationLogGroups: appStack.applicationLogGroups,
      checkoutExpiryDlq: appStack.checkoutExpiryDlq,
      checkoutExpiryQueue: appStack.checkoutExpiryQueue,
      checkoutExpiryWorkerFunction: appStack.checkoutExpiryWorkerFunction,
      createPaymentFunction: appStack.createPaymentFunction,
      distribution: edgeStack.distribution,
      httpApi: appStack.httpApi,
      stage: "prod",
      table: dataStack.table,
      webhookDlq: appStack.webhookDlq,
      webhookProcessorFunction: appStack.webhookProcessorFunction,
      webhookQueue: appStack.webhookQueue
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.resourceCountIs("AWS::SNS::Subscription", 1);
    template.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
    // 15 fixed alarms + one Lambda-throttle alarm per alarmed function (10).
    template.resourceCountIs("AWS::CloudWatch::Alarm", 25);

    template.hasResourceProperties("AWS::SNS::Subscription", {
      Endpoint: "alerts@example.com",
      Protocol: "email"
    });

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription: "Alerts when the public HTTP API emits a high 5XX rate under meaningful traffic.",
      Threshold: 20
    });

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription: "Alerts when the webhook queue begins backing up.",
      Threshold: 5
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription: "Alerts when webhook events cannot be matched to local payments.",
      Threshold: 1
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmActions: Match.anyValue(),
      AlarmDescription: "Alerts when the checkout-expiry worker cannot clean up stale reservations.",
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      EvaluationPeriods: 1,
      MetricName: "checkout-expiry-worker-sweep-failed",
      Namespace: "Brimax/Payments",
      OKActions: Match.anyValue(),
      Period: 300,
      Statistic: "Sum",
      Threshold: 1,
      TreatMissingData: "notBreaching"
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription: "Alerts when the checkout-expiry dead-letter queue receives messages.",
      Threshold: 1
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription: "Alerts when GET /gifts cannot enqueue stale-checkout triggers.",
      MetricName: "checkout-expiry-trigger-enqueue-failed",
      Namespace: "Brimax/Payments",
      Threshold: 1
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription:
        "Alerts when stale reservations sit under protected (processing/terminal) payments — likely drift.",
      MetricName: "checkout-expiry-protected-stale",
      Namespace: "Brimax/Payments",
      Threshold: 5
    });

    template.hasResourceProperties("AWS::CloudWatch::Dashboard", {
      DashboardName: "brimax-observability"
    });
    const dashboards = template.findResources("AWS::CloudWatch::Dashboard");
    const dashboardBody = JSON.stringify(Object.values(dashboards)[0]?.Properties?.DashboardBody);

    expect(dashboardBody).toContain("https://console.aws.amazon.com/xray/home?region=");
    expect(dashboardBody).toContain("#/service-map");
    expect(dashboardBody).toContain("Application WARN / ERROR Logs");
    expect(dashboardBody).toContain('\\"type\\":\\"log\\"');
    expect(dashboardBody).toContain('\\"query\\":\\"SOURCE \'');
    expect(dashboardBody).toContain("filter @message like /\\\\\\\\t(WARN|ERROR)\\\\\\\\t/");
    expect(dashboardBody).toContain("limit 50");
    expect(dashboardBody).toContain("Webhook Unmatched / Processor Errors");
    expect(dashboardBody).toContain("asaas-webhook-processor-webhook-payment-not-found");
    expect(dashboardBody).toContain("Checkout Expiry Queue / DLQ");
    expect(dashboardBody).toContain("checkout-expiry-worker-sweep-failed");
    expect(dashboardBody).not.toContain("cloudwatch/home");
    expect(dashboardBody).not.toContain("#xray:traces/service-map");
    expect(dashboardBody).not.toContain("ApiAccessLogs");
    template.hasResourceProperties("AWS::SNS::Topic", {
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "prod" }
      ])
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "prod" }
      ])
    });

    template.hasOutput("AlarmTopicArn", {});
    template.hasOutput("DashboardName", {});

    expect(template.toJSON()).toBeDefined();
  });
});
