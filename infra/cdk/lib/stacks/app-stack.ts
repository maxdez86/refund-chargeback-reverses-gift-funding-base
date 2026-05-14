import path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as ses from "aws-cdk-lib/aws-ses";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { type AppStage } from "@brimax/config";
import { Construct } from "constructs";

export interface AppStackProps extends cdk.StackProps {
  apiCertificate: acm.ICertificate;
  apiDomain: string;
  asaasApiKey: string;
  asaasWebhookToken: string;
  stage: AppStage;
  table: dynamodb.ITable;
}

export class AppStack extends cdk.Stack {
  readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const projectRoot = path.resolve(__dirname, "../../../../");
    const senderDomainIdentity = "brimax.life";
    const senderEmailIdentity = "casamento@brimax.life";
    const asaasApiSecret = new secretsmanager.Secret(this, "AsaasApiSecret", {
      secretName: `/${props.stage}/brimax/asaas/api-key`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({ apiKey: props.asaasApiKey })
      )
    });
    const asaasWebhookSecret = new secretsmanager.Secret(this, "AsaasWebhookSecret", {
      secretName: `/${props.stage}/brimax/asaas/webhook-token`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({ token: props.asaasWebhookToken })
      )
    });
    const webhookDlq = new sqs.Queue(this, "WebhookDlq", {
      retentionPeriod: cdk.Duration.days(14)
    });
    const webhookQueue = new sqs.Queue(this, "WebhookQueue", {
      deadLetterQueue: {
        queue: webhookDlq,
        maxReceiveCount: 5
      },
      visibilityTimeout: cdk.Duration.seconds(90)
    });
    const senderDomain = new ses.CfnEmailIdentity(this, "PaymentSenderDomainIdentity", {
      emailIdentity: senderDomainIdentity,
      dkimSigningAttributes: {
        nextSigningKeyLength: "RSA_2048_BIT"
      }
    });
    const senderIdentity = new ses.CfnEmailIdentity(this, "PaymentSenderIdentity", {
      emailIdentity: senderEmailIdentity
    });

    this.httpApi = new apigwv2.HttpApi(this, "PublicHttpApi", {
      apiName: `brimax-${props.stage}-api`,
      corsPreflight: {
        allowHeaders: ["content-type", "idempotency-key", "x-admin-token", "asaas-access-token"],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowOrigins: ["*"]
      }
    });

    const apiDomainName = new apigwv2.DomainName(this, "ApiCustomDomain", {
      certificate: props.apiCertificate,
      domainName: props.apiDomain
    });

    new apigwv2.ApiMapping(this, "ApiCustomDomainMapping", {
      api: this.httpApi,
      domainName: apiDomainName,
      stage: this.httpApi.defaultStage
    });

    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingBurstLimit: 20,
        throttlingRateLimit: 10
      };
    }

    const commonEnvironment = {
      ADMIN_EXPORT_TOKEN: "disabled",
      ASAAS_API_BASE_URL:
        props.stage === "prod" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3",
      ASAAS_CHECKOUT_BASE_URL:
        props.stage === "prod"
          ? "https://www.asaas.com/checkoutSession/show"
          : "https://sandbox.asaas.com/checkoutSession/show",
      ASAAS_API_SECRET_ARN: asaasApiSecret.secretArn,
      ASAAS_WEBHOOK_SECRET_ARN: asaasWebhookSecret.secretArn,
      EMAIL_FROM: senderEmailIdentity,
      WEBHOOK_QUEUE_URL: webhookQueue.queueUrl,
      WEDDING_TABLE_NAME: props.table.tableName
    };

    const createPaymentFn = new nodejs.NodejsFunction(this, "CreatePaymentFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/payments-create/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      memorySize: 1024,
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(15)
    });
    const getPaymentFn = new nodejs.NodejsFunction(this, "GetPaymentFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/payments-get/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const getGiftsFn = new nodejs.NodejsFunction(this, "GetGiftsFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/gifts-get/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const paymentMessageFn = new nodejs.NodejsFunction(this, "PaymentMessageFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/payments-message/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const asaasWebhookFn = new nodejs.NodejsFunction(this, "AsaasWebhookFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/asaas-webhook/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const webhookProcessorFn = new nodejs.NodejsFunction(this, "AsaasWebhookProcessorFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/asaas-webhook-processor/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30)
    });
    const invitationGetFn = new nodejs.NodejsFunction(this, "InvitationGetFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/invitation-get/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const rsvpFn = new nodejs.NodejsFunction(this, "RsvpFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/rsvp/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });

    webhookProcessorFn.addEventSource(
      new lambdaEventSources.SqsEventSource(webhookQueue, {
        batchSize: 10
      })
    );

    props.table.grantReadWriteData(createPaymentFn);
    props.table.grantReadData(getPaymentFn);
    props.table.grantReadData(getGiftsFn);
    props.table.grantReadWriteData(paymentMessageFn);
    props.table.grantReadWriteData(asaasWebhookFn);
    props.table.grantReadWriteData(webhookProcessorFn);
    props.table.grantReadData(invitationGetFn);
    props.table.grantReadWriteData(rsvpFn);
    webhookQueue.grantSendMessages(asaasWebhookFn);
    webhookQueue.grantConsumeMessages(webhookProcessorFn);
    asaasApiSecret.grantRead(createPaymentFn);
    asaasApiSecret.grantRead(webhookProcessorFn);
    asaasWebhookSecret.grantRead(asaasWebhookFn);
    const sesSendPolicy = new iam.PolicyStatement({
      actions: ["ses:SendEmail", "ses:SendRawEmail"],
      resources: ["*"]
    });
    paymentMessageFn.addToRolePolicy(sesSendPolicy);
    webhookProcessorFn.addToRolePolicy(sesSendPolicy);

    this.httpApi.addRoutes({
      path: "/payments",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "CreatePaymentIntegration",
        createPaymentFn
      )
    });
    this.httpApi.addRoutes({
      path: "/payments/{paymentId}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration("GetPaymentIntegration", getPaymentFn)
    });
    this.httpApi.addRoutes({
      path: "/gifts",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration("GetGiftsIntegration", getGiftsFn)
    });
    this.httpApi.addRoutes({
      path: "/payments/{paymentId}/message",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "PaymentMessageIntegration",
        paymentMessageFn
      )
    });
    this.httpApi.addRoutes({
      path: "/webhooks/asaas",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "AsaasWebhookIntegration",
        asaasWebhookFn
      )
    });
    this.httpApi.addRoutes({
      path: "/invitation/{code}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "InvitationGetIntegration",
        invitationGetFn
      )
    });
    this.httpApi.addRoutes({
      path: "/rsvp",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration("RsvpIntegration", rsvpFn)
    });

    this.addMetricFilters(createPaymentFn.logGroup, "create-payment");
    this.addMetricFilters(asaasWebhookFn.logGroup, "asaas-webhook");
    this.addMetricFilters(webhookProcessorFn.logGroup, "asaas-webhook-processor");

    new cloudwatch.Alarm(this, "WebhookDlqAlarm", {
      alarmDescription: "Alerts when the webhook dead-letter queue receives messages.",
      metric: webhookDlq.metricApproximateNumberOfMessagesVisible(),
      evaluationPeriods: 1,
      threshold: 1
    });
    new cloudwatch.Alarm(this, "CreatePaymentErrorsAlarm", {
      metric: createPaymentFn.metricErrors(),
      evaluationPeriods: 1,
      threshold: 1
    });
    new cloudwatch.Alarm(this, "WebhookProcessorErrorsAlarm", {
      metric: webhookProcessorFn.metricErrors(),
      evaluationPeriods: 1,
      threshold: 1
    });

    new cdk.CfnOutput(this, "RawExecuteApiUrl", {
      description: "Raw API Gateway execute-api endpoint for fallback diagnostics only.",
      value: this.httpApi.apiEndpoint
    });

    new cdk.CfnOutput(this, "PublicHttpApiUrl", {
      description: "Deprecated alias for the raw execute-api endpoint. Prefer ApiCustomDomainUrl.",
      value: this.httpApi.apiEndpoint
    });

    new cdk.CfnOutput(this, "AsaasWebhookUrl", {
      value: `https://${props.apiDomain}/webhooks/asaas`
    });

    new cdk.CfnOutput(this, "ApiCustomDomainName", {
      value: props.apiDomain
    });

    new cdk.CfnOutput(this, "ApiCustomDomainUrl", {
      value: `https://${props.apiDomain}`
    });

    new cdk.CfnOutput(this, "ApiCustomDomainRegionalTarget", {
      value: apiDomainName.regionalDomainName
    });

    new cdk.CfnOutput(this, "ApiCustomDomainRegionalHostedZoneId", {
      value: apiDomainName.regionalHostedZoneId
    });

    new cdk.CfnOutput(this, "WeddingTableName", {
      value: props.table.tableName
    });

    new cdk.CfnOutput(this, "WebhookQueueUrl", {
      value: webhookQueue.queueUrl
    });

    new cdk.CfnOutput(this, "AsaasApiSecretArn", {
      value: asaasApiSecret.secretArn
    });

    new cdk.CfnOutput(this, "AsaasWebhookSecretArn", {
      value: asaasWebhookSecret.secretArn
    });

    new cdk.CfnOutput(this, "SesSenderEmailIdentity", {
      description: "SES sender identity created by CloudFormation. Verification still requires clicking the SES email link once.",
      value: senderIdentity.emailIdentity
    });

    new cdk.CfnOutput(this, "SesSenderDomainIdentity", {
      description: "SES domain identity used to unlock production access after DKIM DNS verification.",
      value: senderDomain.emailIdentity
    });

    new cdk.CfnOutput(this, "SesDkimDnsTokenName1", {
      value: senderDomain.attrDkimDnsTokenName1
    });
    new cdk.CfnOutput(this, "SesDkimDnsTokenValue1", {
      value: senderDomain.attrDkimDnsTokenValue1
    });
    new cdk.CfnOutput(this, "SesDkimDnsTokenName2", {
      value: senderDomain.attrDkimDnsTokenName2
    });
    new cdk.CfnOutput(this, "SesDkimDnsTokenValue2", {
      value: senderDomain.attrDkimDnsTokenValue2
    });
    new cdk.CfnOutput(this, "SesDkimDnsTokenName3", {
      value: senderDomain.attrDkimDnsTokenName3
    });
    new cdk.CfnOutput(this, "SesDkimDnsTokenValue3", {
      value: senderDomain.attrDkimDnsTokenValue3
    });
  }

  private addMetricFilters(logGroup: logs.ILogGroup, metricNamespaceSuffix: string) {
    new logs.MetricFilter(this, `${metricNamespaceSuffix}CreateFailuresMetric`, {
      logGroup,
      metricNamespace: "Brimax/Payments",
      metricName: `${metricNamespaceSuffix}-payment-create-failed`,
      filterPattern: logs.FilterPattern.literal('"PAYMENT_CREATE_FAILED"'),
      metricValue: "1"
    });
    new logs.MetricFilter(this, `${metricNamespaceSuffix}WebhookAuthMetric`, {
      logGroup,
      metricNamespace: "Brimax/Payments",
      metricName: `${metricNamespaceSuffix}-webhook-auth-failed`,
      filterPattern: logs.FilterPattern.literal('"WEBHOOK_AUTH_FAILED"'),
      metricValue: "1"
    });
    new logs.MetricFilter(this, `${metricNamespaceSuffix}WebhookDuplicateMetric`, {
      logGroup,
      metricNamespace: "Brimax/Payments",
      metricName: `${metricNamespaceSuffix}-webhook-duplicate`,
      filterPattern: logs.FilterPattern.literal('"WEBHOOK_DUPLICATE"'),
      metricValue: "1"
    });
    new logs.MetricFilter(this, `${metricNamespaceSuffix}PaymentTransitionsMetric`, {
      logGroup,
      metricNamespace: "Brimax/Payments",
      metricName: `${metricNamespaceSuffix}-payment-state-transition`,
      filterPattern: logs.FilterPattern.literal('"PAYMENT_STATE_TRANSITION"'),
      metricValue: "1"
    });
  }
}
