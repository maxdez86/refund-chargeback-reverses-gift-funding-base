import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAppSecretMock = vi.fn();
const recordWebhookEventIfNewMock = vi.fn();
const sqsSendMock = vi.fn();

vi.mock("../src/services/secrets-manager/app-secrets", () => ({
  getAppSecret: (...args: unknown[]) => getAppSecretMock(...args)
}));

vi.mock("../src/services/dynamodb/repositories/payment-repository", () => ({
  PaymentRepository: class {
    recordWebhookEventIfNew = recordWebhookEventIfNewMock;
  }
}));

vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: class {
    send = sqsSendMock;
  },
  SendMessageCommand: class {
    constructor(public readonly input: unknown) {}
  }
}));

process.env.WEDDING_TABLE_NAME = "test-wedding-table";
process.env.WEBHOOK_QUEUE_URL = "https://sqs.test/queue";

const webhookToken = "stage-webhook-token";

function buildEvent(body: string | undefined) {
  return {
    body,
    headers: { "asaas-access-token": webhookToken },
    isBase64Encoded: false,
    requestContext: {
      http: { method: "POST" },
      requestId: "request-1"
    }
  } as unknown as APIGatewayProxyEventV2;
}

describe("asaas webhook ingress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppSecretMock.mockResolvedValue(webhookToken);
    recordWebhookEventIfNewMock.mockResolvedValue(true);
    sqsSendMock.mockResolvedValue({});
  });

  // An empty body used to be coerced to "{}", stored as an UNKNOWN event and
  // enqueued as a message no redelivery could resolve, which poisoned the DLQ.
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace only", "   \n"]
  ])("rejects a %s body without recording or enqueuing anything", async (_label, body) => {
    const { handler } = await import("../src/functions/asaas-webhook/handler");
    const response = await handler(buildEvent(body as string | undefined), {} as never, () => {});

    expect(response).toEqual(expect.objectContaining({ statusCode: 400 }));
    expect(recordWebhookEventIfNewMock).not.toHaveBeenCalled();
    expect(sqsSendMock).not.toHaveBeenCalled();
  });

  it("still accepts and enqueues a well-formed payload", async () => {
    const { handler } = await import("../src/functions/asaas-webhook/handler");
    const response = await handler(
      buildEvent(JSON.stringify({ event: "PAYMENT_RECEIVED", payment: { id: "pay_1" } })),
      {} as never,
      () => {}
    );

    expect(response).toEqual(expect.objectContaining({ statusCode: 200 }));
    expect(recordWebhookEventIfNewMock).toHaveBeenCalledTimes(1);
    expect(sqsSendMock).toHaveBeenCalledTimes(1);
  });
});
