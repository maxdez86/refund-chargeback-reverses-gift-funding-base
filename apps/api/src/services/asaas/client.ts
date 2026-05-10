import { getEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { getSecretValue } from "../secrets-manager/secret-cache";

type AsaasCustomer = {
  id: string;
};

type AsaasPayment = {
  id: string;
  billingType: "PIX" | "CREDIT_CARD";
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
type AsaasCheckoutChargeType = "DETACHED";

type CreateCheckoutInput = {
  customer: string;
  billingTypes: AsaasCheckoutBillingType[];
  chargeTypes: AsaasCheckoutChargeType[];
  callback: {
    successUrl: string;
    cancelUrl: string;
    expiredUrl: string;
  };
  items: Array<{
    name: string;
    description: string;
    quantity: number;
    value: number;
  }>;
  minutesToExpire: number;
};

function parseSecretString(value: string) {
  if (!value) {
    return "";
  }

  try {
    const parsed = JSON.parse(value) as { value?: string; token?: string; apiKey?: string };
    return parsed.value ?? parsed.token ?? parsed.apiKey ?? value;
  } catch {
    return value;
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
  private readonly apiSecretArn = getEnv().asaasApiSecretArn;

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

  async createPayment(input: {
    customer: string;
    billingType: "PIX" | "CREDIT_CARD";
    value: number;
    dueDate: string;
    description: string;
    externalReference: string;
  }) {
    return this.request<AsaasPayment>({
      method: "POST",
      path: "/payments",
      body: input
    });
  }

  async createCheckout(input: CreateCheckoutInput) {
    return this.request<AsaasCheckout>({
      method: "POST",
      path: "/checkouts",
      body: input
    });
  }

  async listPaymentsByExternalReference(externalReference: string) {
    const response = await this.request<AsaasListResponse<AsaasPayment>>({
      path: "/payments",
      query: { externalReference }
    });

    return response.data ?? [];
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

    return `${this.apiBaseUrl.replace(/\/v3\/?$/, "")}/c/${checkout.id}`;
  }

  private async request<T>({ method = "GET", path, body, query }: RequestOptions): Promise<T> {
    const apiKey = parseSecretString(await getSecretValue(this.apiSecretArn));

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
      throw new AppError(message, 502);
    }

    return parsed as T;
  }
}

export { extractAsaasErrorMessage };
export type { AsaasCheckout, AsaasPayment, CreateCheckoutInput };
