import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/client-sqs", () => ({
  SendMessageCommand: class {},
  SQSClient: class {}
}));
vi.mock("@aws-lambda-powertools/tracer", () => ({
  Tracer: class {
    getSegment() {
      return undefined;
    }
  }
}));
vi.mock("@sentry/aws-serverless", () => ({
  isInitialized: vi.fn().mockReturnValue(false),
  wrapHandler: vi.fn()
}));

vi.mock("../src/domain/checkout-expiry", () => ({ sweepStaleCheckouts: vi.fn() }));
vi.mock("../src/domain/gift-service", () => ({ GiftService: class {} }));
vi.mock("../src/domain/guest-message-service", () => ({ GuestMessageService: class {} }));
vi.mock("../src/domain/invitation-service", () => ({ InvitationService: class {} }));
vi.mock("../src/domain/payment-discard-service", () => ({ PaymentDiscardService: class {} }));
vi.mock("../src/domain/payment-message-service", () => ({ PaymentMessageService: class {} }));
vi.mock("../src/domain/payment-service", () => ({ PaymentService: class {} }));
vi.mock("../src/domain/rsvp-service", () => ({ RsvpService: class {} }));
vi.mock("../src/domain/webhook-processor", () => ({ WebhookProcessor: class {} }));
vi.mock("../src/services/dynamodb/repositories/payment-repository", () => ({
  PaymentRepository: class {}
}));
vi.mock("../src/services/email/client", () => ({ EmailService: class {} }));

const handlerModules = [
  ["AdminAuthorizerFunction", () => import("../src/functions/admin-authorizer/handler")],
  ["AdminSessionFunction", () => import("../src/functions/admin-session/handler")],
  ["AsaasWebhookFunction", () => import("../src/functions/asaas-webhook/handler")],
  ["AsaasWebhookProcessorFunction", () => import("../src/functions/asaas-webhook-processor/handler")],
  ["CheckoutExpiryWorkerFunction", () => import("../src/functions/checkout-expiry-worker/handler")],
  ["CreateGuestMessagesFunction", () => import("../src/functions/guest-messages-create/handler")],
  ["CreatePaymentFunction", () => import("../src/functions/payments-create/handler")],
  ["DeleteGuestMessageFunction", () => import("../src/functions/admin-guest-message-delete/handler")],
  ["DiscardPaymentFunction", () => import("../src/functions/payments-discard/handler")],
  ["GetGiftsFunction", () => import("../src/functions/gifts-get/handler")],
  ["GetGuestMessagesFunction", () => import("../src/functions/guest-messages-get/handler")],
  ["GetPaymentFunction", () => import("../src/functions/payments-get/handler")],
  ["GuestMessageNotifyFunction", () => import("../src/functions/guest-message-notify/handler")],
  ["InvitationGetFunction", () => import("../src/functions/invitation-get/handler")],
  ["PaymentMessageFunction", () => import("../src/functions/payments-message/handler")],
  ["RsvpFunction", () => import("../src/functions/rsvp/handler")]
] as const;

describe("Node.js 24 Lambda handler signatures", () => {
  beforeAll(() => {
    // Exercise the branch that cannot rely on Sentry to normalize handler arity.
    vi.stubEnv("STAGE", "test");
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("WEDDING_TABLE_NAME", "test-wedding-table");
    vi.stubEnv("XRAY_ENABLED", "false");
    vi.resetModules();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  for (const [functionName, loadModule] of handlerModules) {
    it(`${functionName} exports a Node.js 24-compatible handler`, async () => {
      const { handler } = await loadModule();

      expect(handler).toBeTypeOf("function");
      expect(handler.length).toBeLessThanOrEqual(2);
    });
  }
});
