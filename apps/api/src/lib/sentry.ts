import * as Sentry from "@sentry/aws-serverless";
import { AppError } from "./errors";
import type { AsyncLambdaHandler } from "./lambda";
import { wrapLambdaTracing } from "./xray";

const stage = process.env.STAGE;
const sentryDsn = process.env.SENTRY_DSN?.trim();
const sentryEnabled = Boolean(sentryDsn) && (stage === "prod" || stage === "dev");

if (sentryEnabled && !Sentry.isInitialized()) {
  Sentry.init({
    dsn: sentryDsn,
    enabled: sentryEnabled,
    environment: stage,
    tracesSampleRate: 0,
    enableLogs: true,
    integrations: [Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] })],
    beforeSendLog(log) {
      return log.level === "warn" || log.level === "error" || log.level === "fatal" ? log : null;
    }
  });
}

type CaptureLevel = "warn" | "error";

type HandledErrorOptions = {
  context?: Record<string, unknown>;
  message?: string;
  metric: string;
  statusCode?: number;
};

export function wrapLambdaHandler<TEvent, TResult>(
  handler: AsyncLambdaHandler<TEvent, TResult>
): AsyncLambdaHandler<TEvent, TResult> {
  const tracedHandler = wrapLambdaTracing(handler);

  if (!sentryEnabled) {
    return tracedHandler;
  }

  return Sentry.wrapHandler(tracedHandler, {
    captureAllSettledReasons: false,
    captureTimeoutWarning: false,
    flushTimeout: 2000
  }) as AsyncLambdaHandler<TEvent, TResult>;
}

export function reportHandledError(error: unknown, options: HandledErrorOptions) {
  const statusCode = options.statusCode ?? (error instanceof AppError ? error.statusCode : undefined) ?? 500;
  const level: CaptureLevel = statusCode >= 500 ? "error" : "warn";
  const message = options.message ?? (error instanceof Error ? error.message : "Unexpected application error.");
  const payload = JSON.stringify({
    metric: options.metric,
    statusCode,
    message,
    ...(options.context ?? {})
  });

  if (level === "warn") {
    console.warn(payload);
    return;
  }

  console.error(payload);

  if (!sentryEnabled) {
    return;
  }

  Sentry.withScope((scope) => {
    scope.setLevel("error");
    scope.setTag("handled", "true");

    const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (functionName) {
      scope.setTag("function_name", functionName);
    }

    for (const [key, value] of Object.entries(options.context ?? {})) {
      scope.setExtra(key, value);
    }

    if (error instanceof Error) {
      Sentry.captureException(error);
      return;
    }

    Sentry.captureMessage(message, "error");
  });
}
