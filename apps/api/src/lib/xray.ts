import { Tracer } from "@aws-lambda-powertools/tracer";
import type { AsyncLambdaHandler } from "./lambda";

type TraceValue = string | number | boolean | undefined;

type TraceAnnotations = Record<string, TraceValue>;

type TracedClientOptions = {
  annotations?: TraceAnnotations;
  subsegmentPrefix: string;
};

const stage = process.env.STAGE;
const xrayEnabled =
  (process.env.XRAY_ENABLED?.trim().toLowerCase() ?? (stage === "prod" ? "true" : "false")) === "true";

export const tracer = new Tracer({
  enabled: xrayEnabled,
  serviceName: "brimax-api"
});

export function captureAwsClient<T>(client: T): T {
  if (!xrayEnabled) {
    return client;
  }

  return tracer.captureAWSv3Client(client) ?? client;
}

export function annotateTrace(annotations: TraceAnnotations) {
  if (!xrayEnabled || !tracer.getSegment()) {
    return;
  }

  for (const [key, value] of Object.entries(annotations)) {
    if (value === undefined) {
      continue;
    }

    tracer.putAnnotation(key, value);
  }
}

export async function withTracedSubsegment<T>(
  name: string,
  annotations: TraceAnnotations,
  action: () => Promise<T>
): Promise<T> {
  if (!xrayEnabled) {
    return action();
  }

  const parentSegment = tracer.getSegment();
  if (!parentSegment) {
    return action();
  }

  const subsegment = parentSegment.addNewSubsegment(name);
  tracer.setSegment(subsegment);
  annotateTrace(annotations);

  try {
    return await action();
  } catch (error) {
    if (error instanceof Error) {
      tracer.addErrorAsMetadata(error);
    }

    throw error;
  } finally {
    subsegment.close();
    tracer.setSegment(parentSegment);
  }
}

export function wrapLambdaTracing<TEvent, TResult>(
  handler: AsyncLambdaHandler<TEvent, TResult>
): AsyncLambdaHandler<TEvent, TResult> {
  return async (event, context) => {
    const segment = xrayEnabled ? tracer.getSegment() : undefined;

    // X-Ray forbids annotating the Lambda facade/main segment, so without a
    // segment to open a subsegment on we run untraced (annotations would be
    // dropped with a warning otherwise).
    if (!segment) {
      return handler(event, context);
    }

    // Open a handler subsegment and make it active for the whole invocation:
    // annotations now land on the subsegment, and any top-level annotateTrace
    // calls inside the handler (e.g. the Asaas webhooks) land here too.
    const subsegment = segment.addNewSubsegment(`## ${context?.functionName ?? "handler"}`);
    tracer.setSegment(subsegment);

    annotateTrace({
      event_type: detectEventType(event),
      flow: detectFlow(context?.functionName ?? process.env.AWS_LAMBDA_FUNCTION_NAME),
      function_name: context?.functionName ?? process.env.AWS_LAMBDA_FUNCTION_NAME,
      stage: stage
    });

    try {
      return await handler(event, context);
    } finally {
      subsegment.close();
      tracer.setSegment(segment);
    }
  };
}

export function createTracedAwsClient<T extends object>(
  client: T,
  options: TracedClientOptions
): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);

      if (property !== "send" || typeof value !== "function") {
        return value;
      }

      return async (command: unknown) => {
        const operation = normalizeCommandName(command);
        const send = value as (input: unknown) => Promise<unknown>;

        return withTracedSubsegment(
          `${options.subsegmentPrefix}.${operation}`,
          {
            operation,
            ...options.annotations
          },
          async () => send.call(target, command)
        );
      };
    }
  }) as T;
}

function detectEventType(event: unknown) {
  if (isHttpEvent(event)) {
    return "http";
  }

  if (isSqsEvent(event)) {
    return "sqs";
  }

  return "unknown";
}

function detectFlow(functionName?: string) {
  if (!functionName) {
    return "unknown";
  }

  const normalized = functionName.toLowerCase();

  if (normalized.includes("webhook")) {
    return "webhook";
  }

  if (normalized.includes("payment")) {
    return "payment";
  }

  if (normalized.includes("guest")) {
    return "guest_message";
  }

  if (normalized.includes("rsvp")) {
    return "rsvp";
  }

  if (normalized.includes("invitation")) {
    return "invitation";
  }

  if (normalized.includes("gift")) {
    return "gift";
  }

  return "unknown";
}

function isHttpEvent(event: unknown): event is { requestContext: { http: unknown } } {
  return typeof event === "object" && event !== null && "requestContext" in event;
}

function isSqsEvent(event: unknown): event is { Records: Array<{ eventSource?: string }> } {
  return (
    typeof event === "object" &&
    event !== null &&
    "Records" in event &&
    Array.isArray((event as { Records?: unknown[] }).Records)
  );
}

function normalizeCommandName(command: unknown) {
  const commandName =
    typeof command === "object" && command !== null && "constructor" in command
      ? (command.constructor as { name?: string }).name
      : undefined;

  return (commandName ?? "UnknownCommand")
    .replace(/Command$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}
