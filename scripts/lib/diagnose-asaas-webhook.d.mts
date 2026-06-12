export function fetchAsaasPaymentById(input: {
  apiBaseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  paymentId: string;
}): Promise<Record<string, unknown>>;

export function createAwsWebhookRepository(input: {
  documentClient?: unknown;
  tableName: string;
}): {
  getPayment(paymentId: string): Promise<Record<string, unknown> | null>;
  getPaymentByAsaasCheckoutId(asaasCheckoutId: string): Promise<Record<string, unknown> | null>;
  getPaymentByAsaasPaymentId(asaasPaymentId: string): Promise<Record<string, unknown> | null>;
  getWebhookEvent(eventId: string): Promise<Record<string, unknown> | null>;
};

export function diagnoseAsaasWebhook(input: {
  apiBaseUrl?: string;
  apiKey?: string;
  asaasPaymentId?: string;
  eventId?: string;
  fetchImpl?: typeof fetch;
  repository: {
    getPayment(paymentId: string): Promise<Record<string, unknown> | null>;
    getPaymentByAsaasCheckoutId(asaasCheckoutId: string): Promise<Record<string, unknown> | null>;
    getPaymentByAsaasPaymentId(asaasPaymentId: string): Promise<Record<string, unknown> | null>;
    getWebhookEvent(eventId: string): Promise<Record<string, unknown> | null>;
  };
  webhookEvent?: Record<string, unknown> | null;
}): Promise<{
  asaasFallbackAttempted: boolean;
  asaasPayment: Record<string, unknown> | null;
  classification: string;
  eventFound: boolean;
  eventId?: string;
  identifiers: {
    asaasPaymentId?: string;
    asaasCheckoutId?: string;
    externalReference?: string;
  };
  localLookupMatches: {
    asaasCheckoutId: boolean;
    asaasPaymentId: boolean;
    externalReference: boolean;
  };
  payment: Record<string, unknown> | null;
  recoveredIdentifiers: {
    asaasCheckoutId?: string;
    externalReference?: string;
  };
  resolutionSource: string;
  storedWebhookEvent: Record<string, unknown> | null;
}>;

export function runFromCli(input?: {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "log" | "error">;
}): Promise<{
  asaasFallbackAttempted: boolean;
  asaasPayment: Record<string, unknown> | null;
  classification: string;
  eventFound: boolean;
  eventId?: string;
  identifiers: {
    asaasPaymentId?: string;
    asaasCheckoutId?: string;
    externalReference?: string;
  };
  localLookupMatches: {
    asaasCheckoutId: boolean;
    asaasPaymentId: boolean;
    externalReference: boolean;
  };
  payment: Record<string, unknown> | null;
  recoveredIdentifiers: {
    asaasCheckoutId?: string;
    externalReference?: string;
  };
  resolutionSource: string;
  storedWebhookEvent: Record<string, unknown> | null;
}>;
