
import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { type AppStage, resourceName } from "@brimax/config";
import { Construct } from "constructs";

export interface ObservabilityStackProps extends cdk.StackProps {
  alarmedFunctions: lambda.IFunction[];
  alertEmail?: string;
  applicationLogGroups: logs.ILogGroup[];
  checkoutExpiryDlq: sqs.IQueue;
  checkoutExpiryQueue: sqs.IQueue;
  checkoutExpiryWorkerFunction: lambda.IFunction;
  createPaymentFunction: lambda.IFunction;
  distribution: cloudfront.IDistribution;
  guestMessageNotificationDlq: sqs.IQueue;
  httpApi: apigwv2.IHttpApi;
  stage: AppStage;
  table: dynamodb.ITable;
  whatsappRsvpDlq: sqs.IQueue;
  whatsappRsvpQueue: sqs.IQueue;
  whatsappRsvpWorkerFunction: lambda.IFunction;
  webhookDlq: sqs.IQueue;
  webhookProcessorFunction: lambda.IFunction;
  webhookQueue: sqs.IQueue;
  whatsappWebhookFunction: lambda.IFunction;
}

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const sparseAlarmPeriod = cdk.Duration.minutes(15);
    const sparseAlarmMinimumVolume = 5;
    const sparseAlarmThreshold = 20;
    const eventDrivenAlarmDefaults = {
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    } satisfies Pick<cloudwatch.AlarmProps, "evaluationPeriods" | "treatMissingData">;

    const createSparseTrafficRateAlarm = (
      alarmId: string,
      alarmDescription: string,
      errorsMetric: cloudwatch.IMetric,
      volumeMetric: cloudwatch.IMetric
    ) =>
      new cloudwatch.Alarm(this, alarmId, {
        alarmDescription,
        metric: new cloudwatch.MathExpression({
          expression: `IF(volume >= ${sparseAlarmMinimumVolume}, 100 * errors / volume, 0)`,
          usingMetrics: {
            errors: errorsMetric,
            volume: volumeMetric
          },
          period: sparseAlarmPeriod,
          label: `${alarmId}ErrorRate`
        }),
        threshold: sparseAlarmThreshold,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
      });

    const alarmTopic = new sns.Topic(this, "ObservabilityAlarmTopic", {
      displayName: `Brimax ${props.stage.toUpperCase()} Observability Alerts`,
      topicName: resourceName("brimax-observability-alerts", props.stage)
    });

    if (props.alertEmail) {
      alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(props.alertEmail));
    }

    const alarmAction = new cloudwatchActions.SnsAction(alarmTopic);

    const webhookDlqAlarm = new cloudwatch.Alarm(this, "WebhookDlqAlarm", {
      alarmDescription: "Alerts when the webhook dead-letter queue receives messages.",
      metric: props.webhookDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum"
      }),
      threshold: 1,
      ...eventDrivenAlarmDefaults
    });
    webhookDlqAlarm.addAlarmAction(alarmAction);
    webhookDlqAlarm.addOkAction(alarmAction);

    if (props.stage === "prod") {
      const guestMessageNotificationDlqAlarm = new cloudwatch.Alarm(
        this,
        "GuestMessageNotificationDlqAlarm",
        {
          alarmDescription:
            "Alerts when the guest-message notification dead-letter queue receives messages.",
          metric: props.guestMessageNotificationDlq.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(5),
            statistic: "Maximum"
          }),
          threshold: 1,
          ...eventDrivenAlarmDefaults
        }
      );

    const createPaymentErrorsAlarm = createSparseTrafficRateAlarm(
      "CreatePaymentErrorsAlarm",
      "Alerts when payment creation errors occur under meaningful traffic.",
      props.createPaymentFunction.metricErrors({
        period: sparseAlarmPeriod,
        statistic: "Sum"
      }),
      props.createPaymentFunction.metricInvocations({
        period: sparseAlarmPeriod,
        statistic: "Sum"
      })
    );

    const webhookProcessorErrorsAlarm = createSparseTrafficRateAlarm(
      "WebhookProcessorErrorsAlarm",
      "Alerts when the webhook processor throws errors under meaningful traffic.",
      props.webhookProcessorFunction.metricErrors({
        period: sparseAlarmPeriod,
        statistic: "Sum"
      }),
      props.webhookProcessorFunction.metricInvocations({
        period: sparseAlarmPeriod,
        statistic: "Sum"
      })
    );
    const whatsappWebhookAuthErrorsAlarm = createSparseTrafficRateAlarm(
      "WhatsAppWebhookAuthErrorsAlarm",
      "Alerts when a meaningful share of WhatsApp webhook requests fail verification or signature checks (likely a misconfigured or rotated secret).",
      new cloudwatch.Metric({
        metricName: `whatsapp-webhook-auth-failed-${props.stage}`,
        namespace: "Brimax/Payments",
        period: sparseAlarmPeriod,
        statistic: "Sum"
      }),
      props.whatsappWebhookFunction.metricInvocations({
        period: sparseAlarmPeriod,
        statistic: "Sum"
      })
    );

    const webhookPaymentNotFoundAlarm = new cloudwatch.Alarm(this, "WebhookPaymentNotFoundAlarm", {
      alarmDescription: "Alerts when webhook events cannot be matched to local payments.",
      metric: new cloudwatch.Metric({
        metricName: `asaas-webhook-processor-webhook-payment-not-found-${props.stage}`,
        namespace: "Brimax/Payments",
        period: cdk.Duration.minutes(5),
        statistic: "Sum"
      }),
      threshold: 1,
      ...eventDrivenAlarmDefaults
    });
    // Re-pointed from the (now removed) GET /gifts sweep to the background
    // worker: cleanup moved off the request path, so this watches the worker's
    // failure log instead.
    const checkoutExpirySweepFailureAlarm = new cloudwatch.Alarm(
      this,
      "CheckoutExpirySweepFailureAlarm",
      {
        alarmDescription: "Alerts when the checkout-expiry worker cannot clean up stale reservations.",
        metric: new cloudwatch.Metric({
          metricName: "checkout-expiry-worker-sweep-failed",
          namespace: "Brimax/Payments",
          dimensionsMap: { Stage: props.stage },
          period: cdk.Duration.minutes(5),
          statistic: "Sum"
        }),
        threshold: 1,
        ...eventDrivenAlarmDefaults
      }
    );

    const checkoutExpiryDlqAlarm = new cloudwatch.Alarm(this, "CheckoutExpiryDlqAlarm", {
      alarmDescription: "Alerts when the checkout-expiry dead-letter queue receives messages.",
      metric: props.checkoutExpiryDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum"
      }),
      threshold: 1,
      ...eventDrivenAlarmDefaults
    });

    const checkoutExpiryQueueBacklogAlarm = new cloudwatch.Alarm(
      this,
      "CheckoutExpiryQueueBacklogAlarm",
      {
        alarmDescription: "Alerts when the checkout-expiry queue begins backing up.",
        metric: props.checkoutExpiryQueue.metricApproximateNumberOfMessagesVisible({
          period: cdk.Duration.minutes(5),
          statistic: "Maximum"
        }),
        threshold: 50,
        ...eventDrivenAlarmDefaults
      }
    );

    const checkoutExpiryQueueAgeAlarm = new cloudwatch.Alarm(
      this,
      "CheckoutExpiryQueueAgeAlarm",
      {
        alarmDescription:
          "Alerts when stale-checkout triggers stay queued too long (worker not keeping up).",
        metric: props.checkoutExpiryQueue.metricApproximateAgeOfOldestMessage({
          period: cdk.Duration.minutes(5),
          statistic: "Maximum"
        }),
        threshold: 300,
        ...eventDrivenAlarmDefaults
      }
    );

    const checkoutExpiryWorkerErrorsAlarm = createSparseTrafficRateAlarm(
      "CheckoutExpiryWorkerErrorsAlarm",
      "Alerts when the checkout-expiry worker throws errors under meaningful traffic.",
      props.checkoutExpiryWorkerFunction.metricErrors({
        period: sparseAlarmPeriod,
        statistic: "Sum"
      }),
      props.checkoutExpiryWorkerFunction.metricInvocations({
        period: sparseAlarmPeriod,
        statistic: "Sum"
      })
    );

    const checkoutExpiryWorkerDurationAlarm = new cloudwatch.Alarm(
      this,
      "CheckoutExpiryWorkerDurationAlarm",
      {
        alarmDescription: "Alerts when the checkout-expiry sweep runs long (approaching its timeout).",
        metric: props.checkoutExpiryWorkerFunction.metricDuration({
          period: cdk.Duration.minutes(5),
          statistic: "p95"
        }),
        // Worker timeout is 60s; warn well before it.
        threshold: 45_000,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        ...eventDrivenAlarmDefaults
      }
    );

    const checkoutExpiryTriggerEnqueueFailureAlarm = new cloudwatch.Alarm(
      this,
      "CheckoutExpiryTriggerEnqueueFailureAlarm",
      {
        alarmDescription: "Alerts when GET /gifts cannot enqueue stale-checkout triggers.",
        metric: new cloudwatch.Metric({
          metricName: "checkout-expiry-trigger-enqueue-failed",
          namespace: "Brimax/Payments",
          period: cdk.Duration.minutes(5),
          statistic: "Sum"
        }),
        threshold: 1,
        ...eventDrivenAlarmDefaults
      }
    );

    const checkoutExpiryProtectedStaleAlarm = new cloudwatch.Alarm(
      this,
      "CheckoutExpiryProtectedStaleAlarm",
      {
        alarmDescription:
          "Alerts when stale reservations sit under protected (processing/terminal) payments — likely drift.",
        metric: new cloudwatch.Metric({
          metricName: "checkout-expiry-protected-stale",
          namespace: "Brimax/Payments",
          period: cdk.Duration.minutes(15),
          statistic: "Sum"
        }),
        // Tolerate the occasional in-flight PROCESSING reservation; alert only on
        // a sustained cluster.
        threshold: 5,
        ...eventDrivenAlarmDefaults
      }
    );

    const api5xxAlarm = createSparseTrafficRateAlarm(
      "HttpApi5xxAlarm",
      "Alerts when the public HTTP API emits a high 5XX rate under meaningful traffic.",
      props.httpApi.metricServerError({
        period: sparseAlarmPeriod,
        statistic: "Sum"
      }),
      props.httpApi.metricCount({
        period: sparseAlarmPeriod,
        statistic: "Sum"
      })
    );

    const webhookQueueBacklogAlarm = new cloudwatch.Alarm(this, "WebhookQueueBacklogAlarm", {
      alarmDescription: "Alerts when the webhook queue begins backing up.",
      metric: props.webhookQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum"
      }),
      threshold: 5,
      ...eventDrivenAlarmDefaults
    });

    const webhookQueueAgeAlarm = new cloudwatch.Alarm(this, "WebhookQueueAgeAlarm", {
      alarmDescription: "Alerts when webhook events stay queued for too long.",
      metric: props.webhookQueue.metricApproximateAgeOfOldestMessage({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum"
      }),
      threshold: 300,
      ...eventDrivenAlarmDefaults
    });

    const whatsappRsvpDlqAlarm = new cloudwatch.Alarm(this, "WhatsappRsvpDlqAlarm", {
      alarmDescription: "Alerts when the WhatsApp RSVP dead-letter queue receives messages.",
      metric: props.whatsappRsvpDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum"
      }),
      threshold: 1,
      ...eventDrivenAlarmDefaults
    });

    const whatsappRsvpQueueBacklogAlarm = new cloudwatch.Alarm(this, "WhatsappRsvpQueueBacklogAlarm", {
      alarmDescription: "Alerts when the WhatsApp RSVP queue begins backing up.",
      metric: props.whatsappRsvpQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum"
      }),
      threshold: 5,
      ...eventDrivenAlarmDefaults
    });

    const whatsappRsvpQueueAgeAlarm = new cloudwatch.Alarm(this, "WhatsappRsvpQueueAgeAlarm", {
      alarmDescription: "Alerts when WhatsApp RSVP commands stay queued for too long.",
      metric: props.whatsappRsvpQueue.metricApproximateAgeOfOldestMessage({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum"
      }),
      threshold: 300,
      ...eventDrivenAlarmDefaults
    });

    const whatsappRsvpWorkerErrorsAlarm = createSparseTrafficRateAlarm(
      "WhatsappRsvpWorkerErrorsAlarm",
      "Alerts when the WhatsApp RSVP worker throws errors under meaningful traffic.",
      props.whatsappRsvpWorkerFunction.metricErrors({
        period: sparseAlarmPeriod,
        statistic: "Sum"
      }),
      props.whatsappRsvpWorkerFunction.metricInvocations({
        period: sparseAlarmPeriod,
        statistic: "Sum"
      })
    );

    const whatsappRsvpSendFailureAlarm = new cloudwatch.Alarm(this, "WhatsappRsvpSendFailureAlarm", {
      alarmDescription: "Alerts when the WhatsApp RSVP send service records a failure.",
      metric: new cloudwatch.Metric({
        metricName: `whatsapp-rsvp-send-failure-${props.stage}`,
        namespace: "Brimax/Payments",
        period: cdk.Duration.minutes(5),
        statistic: "Sum"
      }),
      threshold: 1,
      ...eventDrivenAlarmDefaults
    });

    const whatsappRsvpWorkerFailureAlarm = new cloudwatch.Alarm(this, "WhatsappRsvpWorkerFailureAlarm", {
      alarmDescription: "Alerts when the WhatsApp RSVP worker records a permanent provider failure.",
      metric: new cloudwatch.Metric({
        metricName: `whatsapp-rsvp-worker-failure-${props.stage}`,
        namespace: "Brimax/Payments",
        period: cdk.Duration.minutes(5),
        statistic: "Sum"
      }),
      threshold: 1,
      ...eventDrivenAlarmDefaults
    });

    const lambdaThrottleAlarms = props.alarmedFunctions.map((fn, index) =>
      new cloudwatch.Alarm(this, `LambdaThrottleAlarm${index}`, {
        alarmDescription: `Alerts when Lambda throttles occur for ${fn.functionName}.`,
        metric: fn.metricThrottles({
          period: cdk.Duration.minutes(5),
          statistic: "Sum"
        }),
        threshold: 1,
        ...eventDrivenAlarmDefaults
      })
    );

      for (const alarm of [
        guestMessageNotificationDlqAlarm,
        createPaymentErrorsAlarm,
        webhookProcessorErrorsAlarm,
        whatsappWebhookAuthErrorsAlarm,
        webhookPaymentNotFoundAlarm,
        checkoutExpirySweepFailureAlarm,
        checkoutExpiryDlqAlarm,
        checkoutExpiryQueueBacklogAlarm,
        checkoutExpiryQueueAgeAlarm,
        checkoutExpiryWorkerErrorsAlarm,
        checkoutExpiryWorkerDurationAlarm,
        checkoutExpiryTriggerEnqueueFailureAlarm,
        checkoutExpiryProtectedStaleAlarm,
        api5xxAlarm,
        webhookQueueBacklogAlarm,
        webhookQueueAgeAlarm,
        whatsappRsvpDlqAlarm,
        whatsappRsvpQueueBacklogAlarm,
        whatsappRsvpQueueAgeAlarm,
        whatsappRsvpWorkerErrorsAlarm,
        whatsappRsvpSendFailureAlarm,
        whatsappRsvpWorkerFailureAlarm,
        ...lambdaThrottleAlarms
      ]) {
        alarm.addAlarmAction(alarmAction);
        alarm.addOkAction(alarmAction);
      }
    }

    const dashboard = new cloudwatch.Dashboard(this, "ObservabilityDashboard", {
      dashboardName: resourceName("brimax-observability", props.stage)
    });

    const xrayTraceMapUrl = `https://console.aws.amazon.com/xray/home?region=${this.region}#/service-map`;

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown:
          "## X-Ray Trace Map\n" +
          "Open the interactive X-Ray trace map in the CloudWatch console for event-chain analysis.\n\n" +
          `[Open X-Ray Trace Map](${xrayTraceMapUrl})`,
        width: 24,
        height: 4
      }),
      new cloudwatch.LogQueryWidget({
        title: "Application WARN / ERROR Logs",
        logGroupNames: props.applicationLogGroups.map((logGroup) => logGroup.logGroupName),
        queryLines: [
          "fields @timestamp, @log, @message",
          "filter @message like /\\t(WARN|ERROR)\\t/",
          "sort @timestamp desc",
          "limit 50"
        ],
        region: this.region,
        view: cloudwatch.LogQueryVisualizationType.TABLE,
        width: 24,
        height: 8
      }),
      new cloudwatch.GraphWidget({
        title: "Lambda Errors",
        left: props.alarmedFunctions.map((fn) =>
          fn.metricErrors({ period: cdk.Duration.minutes(5), statistic: "Sum" })
        ),
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: "Lambda Duration (p95)",
        left: props.alarmedFunctions.map((fn) =>
          fn.metricDuration({ period: cdk.Duration.minutes(5), statistic: "p95" })
        ),
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: "Lambda Throttles",
        left: props.alarmedFunctions.map((fn) =>
          fn.metricThrottles({ period: cdk.Duration.minutes(5), statistic: "Sum" })
        ),
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: "API Gateway 4XX / 5XX",
        left: [
          props.httpApi.metricClientError({ period: cdk.Duration.minutes(5), statistic: "Sum" }),
          props.httpApi.metricServerError({ period: cdk.Duration.minutes(5), statistic: "Sum" })
        ],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: "API Gateway Latency",
        left: [props.httpApi.metricLatency({ period: cdk.Duration.minutes(5), statistic: "p95" })],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: "Webhook Queue Depth / Age",
        left: [
          props.webhookQueue.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(5),
            statistic: "Maximum"
          }),
          props.webhookQueue.metricApproximateAgeOfOldestMessage({
            period: cdk.Duration.minutes(5),
            statistic: "Maximum"
          })
        ],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: "Webhook DLQ Messages",
        left: [
          props.webhookDlq.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(5),
            statistic: "Maximum"
          })
        ],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: "Webhook Unmatched / Processor Errors",
        left: [
          new cloudwatch.Metric({
            metricName: `asaas-webhook-processor-webhook-payment-not-found-${props.stage}`,
            namespace: "Brimax/Payments",
            period: cdk.Duration.minutes(5),
            statistic: "Sum"
          }),
          props.webhookProcessorFunction.metricErrors({
            period: cdk.Duration.minutes(5),
            statistic: "Sum"
          })
        ],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: "Checkout Expiry Queue / DLQ",
        left: [
          props.checkoutExpiryQueue.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(5),
            statistic: "Maximum"
          }),
          props.checkoutExpiryQueue.metricApproximateAgeOfOldestMessage({
            period: cdk.Duration.minutes(5),
            statistic: "Maximum"
          }),
          props.checkoutExpiryDlq.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(5),
            statistic: "Maximum"
          })
        ],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: "Checkout Expiry Worker / Triggers",
        left: [
          new cloudwatch.Metric({
            metricName: "checkout-expiry-worker-sweep-failed",
            namespace: "Brimax/Payments",
            dimensionsMap: { Stage: props.stage },
            period: cdk.Duration.minutes(5),
            statistic: "Sum"
          }),
          new cloudwatch.Metric({
            metricName: "checkout-expiry-protected-stale",
            namespace: "Brimax/Payments",
            period: cdk.Duration.minutes(5),
            statistic: "Sum"
          }),
          new cloudwatch.Metric({
            metricName: "checkout-expiry-trigger-enqueue-failed",
            namespace: "Brimax/Payments",
            period: cdk.Duration.minutes(5),
            statistic: "Sum"
          })
        ],
        width: 12
      }),
      new cloudwatch.GraphWidget({
        title: "Distribution / Table",
        left: [
          new cloudwatch.Metric({
            namespace: "AWS/CloudFront",
            metricName: "Requests",
            dimensionsMap: {
              DistributionId: props.distribution.distributionId,
              Region: "Global"
            },
            period: cdk.Duration.minutes(5),
            statistic: "Sum"
          }),
          props.table.metricConsumedReadCapacityUnits({ period: cdk.Duration.minutes(5), statistic: "Sum" }),
          props.table.metricConsumedWriteCapacityUnits({ period: cdk.Duration.minutes(5), statistic: "Sum" })
        ],
        width: 12
      })
    );

    new cdk.CfnOutput(this, "AlarmTopicArn", {
      value: alarmTopic.topicArn
    });

    new cdk.CfnOutput(this, "DashboardName", {
      value: dashboard.dashboardName
    });

    new cdk.CfnOutput(this, "DistributionId", {
      value: props.distribution.distributionId
    });

    new cdk.CfnOutput(this, "HttpApiId", {
      value: props.httpApi.apiId
    });

    new cdk.CfnOutput(this, "TableName", {
      value: props.table.tableName
    });
  }
}
