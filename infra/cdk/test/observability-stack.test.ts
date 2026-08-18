import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AppStack } from "../lib/stacks/app-stack";
import { DataStack } from "../lib/stacks/data-stack";
import { EdgeStack } from "../lib/stacks/edge-stack";
import { ObservabilityStack } from "../lib/stacks/observability-stack";
import { applyCostAllocationTags } from "./support/tags";

// This suite asserts only on alarms, the dashboard, and the alert topic — never on Lambda code
// assets — so it synthesises with bundling disabled. Running esbuild over every AppStack function
// costs ~15s per test and pushed the prod case past its timeout once the suite runs four workers in
// parallel. Bundle correctness stays covered by app-stack.test.ts.
function createApp() {
  return new cdk.App({ context: { "aws:cdk:bundling-stacks": [] } });
}

describe("ObservabilityStack", () => {
  it("creates an alert topic, dashboard, and core operational alarms", { timeout: 10000 }, () => {
    const app = createApp();
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
      whatsappAccessToken: "whatsapp-access-token-test",
      whatsappAppSecret: "whatsapp-app-secret-test",
      whatsappPhoneNumberId: "123456789",
      whatsappVerifyToken: "whatsapp-verify-token-test",
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
      guestMessageNotificationDlq: appStack.guestMessageNotificationDlq,
      httpApi: appStack.httpApi,
      stage: "prod",
      table: dataStack.table,
      webhookDlq: appStack.webhookDlq,
      webhookProcessorFunction: appStack.webhookProcessorFunction,
      webhookQueue: appStack.webhookQueue,
      whatsappWebhookFunction: appStack.whatsappWebhookFunction,
      whatsappRsvpDlq: appStack.whatsappRsvpDlq,
      whatsappRsvpQueue: appStack.whatsappRsvpQueue,
      whatsappRsvpWorkerFunction: appStack.whatsappRsvpWorkerFunction
    });
    const template = Template.fromStack(stack);
    const appTemplate = Template.fromStack(appStack);

    appTemplate.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '"WEBHOOK_PAYMENT_NOT_FOUND"',
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricName: "asaas-webhook-processor-webhook-payment-not-found-prod",
          MetricNamespace: "Brimax/Payments"
        })
      ])
    });

    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.resourceCountIs("AWS::SNS::Subscription", 1);
    template.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
    // 23 fixed alarms + one Lambda-throttle alarm per alarmed function (12).
    template.resourceCountIs("AWS::CloudWatch::Alarm", 41);

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
      AlarmDescription: "Alerts when the WhatsApp RSVP dead-letter queue receives messages.",
      MetricName: "ApproximateNumberOfMessagesVisible",
      Namespace: "AWS/SQS",
      Threshold: 1
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription: "Alerts when the WhatsApp RSVP queue begins backing up.",
      MetricName: "ApproximateNumberOfMessagesVisible",
      Namespace: "AWS/SQS",
      Threshold: 5
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription: "Alerts when the WhatsApp RSVP send service records a failure.",
      MetricName: "whatsapp-rsvp-send-failure-prod",
      Namespace: "Brimax/Payments",
      Threshold: 1
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription:
        "Alerts when a meaningful share of WhatsApp webhook requests fail verification or signature checks (likely a misconfigured or rotated secret).",
      Threshold: 20
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmDescription: "Alerts when webhook events cannot be matched to local payments.",
      MetricName: "asaas-webhook-processor-webhook-payment-not-found-prod",
      Namespace: "Brimax/Payments",
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
    expect(dashboardBody).toContain(
      "asaas-webhook-processor-webhook-payment-not-found-prod"
    );
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

  it("creates only the webhook DLQ alarm for dev", { timeout: 10000 }, () => {
    const app = createApp();
    applyCostAllocationTags(app, "dev");
    const dataStack = new DataStack(app, "DevObservabilityDataStack", { stage: "dev" });
    const appStack = new AppStack(app, "DevObservabilityAppStack", {
      apiCertificate: acm.Certificate.fromCertificateArn(
        app,
        "DevObservabilityImportedApiCertificate",
        "arn:aws:acm:us-east-1:123456789012:certificate/test-dev-api"
      ),
      apiDomain: "api.dev.brimax.life",
      asaasApiKey: "asaas-api-key-test",
      asaasWebhookToken: "asaas-webhook-token-test",
      contactEmail: "casamento@brimax.life",
      rootDomain: "dev.brimax.life",
      sentryDsn: "https://public@example.ingest.sentry.io/123456",
      stage: "dev",
      table: dataStack.table,
      turnstileSecretKey: "0x4AAAA-test-secret",
      whatsappAccessToken: "whatsapp-access-token-test",
      whatsappAppSecret: "whatsapp-app-secret-test",
      whatsappPhoneNumberId: "123456789",
      whatsappVerifyToken: "whatsapp-verify-token-test",
      wwwDomain: "www.dev.brimax.life",
      xrayEnabled: false
    });
    const edgeStack = new EdgeStack(app, "DevObservabilityEdgeStack", {
      rootDomain: "dev.brimax.life",
      siteAssetPath: "test/fixtures/site",
      stage: "dev",
      wwwDomain: "www.dev.brimax.life"
    });

    const stack = new ObservabilityStack(app, "DevObservabilityStackUnderTest", {
      alertEmail: "dev-alerts@example.com",
      alarmedFunctions: appStack.alarmedFunctions,
      applicationLogGroups: appStack.applicationLogGroups,
      checkoutExpiryDlq: appStack.checkoutExpiryDlq,
      checkoutExpiryQueue: appStack.checkoutExpiryQueue,
      checkoutExpiryWorkerFunction: appStack.checkoutExpiryWorkerFunction,
      createPaymentFunction: appStack.createPaymentFunction,
      distribution: edgeStack.distribution,
      guestMessageNotificationDlq: appStack.guestMessageNotificationDlq,
      httpApi: appStack.httpApi,
      stage: "dev",
      table: dataStack.table,
      webhookDlq: appStack.webhookDlq,
      webhookProcessorFunction: appStack.webhookProcessorFunction,
      webhookQueue: appStack.webhookQueue,
      whatsappWebhookFunction: appStack.whatsappWebhookFunction,
      whatsappRsvpDlq: appStack.whatsappRsvpDlq,
      whatsappRsvpQueue: appStack.whatsappRsvpQueue,
      whatsappRsvpWorkerFunction: appStack.whatsappRsvpWorkerFunction
    });
    const template = Template.fromStack(stack);

    const dashboards = template.findResources("AWS::CloudWatch::Dashboard");
    const dashboardBody = JSON.stringify(Object.values(dashboards)[0]?.Properties?.DashboardBody);
    expect(dashboardBody).toContain("asaas-webhook-processor-webhook-payment-not-found-dev");
    expect(template.toJSON()).not.toContain("WebhookPaymentNotFoundAlarm");

    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    template.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.resourceCountIs("AWS::SNS::Subscription", 1);

    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    expect(Object.keys(alarms)).toEqual([expect.stringMatching(/^WebhookDlqAlarm/)]);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmActions: Match.anyValue(),
      AlarmDescription: "Alerts when the webhook dead-letter queue receives messages.",
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      Dimensions: [
        {
          Name: "QueueName",
          Value: Match.anyValue()
        }
      ],
      EvaluationPeriods: 1,
      MetricName: "ApproximateNumberOfMessagesVisible",
      Namespace: "AWS/SQS",
      OKActions: Match.anyValue(),
      Period: 300,
      Statistic: "Maximum",
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ]),
      Threshold: 1,
      TreatMissingData: "notBreaching"
    });

    template.hasResourceProperties("AWS::CloudWatch::Dashboard", {
      DashboardName: "dev-brimax-observability"
    });
    template.hasResourceProperties("AWS::SNS::Topic", {
      DisplayName: "Brimax DEV Observability Alerts",
      TopicName: "dev-brimax-observability-alerts",
      Tags: Match.arrayWith([
        { Key: "project", Value: "brimax-life" },
        { Key: "stage", Value: "dev" }
      ])
    });
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Endpoint: "dev-alerts@example.com",
      Protocol: "email"
    });

    template.hasOutput("AlarmTopicArn", {});
    template.hasOutput("DashboardName", {});
    template.hasOutput("DistributionId", {});
    template.hasOutput("HttpApiId", {});
    template.hasOutput("TableName", {});
  });
});
