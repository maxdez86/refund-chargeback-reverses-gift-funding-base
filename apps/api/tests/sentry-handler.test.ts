import type { Context } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
  isInitialized: vi.fn(),
  wrapHandler: vi.fn()
}));

vi.mock("@sentry/aws-serverless", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  consoleLoggingIntegration: vi.fn(),
  init: vi.fn(),
  isInitialized: sentryMocks.isInitialized,
  withScope: vi.fn(),
  wrapHandler: sentryMocks.wrapHandler
}));

const context = { functionName: "dev-brimax-TestFunction" } as Context;

describe("wrapLambdaHandler", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("XRAY_ENABLED", "false");
    sentryMocks.isInitialized.mockReset().mockReturnValue(true);
    sentryMocks.wrapHandler.mockReset().mockImplementation(
      (inner: (event: unknown, context: Context) => Promise<unknown>) =>
        async (event: unknown, lambdaContext: Context) => inner(event, lambdaContext)
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a two-argument traced handler when Sentry is disabled", async () => {
    vi.stubEnv("STAGE", "test");
    vi.stubEnv("SENTRY_DSN", "");
    const inner = vi.fn().mockResolvedValue({ statusCode: 204 });
    const { wrapLambdaHandler } = await import("../src/lib/sentry");
    const handler = wrapLambdaHandler(inner);
    const event = { requestContext: { http: {} } };

    await expect(handler(event, context)).resolves.toEqual({ statusCode: 204 });

    expect(handler).toHaveLength(2);
    expect(inner).toHaveBeenCalledWith(event, context);
    expect(sentryMocks.wrapHandler).not.toHaveBeenCalled();
  });

  it("preserves the two-argument contract when Sentry is enabled", async () => {
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("SENTRY_DSN", "https://public@example.invalid/1");
    const inner = vi.fn().mockResolvedValue({ statusCode: 200 });
    const { wrapLambdaHandler } = await import("../src/lib/sentry");
    const handler = wrapLambdaHandler(inner);
    const event = { requestContext: { http: {} } };

    await expect(handler(event, context)).resolves.toEqual({ statusCode: 200 });

    expect(handler).toHaveLength(2);
    expect(sentryMocks.wrapHandler).toHaveBeenCalledWith(expect.any(Function), {
      captureAllSettledReasons: false,
      captureTimeoutWarning: false,
      flushTimeout: 2000
    });
  });
});
