import { describe, expect, it, vi } from "vitest";
import type { Context } from "aws-lambda";
import { isWarmupEvent, withWarmup } from "../src/lib/warmup";

const context = {} as Context;
const callback = () => undefined;

describe("isWarmupEvent", () => {
  it("matches the EventBridge keep-warm payload", () => {
    expect(isWarmupEvent({ warmer: true })).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isWarmupEvent({ warmer: false })).toBe(false);
    expect(isWarmupEvent({ warmer: "true" })).toBe(false);
    expect(isWarmupEvent({ headers: {} })).toBe(false);
    expect(isWarmupEvent(null)).toBe(false);
    expect(isWarmupEvent(undefined)).toBe(false);
  });
});

describe("withWarmup", () => {
  it("short-circuits a warm ping without calling the handler and runs onWarm", async () => {
    const inner = vi.fn();
    const onWarm = vi.fn().mockResolvedValue(undefined);
    const handler = withWarmup(inner, onWarm);

    const response = await handler({ warmer: true }, context, callback);

    expect(inner).not.toHaveBeenCalled();
    expect(onWarm).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ statusCode: 200, body: "warm" });
  });

  it("swallows an onWarm failure and still returns 200", async () => {
    const inner = vi.fn();
    const onWarm = vi.fn().mockRejectedValue(new Error("prime failed"));
    const handler = withWarmup(inner, onWarm);

    const response = await handler({ warmer: true }, context, callback);

    expect(inner).not.toHaveBeenCalled();
    expect(response).toEqual({ statusCode: 200, body: "warm" });
  });

  it("handles a warm ping without an onWarm primer", async () => {
    const inner = vi.fn();
    const handler = withWarmup(inner);

    const response = await handler({ warmer: true }, context, callback);

    expect(inner).not.toHaveBeenCalled();
    expect(response).toEqual({ statusCode: 200, body: "warm" });
  });

  it("delegates non-warm events through unchanged", async () => {
    const inner = vi.fn().mockResolvedValue({ statusCode: 204 });
    const onWarm = vi.fn();
    const handler = withWarmup(inner, onWarm);
    const event = { headers: {}, pathParameters: { code: "ABC" } };

    const response = await handler(event, context, callback);

    expect(onWarm).not.toHaveBeenCalled();
    expect(inner).toHaveBeenCalledWith(event, context, callback);
    expect(response).toEqual({ statusCode: 204 });
  });
});
