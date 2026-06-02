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
  createPaymentFunction: lambda.IFunction;
  distribution: cloudfront.IDistribution;
  httpApi: apigwv2.IHttpApi;
  stage: AppStage;
  table: dynamodb.ITable;
  webhookDlq: sqs.IQueue;
  webhookProcessorFunction: lambda.IFunction;
  webhookQueue: sqs.IQueue;
}

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

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
      evaluationPeriods: 1,
      threshold: 1
    });

    const createPaymentErrorsAlarm = new cloudwatch.Alarm(this, "CreatePaymentErrorsAlarm", {
      alarmDescription: "Alerts when payment creation errors occur.",
      metric: props.createPaymentFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: "Sum"
      }),
      evaluationPeriods: 1,
      threshold: 1
    });

    const webhookProcessorErrorsAlarm = new cloudwatch.Alarm(this, "WebhookProcessorErrorsAlarm", {
      alarmDescription: "Alerts when the webhook processor throws errors.",
      metric: props.webhookProcessorFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: "Sum"
      }),
      evaluationPeriods: 1,
      threshold: 1
    });

    const api5xxAlarm = new cloudwatch.Alarm(this, "HttpApi5xxAlarm", {
      alarmDescription: "Alerts when the public HTTP API emits 5XX responses.",
      metric: props.httpApi.metricServerError({
        period: cdk.Duration.minutes(5),
        statistic: "Sum"
      }),
      evaluationPeriods: 1,
      threshold: 1
    });

    const webhookQueueBacklogAlarm = new cloudwatch.Alarm(this, "WebhookQueueBacklogAlarm", {
      alarmDescription: "Alerts when the webhook queue begins backing up.",
      metric: props.webhookQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum"
      }),
      evaluationPeriods: 1,
      threshold: 5
    });

    const webhookQueueAgeAlarm = new cloudwatch.Alarm(this, "WebhookQueueAgeAlarm", {
      alarmDescription: "Alerts when webhook events stay queued for too long.",
      metric: props.webhookQueue.metricApproximateAgeOfOldestMessage({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum"
      }),
      evaluationPeriods: 1,
      threshold: 300
    });

    const lambdaThrottleAlarms = props.alarmedFunctions.map((fn, index) =>
      new cloudwatch.Alarm(this, `LambdaThrottleAlarm${index}`, {
        alarmDescription: `Alerts when Lambda throttles occur for ${fn.functionName}.`,
        metric: fn.metricThrottles({
          period: cdk.Duration.minutes(5),
          statistic: "Sum"
        }),
        evaluationPeriods: 1,
        threshold: 1
      })
    );

    for (const alarm of [
      webhookDlqAlarm,
      createPaymentErrorsAlarm,
      webhookProcessorErrorsAlarm,
      api5xxAlarm,
      webhookQueueBacklogAlarm,
      webhookQueueAgeAlarm,
      ...lambdaThrottleAlarms
    ]) {
      alarm.addAlarmAction(alarmAction);
      alarm.addOkAction(alarmAction);
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
