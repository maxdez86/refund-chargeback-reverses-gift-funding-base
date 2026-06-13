import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, SQSEvent } from "aws-lambda";

const sweepMock = vi.fn();

vi.mock("../src/domain/checkout-expiry", () => ({
  sweepStaleCheckouts: (...args: unknown[]) => sweepMock(...args)
}));

// Avoid the real repository constructor touching env / AWS at module load.
vi.mock("../src/services/dynamodb/repositories/payment-repository", () => ({
  PaymentRepository: class {}
}));

let handler: typeof import("../src/functions/checkout-expiry-worker/handler").handler;

const context = {} as Context;
const callback = () => undefined;

function emptySummary(overrides: Record<string, unknown> = {}) {
  return {
    scanned: 0,
    released: 0,
    raceLost: 0,
    protected: 0,
    missingContext: 0,
    failedIds: [],
    oldestStaleAgeMs: 0,
    ...overrides
  };
}

function eventWith(body: string): SQSEvent {
  return { Records: [{ body }] } as unknown as SQSEvent;
}

describe("checkout-expiry-worker handler", () => {
  beforeAll(async () => {
    ({ handler } = await import("../src/functions/checkout-expiry-worker/handler"));
  });

  beforeEach(() => {
    sweepMock.mockReset().mockResolvedValue(emptySummary());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the sweep with the worker limit/concurrency and logs completion", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    sweepMock.mockResolvedValue(emptySummary({ scanned: 2, released: 2, oldestStaleAgeMs: 1_000 }));

    await handler(eventWith(JSON.stringify({ source: "gifts" })), context, callback);

    expect(sweepMock).toHaveBeenCalledWith(expect.anything(), expect.any(Number), {
      limit: 100,
      concurrency: 4
    });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"CHECKOUT_EXPIRY_SWEEP_COMPLETED\"")
    );
  });

  it("throws when the sweep reports retryable failures so SQS retries", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    sweepMock.mockResolvedValue(emptySummary({ scanned: 1, failedIds: ["payment-1"] }));

    await expect(
      handler(eventWith(JSON.stringify({ source: "schedule" })), context, callback)
    ).rejects.toThrow(/retryable failure/);
  });

  it("warns on protected-stale reservations but does not throw", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sweepMock.mockResolvedValue(emptySummary({ scanned: 2, protected: 2 }));

    await expect(
      handler(eventWith(JSON.stringify({ source: "schedule" })), context, callback)
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"CHECKOUT_EXPIRY_PROTECTED_STALE\"")
    );
  });

  it("warns when the sweep hits the candidate cap", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    sweepMock.mockResolvedValue(emptySummary({ scanned: 100, released: 100 }));

    await handler(eventWith(JSON.stringify({ source: "schedule" })), context, callback);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"CHECKOUT_EXPIRY_SWEEP_CAP_HIT\"")
    );
  });

  it("defaults the source to schedule for an unparseable body", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await handler(eventWith("not-json"), context, callback);

    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("\"source\":\"schedule\""));
  });
});
