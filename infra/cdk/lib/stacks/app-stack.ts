
import path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as ses from "aws-cdk-lib/aws-ses";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { resourceName, type AppStage } from "@brimax/config";
import { Construct } from "constructs";

export interface AppStackProps extends cdk.StackProps {
  apiCertificate: acm.ICertificate;
  apiDomain: string;
  asaasApiKey: string;
  asaasWebhookToken: string;
  contactEmail: string;
  rootDomain: string;
  sentryDsn: string;
  stage: AppStage;
  table: dynamodb.ITable;
  turnstileSecretKey: string;
  wwwDomain: string;
  xrayEnabled: boolean;
}

export class AppStack extends cdk.Stack {
  readonly alarmedFunctions: lambda.IFunction[];
  readonly applicationLogGroups: logs.ILogGroup[] = [];
  readonly createPaymentFunction: lambda.IFunction;
  readonly httpApi: apigwv2.HttpApi;
  readonly webhookProcessorFunction: lambda.IFunction;
  readonly webhookDlq: sqs.IQueue;
  readonly webhookQueue: sqs.IQueue;
  readonly checkoutExpiryWorkerFunction: lambda.IFunction;
  readonly checkoutExpiryDlq: sqs.IQueue;
  readonly checkoutExpiryQueue: sqs.IQueue;
  private readonly functionLogGroups = new Map<string, logs.LogGroup>();

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const projectRoot = path.resolve(__dirname, "../../../../");
    const senderEmailIdentity = props.contactEmail;
    const senderDomainIdentity = senderEmailIdentity.split("@")[1] ?? "brimax.life";
    const senderMailFromDomain = `mail.${senderDomainIdentity}`;
    const senderMailFromMxValue = `10 feedback-smtp.${this.region}.amazonses.com`;
    const senderMailFromTxtValue = "v=spf1 include:amazonses.com ~all";
    const siteBaseUrl = `https://${props.rootDomain}`;
    const allowedOrigins = [`https://${props.rootDomain}`, `https://${props.wwwDomain}`];
    // One JSON "bucket" secret per stage holds every credential the API needs.
    // The 3 vendor values are injected via secretStringTemplate; lookupProofSecret
    // is auto-generated so it is never present in `.env`. Secrets Manager has no
    // per-JSON-key IAM, so every reader granted below can read ALL four values
    // (e.g. the internet-facing AsaasWebhook Lambda also holds the Asaas API key).
    // This is a deliberate least-privilege reduction in exchange for one secret.
    // Footgun: changing a vendor credential changes the template, which regenerates
    // the whole value — including a fresh lookupProofSecret — invalidating any
    // in-flight (≤30 min) RSVP proofs. Plain redeploys do NOT regenerate.
    const appSecret = new secretsmanager.Secret(this, "AppSecret", {
      secretName: `/${props.stage}/brimax/app-secrets`,
      // Prod retains the secret (and any in-flight RSVP proofs) on stack teardown;
      // non-prod is disposable. Symmetric with the WeddingTable.
      removalPolicy:
        props.stage === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      generateSecretString: {
        excludePunctuation: true,
        generateStringKey: "lookupProofSecret",
        passwordLength: 64,
        secretStringTemplate: JSON.stringify({
          asaasApiKey: props.asaasApiKey,
          asaasWebhookToken: props.asaasWebhookToken,
          turnstileSecretKey: props.turnstileSecretKey
        })
      }
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
    this.webhookDlq = webhookDlq;
    this.webhookQueue = webhookQueue;
    // Durable, traffic-independent stale-checkout cleanup. Mirrors the webhook
    // queue (redrive 5, 14-day DLQ). The worker timeout is 60s, so the queue
    // visibility timeout must comfortably exceed it.
    const expiryDlq = new sqs.Queue(this, "CheckoutExpiryDlq", {
      retentionPeriod: cdk.Duration.days(14)
    });
    const expiryQueue = new sqs.Queue(this, "CheckoutExpiryQueue", {
      deadLetterQueue: {
        queue: expiryDlq,
        maxReceiveCount: 5
      },
      visibilityTimeout: cdk.Duration.seconds(120)
    });
    this.checkoutExpiryDlq = expiryDlq;
    this.checkoutExpiryQueue = expiryQueue;
    const senderDomain =
      props.stage === "prod"
        ? new ses.CfnEmailIdentity(this, "PaymentSenderDomainIdentity", {
            emailIdentity: senderDomainIdentity,
            dkimSigningAttributes: {
              nextSigningKeyLength: "RSA_2048_BIT"
            },
            mailFromAttributes: {
              behaviorOnMxFailure: "REJECT_MESSAGE",
              mailFromDomain: senderMailFromDomain
            }
          })
        : undefined;
    if (props.stage === "prod") {
      new ses.CfnEmailIdentity(this, "PaymentSenderIdentity", {
        emailIdentity: senderEmailIdentity
      });
    }
    const emailConfigurationSet = new ses.ConfigurationSet(this, "TransactionalEmailConfigurationSet", {
      configurationSetName: `brimax-${props.stage}-transactional`,
      reputationMetrics: true,
      tlsPolicy: ses.ConfigurationSetTlsPolicy.REQUIRE
    });

    emailConfigurationSet.addEventDestination("DeliveryReputationMetrics", {
      destination: ses.EventDestination.cloudWatchDimensions([
        {
          defaultValue: emailConfigurationSet.configurationSetName,
          name: "ses:configuration-set",
          source: ses.CloudWatchDimensionSource.MESSAGE_TAG
        }
      ]),
      events: [ses.EmailSendingEvent.DELIVERY, ses.EmailSendingEvent.BOUNCE, ses.EmailSendingEvent.COMPLAINT]
    });

    this.httpApi = new apigwv2.HttpApi(this, "PublicHttpApi", {
      apiName: `brimax-${props.stage}-api`,
      corsPreflight: {
        allowHeaders: [
          "content-type",
          "idempotency-key",
          "x-turnstile-token",
          "x-rsvp-lookup-proof"
        ],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS
        ],
        allowOrigins: allowedOrigins,
        maxAge: cdk.Duration.minutes(10)
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

    const apiAccessLogGroup = new logs.LogGroup(this, "ApiAccessLogs", {
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy:
        props.stage === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY
    });
    // HTTP API (v2) access logging to CloudWatch is NOT auto-permissioned by CDK
    // (unlike REST APIs, which use the account-level CloudWatch role). Grant the
    // API Gateway service principal write access via a log-group resource policy.
    // Verify on first deploy that events actually land; if not, swap the
    // principal to delivery.logs.amazonaws.com.
    new logs.CfnResourcePolicy(this, "ApiAccessLogsResourcePolicy", {
      policyName: resourceName("brimax-api-access-logs", props.stage),
      policyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "apigateway.amazonaws.com" },
            Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
            Resource: `${apiAccessLogGroup.logGroupArn}:*`
          }
        ]
      })
    });

    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (defaultStage) {
      defaultStage.accessLogSettings = {
        destinationArn: apiAccessLogGroup.logGroupArn,
        format: JSON.stringify({
          requestId: "$context.requestId",
          ip: "$context.identity.sourceIp",
          method: "$context.httpMethod",
          route: "$context.routeKey",
          status: "$context.status",
          protocol: "$context.protocol",
          responseLength: "$context.responseLength",
          integrationError: "$context.integrationErrorMessage"
        })
      };
      defaultStage.defaultRouteSettings = {
        throttlingBurstLimit: 20,
        throttlingRateLimit: 10
      };
      // Tighter caps on the abuse-prone routes. API Gateway throttling is
      // account-wide (not per-IP), so these limits cap the total damage a
      // scripted enumerator can do while leaving plenty of headroom for
      // legitimate guests submitting an RSVP or opening a payment message.
      // routeSettings is typed as `any` on CfnStage — CDK does not apply the
      // CloudFormation property mapper to it, so the inner keys must be
      // PascalCase to match the underlying AWS::ApiGatewayV2::Stage schema.
      defaultStage.routeSettings = {
        "GET /invitation/{code}": {
          ThrottlingBurstLimit: 5,
          ThrottlingRateLimit: 2
        },
        "POST /rsvp": {
          ThrottlingBurstLimit: 5,
          ThrottlingRateLimit: 1
        },
        "POST /payments/{paymentId}/message": {
          ThrottlingBurstLimit: 5,
          ThrottlingRateLimit: 1
        },
        "POST /payments/{paymentId}/discard": {
          ThrottlingBurstLimit: 5,
          ThrottlingRateLimit: 1
        },
        "POST /guest-messages": {
          ThrottlingBurstLimit: 5,
          ThrottlingRateLimit: 1
        }
      };
    }

    const commonEnvironment = {
      ASAAS_API_BASE_URL:
        props.stage === "prod" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3",
      ASAAS_CHECKOUT_BASE_URL:
        props.stage === "prod"
          ? "https://www.asaas.com/checkoutSession/show"
          : "https://sandbox.asaas.com/checkoutSession/show",
      APP_SECRET_ARN: appSecret.secretArn,
      SENTRY_DSN: props.sentryDsn,
      STAGE: props.stage,
      XRAY_ENABLED: String(props.xrayEnabled),
      ALLOWED_ORIGINS: allowedOrigins.join(","),
      CONTACT_EMAIL: props.contactEmail,
      EMAIL_FROM: `Casamento Brimax <${senderEmailIdentity}>`,
      EMAIL_CONFIGURATION_SET_NAME: emailConfigurationSet.configurationSetName,
      HOSTED_CHECKOUT_SUCCESS_URL: siteBaseUrl,
      PAYMENTS_CHECKOUT_EXPIRATION_MINUTES: "20",
      PAYMENTS_SITE_BASE_URL: siteBaseUrl,
      SITE_BASE_URL: siteBaseUrl,
      WEBHOOK_QUEUE_URL: webhookQueue.queueUrl,
      EXPIRY_QUEUE_URL: expiryQueue.queueUrl,
      RSVP_NOTIFICATION_TO: props.contactEmail,
      WEDDING_TABLE_NAME: props.table.tableName
    };

    const createPaymentFn = this.createTaggedNodejsFunction("CreatePaymentFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/payments-create/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      memorySize: 1024,
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(15)
    });
    this.createPaymentFunction = createPaymentFn;
    const discardPaymentFn = this.createTaggedNodejsFunction("DiscardPaymentFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/payments-discard/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      memorySize: 1024,
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(15)
    });
    const getPaymentFn = this.createTaggedNodejsFunction("GetPaymentFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/payments-get/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const getGiftsFn = this.createTaggedNodejsFunction("GetGiftsFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/gifts-get/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      memorySize: 512,
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const getGuestMessagesFn = this.createTaggedNodejsFunction("GetGuestMessagesFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/guest-messages-get/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const createGuestMessagesFn = this.createTaggedNodejsFunction("CreateGuestMessagesFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/guest-messages-create/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      memorySize: 512,
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const deleteGuestMessageFn = this.createTaggedNodejsFunction("DeleteGuestMessageFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/admin-guest-message-delete/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const paymentMessageFn = this.createTaggedNodejsFunction("PaymentMessageFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/payments-message/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const asaasWebhookFn = this.createTaggedNodejsFunction("AsaasWebhookFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/asaas-webhook/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const webhookProcessorFn = this.createTaggedNodejsFunction("AsaasWebhookProcessorFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/asaas-webhook-processor/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30)
    });
    this.webhookProcessorFunction = webhookProcessorFn;
    const checkoutExpiryWorkerFn = this.createTaggedNodejsFunction("CheckoutExpiryWorkerFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/checkout-expiry-worker/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      memorySize: 512,
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60)
    });
    this.checkoutExpiryWorkerFunction = checkoutExpiryWorkerFn;
    const invitationGetFn = this.createTaggedNodejsFunction("InvitationGetFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/invitation-get/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      memorySize: 1024,
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    const rsvpFn = this.createTaggedNodejsFunction("RsvpFunction", {
      entry: path.resolve(projectRoot, "apps/api/src/functions/rsvp/handler.ts"),
      environment: commonEnvironment,
      handler: "handler",
      projectRoot,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10)
    });
    this.alarmedFunctions = [
      createPaymentFn,
      discardPaymentFn,
      getPaymentFn,
      createGuestMessagesFn,
      paymentMessageFn,
      invitationGetFn,
      rsvpFn,
      asaasWebhookFn,
      webhookProcessorFn,
      checkoutExpiryWorkerFn
    ];

    // Keep the guest-facing functions warm (excludes the vendor webhook pair
    // and the admin delete). Runs in every stage: dev pings also de-flake the
    // prod-promotion suite, which hits live api.dev.brimax.life.
    this.addKeepWarmSchedule(
      [
        invitationGetFn,
        rsvpFn,
        createGuestMessagesFn,
        createPaymentFn,
        discardPaymentFn,
        getGiftsFn,
        getGuestMessagesFn,
        getPaymentFn,
        paymentMessageFn
      ],
      props.stage
    );

    webhookProcessorFn.addEventSource(
      new lambdaEventSources.SqsEventSource(webhookQueue, {
        batchSize: 10
      })
    );

    // Bound worker parallelism with the event-source maxConcurrency (floor of 2),
    // NOT function reserved concurrency: reserved concurrency + an SQS source
    // turns throttles into receive-count inflation and false dead-lettering. The
    // sweep is idempotent (condition guards), so two overlapping workers are safe.
    checkoutExpiryWorkerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(expiryQueue, {
        batchSize: 1,
        maxConcurrency: 2
      })
    );

    // Correctness floor: cleanup runs every minute regardless of site traffic.
    // EventBridge targets the SAME queue the GET /gifts trigger feeds, so there
    // is a single invocation path (no competing async-invoke retry/DLQ).
    new events.Rule(this, "CheckoutExpirySchedule", {
      ruleName: resourceName("brimax-checkout-expiry-schedule", props.stage),
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [
        new eventsTargets.SqsQueue(expiryQueue, {
          message: events.RuleTargetInput.fromObject({ source: "schedule" })
        })
      ]
    });

    props.table.grantReadWriteData(createPaymentFn);
    discardPaymentFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:ConditionCheckItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem"
        ],
        resources: [props.table.tableArn]
      })
    );
    props.table.grantReadData(getPaymentFn);
    // GET /gifts is now a pure read: it batch-reads the catalog and only sends an
    // expiry-trigger message. It no longer writes to the table — the worker owns
    // all stale-checkout mutations.
    props.table.grantReadData(getGiftsFn);
    expiryQueue.grantSendMessages(getGiftsFn);
    // The worker performs TransactWriteItems (expiry release + payment
    // ConditionCheck) and queries the open-reservation GSI, so it needs full
    // read/write (covers PutItem/UpdateItem/DeleteItem/ConditionCheckItem).
    props.table.grantReadWriteData(checkoutExpiryWorkerFn);
    expiryQueue.grantConsumeMessages(checkoutExpiryWorkerFn);
    props.table.grantReadData(getGuestMessagesFn);
    props.table.grantReadWriteData(createGuestMessagesFn);
    props.table.grantReadWriteData(deleteGuestMessageFn);
    props.table.grantReadWriteData(paymentMessageFn);
    props.table.grantReadWriteData(asaasWebhookFn);
    props.table.grantReadWriteData(webhookProcessorFn);
    props.table.grantReadData(invitationGetFn);
    props.table.grantReadWriteData(rsvpFn);
    webhookQueue.grantSendMessages(asaasWebhookFn);
    webhookQueue.grantConsumeMessages(webhookProcessorFn);
    // grantRead is whole-secret only — each reader below can read every key in
    // the bucket. Union of the former per-secret readers (6 functions).
    appSecret.grantRead(createPaymentFn);
    appSecret.grantRead(discardPaymentFn);
    appSecret.grantRead(webhookProcessorFn);
    appSecret.grantRead(asaasWebhookFn);
    appSecret.grantRead(invitationGetFn);
    appSecret.grantRead(rsvpFn);
    appSecret.grantRead(createGuestMessagesFn);
    const sesSendPolicy = new iam.PolicyStatement({
      actions: ["ses:SendEmail", "ses:SendRawEmail"],
      resources: ["*"]
    });
    createGuestMessagesFn.addToRolePolicy(sesSendPolicy);
    paymentMessageFn.addToRolePolicy(sesSendPolicy);
    webhookProcessorFn.addToRolePolicy(sesSendPolicy);
    rsvpFn.addToRolePolicy(sesSendPolicy);

    const createPaymentRoutes = this.httpApi.addRoutes({
      path: "/payments",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "CreatePaymentIntegration",
        createPaymentFn
      )
    });
    const discardPaymentRoutes = this.httpApi.addRoutes({
      path: "/payments/{paymentId}/discard",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "DiscardPaymentIntegration",
        discardPaymentFn
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
      path: "/guest-messages",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "GetGuestMessagesIntegration",
        getGuestMessagesFn
      )
    });
    const createGuestMessagesRoutes = this.httpApi.addRoutes({
      path: "/guest-messages",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "CreateGuestMessagesIntegration",
        createGuestMessagesFn
      )
    });
    this.httpApi.addRoutes({
      path: "/admin/guest-messages/{messageId}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "DeleteGuestMessageIntegration",
        deleteGuestMessageFn
      )
    });
    const paymentMessageRoutes = this.httpApi.addRoutes({
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
    const invitationRoutes = this.httpApi.addRoutes({
      path: "/invitation/{code}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration(
        "InvitationGetIntegration",
        invitationGetFn
      )
    });
    const rsvpRoutes = this.httpApi.addRoutes({
      path: "/rsvp",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration("RsvpIntegration", rsvpFn)
    });

    if (defaultStage) {
      addStageRouteDependency(defaultStage, invitationRoutes);
      addStageRouteDependency(defaultStage, rsvpRoutes);
      addStageRouteDependency(defaultStage, paymentMessageRoutes);
      addStageRouteDependency(defaultStage, createGuestMessagesRoutes);
      addStageRouteDependency(defaultStage, createPaymentRoutes);
      addStageRouteDependency(defaultStage, discardPaymentRoutes);
    }

    this.addMetricFilters(this.getFunctionLogGroup("CreatePaymentFunction"), "create-payment");
    this.addCheckoutExpiryWorkerMetricFilters(
      this.getFunctionLogGroup("CheckoutExpiryWorkerFunction")
    );
    this.addCheckoutExpiryTriggerMetricFilter(this.getFunctionLogGroup("GetGiftsFunction"));
    this.addMetricFilters(this.getFunctionLogGroup("AsaasWebhookFunction"), "asaas-webhook");
    this.addMetricFilters(
      this.getFunctionLogGroup("AsaasWebhookProcessorFunction"),
      "asaas-webhook-processor"
    );

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

    new cdk.CfnOutput(this, "CheckoutExpiryQueueUrl", {
      value: expiryQueue.queueUrl
    });

    new cdk.CfnOutput(this, "AppSecretArn", {
      value: appSecret.secretArn
    });

    new cdk.CfnOutput(this, "SesSenderEmailIdentity", {
      description: "Sender address used by the application for transactional email.",
      value: senderEmailIdentity
    });

    new cdk.CfnOutput(this, "SesSenderDomainIdentity", {
      description: "SES domain identity used to unlock production access after DKIM DNS verification.",
      value: senderDomainIdentity
    });
    new cdk.CfnOutput(this, "SesConfigurationSetName", {
      value: emailConfigurationSet.configurationSetName
    });
    new cdk.CfnOutput(this, "SesMailFromDomain", {
      value: senderMailFromDomain
    });
    new cdk.CfnOutput(this, "SesMailFromMxValue", {
      value: senderMailFromMxValue
    });
    new cdk.CfnOutput(this, "SesMailFromTxtValue", {
      value: senderMailFromTxtValue
    });

    if (senderDomain) {
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
  }

  private addKeepWarmSchedule(fns: lambda.IFunction[], stage: AppStage) {
    // EventBridge allows at most 5 targets per rule, so chunk into rules.
    const maxTargetsPerRule = 5;

    for (let i = 0; i * maxTargetsPerRule < fns.length; i++) {
      const chunk = fns.slice(i * maxTargetsPerRule, (i + 1) * maxTargetsPerRule);
      new events.Rule(this, `KeepWarmRule${i}`, {
        ruleName: resourceName(`brimax-keep-warm-${i}`, stage),
        // 4 min stays under the 5-min secret-cache TTL so primed caches never lapse.
        schedule: events.Schedule.rate(cdk.Duration.minutes(4)),
        targets: chunk.map(
          (fn) =>
            new eventsTargets.LambdaFunction(fn, {
              event: events.RuleTargetInput.fromObject({ warmer: true }),
              // Fire-and-forget: a failing ping must not retry-storm (async
              // invokes default to 2 retries with no DLQ here).
              retryAttempts: 0
            })
        )
      });
    }
  }

  private createTaggedNodejsFunction(
    id: string,
    props: nodejs.NodejsFunctionProps
  ): nodejs.NodejsFunction {
    const functionName = resourceName(`brimax-${id}`, props.environment?.STAGE as AppStage);
    const logGroup = this.createFunctionLogGroup(
      `${id}LogGroup`,
      functionName,
      props.environment?.STAGE as AppStage
    );
    const fn = new nodejs.NodejsFunction(this, id, {
      ...props,
      logGroup,
      tracing: props.environment?.XRAY_ENABLED === "true" ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED
    });

    if (props.environment?.XRAY_ENABLED === "true" && fn.role) {
      fn.role.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess")
      );
    }

    this.functionLogGroups.set(id, logGroup);
    this.applicationLogGroups.push(logGroup);

    return fn;
  }

  private createFunctionLogGroup(id: string, functionName: string, stage: AppStage): logs.LogGroup {
    return new logs.LogGroup(this, id, {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: stage === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY
    });
  }

  private getFunctionLogGroup(functionId: string): logs.LogGroup {
    const logGroup = this.functionLogGroups.get(functionId);

    if (!logGroup) {
      throw new Error(`Missing log group registration for Lambda construct "${functionId}".`);
    }

    return logGroup;
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
    new logs.MetricFilter(this, `${metricNamespaceSuffix}WebhookPaymentNotFoundMetric`, {
      logGroup,
      metricNamespace: "Brimax/Payments",
      metricName: `${metricNamespaceSuffix}-webhook-payment-not-found`,
      filterPattern: logs.FilterPattern.literal('"WEBHOOK_PAYMENT_NOT_FOUND"'),
      metricValue: "1"
    });
  }

  private addCheckoutExpiryWorkerMetricFilters(logGroup: logs.ILogGroup) {
    new logs.MetricFilter(this, "CheckoutExpiryWorkerSweepFailuresMetric", {
      logGroup,
      metricNamespace: "Brimax/Payments",
      metricName: "checkout-expiry-worker-sweep-failed",
      filterPattern: logs.FilterPattern.anyTerm(
        "CHECKOUT_EXPIRY_SWEEP_FAILED",
        "CHECKOUT_EXPIRY_SWEEP_ITEM_FAILED"
      ),
      metricValue: "1"
    });
    new logs.MetricFilter(this, "CheckoutExpiryProtectedStaleMetric", {
      logGroup,
      metricNamespace: "Brimax/Payments",
      metricName: "checkout-expiry-protected-stale",
      filterPattern: logs.FilterPattern.literal('"CHECKOUT_EXPIRY_PROTECTED_STALE"'),
      metricValue: "1"
    });
  }

  private addCheckoutExpiryTriggerMetricFilter(logGroup: logs.ILogGroup) {
    new logs.MetricFilter(this, "CheckoutExpiryTriggerEnqueueFailuresMetric", {
      logGroup,
      metricNamespace: "Brimax/Payments",
      metricName: "checkout-expiry-trigger-enqueue-failed",
      filterPattern: logs.FilterPattern.literal('"CHECKOUT_EXPIRY_TRIGGER_ENQUEUE_FAILED"'),
      metricValue: "1"
    });
  }
}

function addStageRouteDependency(stage: apigwv2.CfnStage, routes: apigwv2.HttpRoute[]) {
  for (const route of routes) {
    const routeResource = route.node.defaultChild;
    if (routeResource) {
      stage.node.addDependency(routeResource);
    }
  }
}
