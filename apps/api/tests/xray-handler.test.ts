import type { Context } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tracerMocks = vi.hoisted(() => ({
  addErrorAsMetadata: vi.fn(),
  captureAWSv3Client: vi.fn(),
  getSegment: vi.fn(),
  putAnnotation: vi.fn(),
  setSegment: vi.fn()
}));

vi.mock("@aws-lambda-powertools/tracer", () => ({
  Tracer: class {
    addErrorAsMetadata = tracerMocks.addErrorAsMetadata;
    captureAWSv3Client = tracerMocks.captureAWSv3Client;
    getSegment = tracerMocks.getSegment;
    putAnnotation = tracerMocks.putAnnotation;
    setSegment = tracerMocks.setSegment;
  }
}));

const context = { functionName: "dev-brimax-GetGiftsFunction" } as Context;

describe("wrapLambdaTracing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("XRAY_ENABLED", "true");
    for (const mock of Object.values(tracerMocks)) {
      mock.mockReset();
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exports a two-argument handler and delegates without a callback when no segment exists", async () => {
    tracerMocks.getSegment.mockReturnValue(undefined);
    const inner = vi.fn().mockResolvedValue({ statusCode: 204 });
    const { wrapLambdaTracing } = await import("../src/lib/xray");
    const handler = wrapLambdaTracing(inner);
    const event = { requestContext: { http: {} } };

    await expect(handler(event, context)).resolves.toEqual({ statusCode: 204 });

    expect(handler).toHaveLength(2);
    expect(inner).toHaveBeenCalledWith(event, context);
  });

  it("closes its handler subsegment and restores the parent segment", async () => {
    const close = vi.fn();
    const subsegment = { close };
    const parent = { addNewSubsegment: vi.fn().mockReturnValue(subsegment) };
    tracerMocks.getSegment.mockReturnValue(parent);
    const inner = vi.fn().mockResolvedValue({ statusCode: 200 });
    const { wrapLambdaTracing } = await import("../src/lib/xray");
    const handler = wrapLambdaTracing(inner);

    await handler({ requestContext: { http: {} } }, context);

    expect(parent.addNewSubsegment).toHaveBeenCalledWith(`## ${context.functionName}`);
    expect(tracerMocks.setSegment).toHaveBeenNthCalledWith(1, subsegment);
    expect(close).toHaveBeenCalledTimes(1);
    expect(tracerMocks.setSegment).toHaveBeenLastCalledWith(parent);
  });

  it("restores the parent segment when the wrapped handler rejects", async () => {
    const close = vi.fn();
    const subsegment = { close };
    const parent = { addNewSubsegment: vi.fn().mockReturnValue(subsegment) };
    tracerMocks.getSegment.mockReturnValue(parent);
    const inner = vi.fn().mockRejectedValue(new Error("handler failed"));
    const { wrapLambdaTracing } = await import("../src/lib/xray");
    const handler = wrapLambdaTracing(inner);

    await expect(handler({}, context)).rejects.toThrow("handler failed");

    expect(close).toHaveBeenCalledTimes(1);
    expect(tracerMocks.setSegment).toHaveBeenLastCalledWith(parent);
  });
});
