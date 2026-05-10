import { describe, expect, it } from "vitest";
import { extractAsaasErrorMessage } from "../src/services/asaas/client";

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
});
