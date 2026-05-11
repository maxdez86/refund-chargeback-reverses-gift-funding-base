import { describe, expect, it } from "vitest";
import { AsaasClient, extractAsaasErrorMessage } from "../src/services/asaas/client";

describe("extractAsaasErrorMessage", () => {
  it("prefers Asaas error descriptions over object stringification", () => {
    const message = extractAsaasErrorMessage(
      {
        errors: [
          {
            code: "invalid_object",
            description: "O valor da cobrança não pode ser menor que R$ 5,00."
          }
        ]
      },
      400
    );

    expect(message).toBe("O valor da cobrança não pode ser menor que R$ 5,00.");
  });

  it("falls back to the top-level message when no detailed errors are present", () => {
    const message = extractAsaasErrorMessage({ message: "Customer not found." }, 404);

    expect(message).toBe("Customer not found.");
  });

  it("falls back to the response status when the body is empty", () => {
    const message = extractAsaasErrorMessage({}, 500);

    expect(message).toBe("Asaas request failed with status 500.");
  });

  it("builds the public checkout url when Asaas only returns the checkout id", () => {
    const client = Object.create(AsaasClient.prototype) as AsaasClient & {
      checkoutBaseUrl: string;
    };
    client.checkoutBaseUrl = "https://www.asaas.com/checkoutSession/show";

    expect(client.buildCheckoutUrl({ id: "checkout_123" })).toBe(
      "https://www.asaas.com/checkoutSession/show/checkout_123"
    );
    expect(
      client.buildCheckoutUrl({
        id: "checkout_123",
        url: "https://www.asaas.com/checkoutSession/show/checkout_123"
      })
    ).toBe("https://www.asaas.com/checkoutSession/show/checkout_123");
  });

  it("trims trailing slashes from checkoutBaseUrl", () => {
    const client = Object.create(AsaasClient.prototype) as AsaasClient & {
      checkoutBaseUrl: string;
    };
    client.checkoutBaseUrl = "https://www.asaas.com/checkoutSession/show/";

    expect(client.buildCheckoutUrl({ id: "abc" })).toBe(
      "https://www.asaas.com/checkoutSession/show/abc"
    );
  });
});
