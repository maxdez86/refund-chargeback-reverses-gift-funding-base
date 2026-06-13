import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { DiscardPaymentResponseSchema } from "@brimax/contracts";

const discardMock = vi.fn();
const getAppSecretMock = vi.fn();
let handler: typeof import("../src/functions/payments-discard/handler").handler;

vi.mock("../src/domain/payment-discard-service", () => ({
  PaymentDiscardService: class {
    discard = discardMock;
  }
}));

vi.mock("../src/services/secrets-manager/app-secrets", () => ({
  getAppSecret: (...args: unknown[]) => getAppSecretMock(...args)
}));

function event(paymentId?: string, idempotencyKey = " idem-1 ") {
  return {
    headers: { "idempotency-key": idempotencyKey },
    pathParameters: paymentId === undefined ? undefined : { paymentId },
    requestContext: {
      http: { method: "POST" },
      requestId: "request-1"
    }
  } as unknown as APIGatewayProxyEventV2;
}

describe("payments-discard handler", () => {
  beforeAll(async () => {
    ({ handler } = await import("../src/functions/payments-discard/handler"));
  });

  beforeEach(() => {
    discardMock.mockReset();
    getAppSecretMock.mockReset().mockResolvedValue("secret");
  });

  it("validates the payment id and forwards the trimmed idempotency key", async () => {
    discardMock.mockResolvedValue({
      ok: true,
      payment: {
        paymentId: "payment-1",
        paymentMethod: "HOSTED",
        status: "CANCELED",
        amountCents: 10_000,
        currency: "BRL",
        gift: {
          id: "gift-1",
          name: "Gift",
          fractional: false,
          quantity: 1,
          unitAmountCents: null,
          amountCents: 10_000
        },
        createdAt: "2026-06-13T10:00:00.000Z",
        updatedAt: "2026-06-13T10:01:00.000Z"
      }
    });

    const response = await handler(event("payment-1"), {} as Context, () => undefined);
    const body = JSON.parse(response.body ?? "");

    expect(discardMock).toHaveBeenCalledWith("payment-1", "idem-1");
    expect(response.statusCode).toBe(200);
    expect(DiscardPaymentResponseSchema.safeParse(body).success).toBe(true);
  });

  it("returns 400 when paymentId is blank", async () => {
    const response = await handler(event("   "), {} as Context, () => undefined);

    expect(response.statusCode).toBe(400);
    expect(discardMock).not.toHaveBeenCalled();
  });
});
