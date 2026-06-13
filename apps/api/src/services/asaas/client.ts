import { getEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { getAppSecretWithMetadata } from "../secrets-manager/app-secrets";

type AsaasCustomer = {
  id: string;
  name?: string;
  email?: string;
};

type AsaasPayment = {
  id: string;
  billingType: "PIX" | "CREDIT_CARD";
  customer?: string;
  status: string;
  value: number;
  invoiceUrl?: string;
  checkoutSession?: string;
  externalReference?: string;
  description?: string;
  confirmedDate?: string | null;
  clientPaymentDate?: string | null;
  paymentDate?: string | null;
};

type AsaasCheckout = {
  id: string;
  url?: string;
};

type AsaasCheckoutSession = {
  id: string;
  status?: "ACTIVE" | "CANCELED" | "EXPIRED" | "PAID";
  externalReference?: string;
  callback?: {
    successUrl?: string;
    cancelUrl?: string;
    expiredUrl?: string;
  };
};

type AsaasListResponse<T> = {
  data?: T[];
};

type RequestOptions = {
  method?: string;
  path: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
};

type AsaasErrorItem = {
  code?: string;
  description?: string;
};

type AsaasCheckoutBillingType = "PIX" | "CREDIT_CARD";
type AsaasCheckoutChargeType = "DETACHED" | "INSTALLMENT";

type CreateCheckoutInput = {
  billingTypes: AsaasCheckoutBillingType[];
  chargeTypes: AsaasCheckoutChargeType[];
  callback: {
    successUrl: string;
    cancelUrl: string;
    expiredUrl: string;
  };
  customerData?: {
    email: string;
  };
  externalReference: string;
  items: Array<{
    name: string;
    description: string;
    quantity: number;
    value: number;
  }>;
  installment?: {
    maxInstallmentCount: number;
  };
  minutesToExpire: number;
};

// Callers surface this as a 502 (Asaas is our upstream), but keep the original
// Asaas response status so "this id does not exist" (404) can be told apart
// from a real outage.
export class AsaasApiError extends AppError {
  constructor(
    message: string,
    readonly upstreamStatus: number
  ) {
    super(message, 502);
    this.name = "AsaasApiError";
  }
}

function extractAsaasErrorMessage(parsed: Record<string, unknown>, responseStatus: number) {
  const errors = Array.isArray(parsed.errors) ? (parsed.errors as AsaasErrorItem[]) : [];
  const descriptions = errors
    .map((error) => error.description?.trim())
    .filter((description): description is string => Boolean(description));

  if (descriptions.length > 0) {
    return descriptions.join(" | ");
  }

  if (typeof parsed.message === "string" && parsed.message.trim()) {
    return parsed.message;
  }

  return `Asaas request failed with status ${responseStatus}.`;
}

export class AsaasClient {
  private readonly apiBaseUrl = getEnv().asaasApiBaseUrl;
  private readonly checkoutBaseUrl = getEnv().asaasCheckoutBaseUrl;

  async findCustomerByCpf(cpfCnpj: string) {
    const response = await this.request<AsaasListResponse<AsaasCustomer>>({
      path: "/customers",
      query: { cpfCnpj }
    });

    return response.data?.[0] ?? null;
  }

  async createCustomer(input: {
    name: string;
    email: string;
    cpfCnpj: string;
    mobilePhone?: string;
    externalReference?: string;
  }) {
    return this.request<AsaasCustomer>({
      method: "POST",
      path: "/customers",
      body: {
        ...input,
        notificationDisabled: true
      }
    });
  }

  async createCheckout(input: CreateCheckoutInput) {
    return this.request<AsaasCheckout>({
      method: "POST",
      path: "/checkouts",
      body: input
    });
  }

  async cancelCheckout(checkoutId: string) {
    return this.request<AsaasCheckoutSession>({
      method: "POST",
      path: `/checkouts/${encodeURIComponent(checkoutId)}/cancel`,
      body: {}
    });
  }

  async listPaymentsByExternalReference(externalReference: string) {
    const response = await this.request<AsaasListResponse<AsaasPayment>>({
      path: "/payments",
      query: { externalReference }
    });

    return response.data ?? [];
  }

  async getPaymentById(paymentId: string) {
    return this.requestNullableOn404<AsaasPayment>({
      path: `/payments/${paymentId}`
    });
  }

  async getCustomerById(customerId: string) {
    return this.request<AsaasCustomer>({
      path: `/customers/${customerId}`
    });
  }

  async getCheckoutById(checkoutId: string) {
    return this.requestNullableOn404<AsaasCheckoutSession>({
      path: `/checkouts/${checkoutId}`
    });
  }

  async listPaymentsByCheckoutSession(checkoutSession: string) {
    const response = await this.request<AsaasListResponse<AsaasPayment>>({
      path: "/payments",
      query: { checkoutSession }
    });

    return response.data ?? [];
  }

  buildCheckoutUrl(checkout: AsaasCheckout) {
    if (checkout.url?.trim()) {
      return checkout.url;
    }

    return `${this.checkoutBaseUrl.replace(/\/+$/, "")}/${checkout.id}`;
  }

  // Asaas answers 404 for ids that don't exist in this environment (purged
  // sandbox data, ids from another environment). For lookups where absence is
  // a legitimate answer, surface null instead of an error.
  private async requestNullableOn404<T>(options: RequestOptions): Promise<T | null> {
    try {
      return await this.request<T>(options);
    } catch (error) {
      if (error instanceof AsaasApiError && error.upstreamStatus === 404) {
        return null;
      }

      throw error;
    }
  }

  private async request<T>({ method = "GET", path, body, query }: RequestOptions): Promise<T> {
    const startedAt = Date.now();
    const { cacheHit, value: apiKey } = await getAppSecretWithMetadata("asaasApiKey");

    if (!apiKey) {
      throw new AppError("Asaas API secret is empty.", 500);
    }

    const url = new URL(`${this.apiBaseUrl}${path}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value) {
          url.searchParams.set(key, value);
        }
      }
    }

    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          access_token: apiKey
        },
        body: body ? JSON.stringify(body) : undefined
      });

      const text = await response.text();
      const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};

      if (!response.ok) {
        const message = extractAsaasErrorMessage(parsed, response.status);
        throw new AsaasApiError(message, response.status);
      }

      return parsed as T;
    } finally {
      if (path === "/checkouts" || path.endsWith("/cancel")) {
        console.info(
          JSON.stringify({
            metric: "ASAAS_REQUEST_TIMING",
            asaasPath: path,
            durationMs: Date.now() - startedAt,
            method,
            secretCacheHit: cacheHit
          })
        );
      }
    }
  }
}

export { extractAsaasErrorMessage };
export type { AsaasCheckout, AsaasCheckoutSession, AsaasPayment, CreateCheckoutInput };
