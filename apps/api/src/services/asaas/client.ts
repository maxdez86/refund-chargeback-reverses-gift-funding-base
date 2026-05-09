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
  externalReference?: string;
  description?: string;
  confirmedDate?: string | null;
  clientPaymentDate?: string | null;
  paymentDate?: string | null;
};

type AsaasPixQrCode = {
  encodedImage: string;
  payload: string;
  expirationDate?: string;
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

  async getPixQrCode(paymentId: string) {
    return this.request<AsaasPixQrCode>({
      path: `/payments/${paymentId}/pixQrCode`
    });
  }

  async listPaymentsByExternalReference(externalReference: string) {
    const response = await this.request<AsaasListResponse<AsaasPayment>>({
      path: "/payments",
      query: { externalReference }
    });

    return response.data ?? [];
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
      const message =
        String(parsed.errors ?? parsed.message ?? `Asaas request failed with status ${response.status}.`);
      throw new AppError(message, 502);
    }

    return parsed as T;
  }
}
