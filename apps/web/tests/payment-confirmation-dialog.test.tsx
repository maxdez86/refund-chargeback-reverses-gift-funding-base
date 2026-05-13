import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentConfirmationDialog } from "@/components/PaymentConfirmationDialog";
import { LAST_PAYMENT_ID_STORAGE_KEY } from "@/lib/payment-flow";

const getPaymentMock = vi.fn();
const createPaymentMessageMock = vi.fn();

vi.mock("@/lib/payments-api", () => ({
  PaymentApiError: class PaymentApiError extends Error {
    constructor(message: string, readonly status?: number) {
      super(message);
      this.name = "PaymentApiError";
    }
  },
  getPayment: (...args: unknown[]) => getPaymentMock(...args),
  createPaymentMessage: (...args: unknown[]) => createPaymentMessageMock(...args),
}));

describe("PaymentConfirmationDialog", () => {
  beforeEach(() => {
    getPaymentMock.mockReset();
    createPaymentMessageMock.mockReset();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("shows pending first for success redirects and flips to success after confirmation", async () => {
    getPaymentMock
      .mockResolvedValueOnce({
        paymentId: "payment-1",
        paymentMethod: "HOSTED",
        status: "CREATED",
        amountCents: 500,
        currency: "BRL",
        gift: {
          id: "g-test-pix",
          name: "PIX Teste",
          fractional: false,
          quantity: 1,
          unitAmountCents: null,
          amountCents: 500,
        },
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        paymentId: "payment-1",
        paymentMethod: "HOSTED",
        status: "CONFIRMED",
        amountCents: 500,
        currency: "BRL",
        gift: {
          id: "g-test-pix",
          name: "PIX Teste",
          fractional: false,
          quantity: 1,
          unitAmountCents: null,
          amountCents: 500,
        },
        createdAt: "2026-05-12T00:00:00.000Z",
        updatedAt: "2026-05-12T00:00:05.000Z",
        customerProfileStatus: "READY",
        payerFirstName: "MARIA",
      });

    window.history.replaceState({}, "", "/?paymentId=payment-1&paymentStatus=success");

    render(<PaymentConfirmationDialog />);

    await waitFor(() => {
      expect(screen.getByText("Confirmando seu pagamento…")).toBeInTheDocument();
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 2_100));
    });

    await waitFor(() => {
      expect(screen.getByText("Presente recebido!")).toBeInTheDocument();
    });
    expect(screen.getByText(/Maria, sua contribuição foi confirmada/i)).toBeInTheDocument();
  }, 10_000);

  it("recovers the last payment from localStorage on cold load", async () => {
    getPaymentMock.mockResolvedValue({
      paymentId: "payment-recovery-1",
      paymentMethod: "HOSTED",
      status: "RECEIVED",
      amountCents: 500,
      currency: "BRL",
      gift: {
        id: "g-test-pix",
        name: "PIX Teste",
        fractional: false,
        quantity: 1,
        unitAmountCents: null,
        amountCents: 500,
      },
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:05.000Z",
      customerProfileStatus: "READY",
    });

    window.localStorage.setItem(
      LAST_PAYMENT_ID_STORAGE_KEY,
      JSON.stringify({ paymentId: "payment-recovery-1", createdAt: Date.now() })
    );

    render(<PaymentConfirmationDialog />);

    await waitFor(() => {
      expect(screen.getByText("Presente recebido!")).toBeInTheDocument();
    });
    expect(screen.getByText(/payment-recovery-1/)).toBeInTheDocument();
  });
});
