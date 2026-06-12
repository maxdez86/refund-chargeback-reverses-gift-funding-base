import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Presentes } from "@/components/sections/Presentes";
import {
  LAST_PAYMENT_ID_STORAGE_KEY,
  PAYMENT_CONFIRMATION_OPEN_EVENT,
  type PaymentConfirmationOpenDetail,
} from "@/lib/payment-flow";
import { PaymentApiError } from "@/lib/payments-api";

const getGiftsMock = vi.fn();
const getPaymentMock = vi.fn();
const createPaymentMock = vi.fn();

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), null],
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial: _initial,
      whileInView: _whileInView,
      viewport: _viewport,
      transition: _transition,
      ...props
    }: ComponentProps<"div"> & {
      initial?: unknown;
      whileInView?: unknown;
      viewport?: unknown;
      transition?: unknown;
    }) => <div {...props}>{children}</div>,
  },
}));

vi.mock("@/components/ResponsivePhoto", () => ({
  ResponsivePhoto: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

vi.mock("@/lib/gifts-api", () => ({
  giftsQueryKey: ["gifts"],
  getGifts: (...args: unknown[]) => getGiftsMock(...args),
}));

vi.mock("@/lib/payments-api", () => ({
  PaymentApiError: class PaymentApiError extends Error {
    constructor(message: string, readonly status?: number) {
      super(message);
      this.name = "PaymentApiError";
    }
  },
  createPayment: (...args: unknown[]) => createPaymentMock(...args),
  getPayment: (...args: unknown[]) => getPaymentMock(...args),
}));

function makeGift(overrides: Record<string, unknown> = {}) {
  return {
    id: "g-test",
    name: "Jogo de Taças",
    image: "g-tacas",
    fractional: false,
    totalValueCents: 25000,
    partValueCents: null,
    totalParts: null,
    finalPartValueCents: null,
    fundingModelVersion: "EXACT_FINAL_QUOTA",
    partsFunded: 0,
    partsReserved: 0,
    confirmedAmountCents: 0,
    reservedAmountCents: 0,
    availableAmountCents: 25000,
    availableParts: 1,
    fullyFunded: false,
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  };
}

function makePaymentSummary(status: string, overrides: Record<string, unknown> = {}) {
  return {
    paymentId: "payment-1",
    paymentMethod: "HOSTED",
    status,
    amountCents: 25000,
    currency: "BRL",
    gift: {
      id: "g-test",
      name: "Jogo de Taças",
      fractional: false,
      quantity: 1,
      unitAmountCents: null,
      amountCents: 25000,
    },
    checkout: {
      sessionId: "session-1",
      url: "https://www.asaas.com/checkout/session-1",
    },
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:05.000Z",
    ...overrides,
  };
}

function storePendingPayment(overrides: Record<string, unknown> = {}) {
  window.localStorage.setItem(
    LAST_PAYMENT_ID_STORAGE_KEY,
    JSON.stringify({
      paymentId: "payment-1",
      createdAt: Date.now(),
      giftName: "Jogo de Taças",
      amountCents: 25000,
      checkoutUrl: "https://www.asaas.com/checkout/session-1",
      ...overrides,
    })
  );
}

describe("Presentes", () => {
  const originalLocation = window.location;

  function dispatchPageShow(persisted: boolean) {
    const event = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(event, "persisted", {
      configurable: true,
      value: persisted,
    });
    window.dispatchEvent(event);
  }

  function renderPresentes() {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Presentes />
      </QueryClientProvider>
    );

    return queryClient;
  }

  beforeEach(() => {
    getGiftsMock.mockReset();
    getPaymentMock.mockReset();
    createPaymentMock.mockReset();
    getGiftsMock.mockResolvedValue([makeGift()]);
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        href: "http://localhost/",
        hash: "",
      },
    });
  });

  it("shows the recovery surface when there is a stored pending payment", async () => {
    storePendingPayment();
    getPaymentMock.mockResolvedValue(makePaymentSummary("AWAITING_PAYMENT"));

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByText("Pagamento em andamento")).toBeInTheDocument();
    });
    expect(screen.getByText(/você iniciou um pagamento e pode retomá-lo quando quiser/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar pagamento" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument();
  });

  it("clears the stored payment when the guest discards recovery", async () => {
    storePendingPayment();
    getPaymentMock.mockResolvedValue(makePaymentSummary("AWAITING_PAYMENT"));

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByText("Pagamento em andamento")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    await waitFor(() => {
      expect(screen.queryByText("Pagamento em andamento")).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(LAST_PAYMENT_ID_STORAGE_KEY)).toBeNull();
  });

  it("reopens the checkout when the stored payment is still pending", async () => {
    storePendingPayment();
    getPaymentMock.mockResolvedValue(makePaymentSummary("AWAITING_PAYMENT"));

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByText("Pagamento em andamento")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Continuar pagamento" }));

    await waitFor(() => {
      expect(window.location.href).toBe("https://www.asaas.com/checkout/session-1");
    });
    expect(getPaymentMock).toHaveBeenCalledWith("payment-1");
  });

  it("closes the gift modal on pageshow back-return and keeps the recovery banner", async () => {
    createPaymentMock.mockResolvedValue(makePaymentSummary("CREATED"));
    getPaymentMock.mockResolvedValue(makePaymentSummary("AWAITING_PAYMENT"));

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Escolher presente" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Escolher presente" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ir para o pagamento" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Ir para o pagamento" }));

    await waitFor(() => {
      expect(screen.getByText("Redirecionando para a Asaas…")).toBeInTheDocument();
    });

    window.history.replaceState({}, "", "/#presentes");
    act(() => {
      dispatchPageShow(true);
    });

    await waitFor(() => {
      expect(screen.queryByText("Redirecionando para a Asaas…")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Pagamento em andamento")).toBeInTheDocument();
  });

  it("does not treat fresh cancel callback pageshow as browser-back cleanup", async () => {
    renderPresentes();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Escolher presente" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Escolher presente" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ir para o pagamento" })).toBeInTheDocument();
    });

    window.history.replaceState({}, "", "/#paymentId=payment-1&paymentStatus=cancel");
    act(() => {
      dispatchPageShow(false);
    });

    expect(screen.getByRole("button", { name: "Ir para o pagamento" })).toBeInTheDocument();
  });

  it("does not treat fresh success callback pageshow as browser-back cleanup", async () => {
    renderPresentes();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Escolher presente" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Escolher presente" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ir para o pagamento" })).toBeInTheDocument();
    });

    window.history.replaceState({}, "", "/#paymentId=payment-1&paymentStatus=success");
    act(() => {
      dispatchPageShow(false);
    });

    expect(screen.getByRole("button", { name: "Ir para o pagamento" })).toBeInTheDocument();
  });

  it("removes the recovery surface when resume finds the payment canceled", async () => {
    storePendingPayment();
    getPaymentMock
      .mockResolvedValueOnce(makePaymentSummary("AWAITING_PAYMENT"))
      .mockResolvedValueOnce(makePaymentSummary("CANCELED", { checkout: undefined }));

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByText("Pagamento em andamento")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(getPaymentMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continuar pagamento" }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Pagamento em andamento")).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(LAST_PAYMENT_ID_STORAGE_KEY)).toBeNull();
  });

  it("renders a fully reserved gift as reserved, not purchased", async () => {
    getGiftsMock.mockResolvedValue([
      makeGift({
        partsReserved: 1,
        reservedAmountCents: 25000,
        availableAmountCents: 0,
        availableParts: 0,
        fullyFunded: true,
      }),
    ]);

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reservado no momento" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Reservado no momento" })).toBeDisabled();
    expect(screen.queryByText("Presente já garantido")).not.toBeInTheDocument();
  });

  it("renders a confirmed gift with the purchased treatment", async () => {
    getGiftsMock.mockResolvedValue([
      makeGift({
        partsFunded: 1,
        confirmedAmountCents: 25000,
        availableAmountCents: 0,
        availableParts: 0,
        fullyFunded: true,
      }),
    ]);

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Presente já garantido" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Presente já garantido" })).toBeDisabled();
    expect(screen.queryByText("Reservado no momento")).not.toBeInTheDocument();
  });

  it("auto-removes the recovery surface on mount when the stored payment is canceled", async () => {
    storePendingPayment();
    getPaymentMock.mockResolvedValue(makePaymentSummary("CANCELED", { checkout: undefined }));

    const queryClient = renderPresentes();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() => {
      expect(window.localStorage.getItem(LAST_PAYMENT_ID_STORAGE_KEY)).toBeNull();
    });
    await waitFor(() => {
      expect(screen.queryByText("Pagamento em andamento")).not.toBeInTheDocument();
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["gifts"] });
  });

  it("reconciles on pageshow back-navigation and removes a canceled payment", async () => {
    getPaymentMock.mockResolvedValue(makePaymentSummary("CANCELED", { checkout: undefined }));

    const queryClient = renderPresentes();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Escolher presente" })).toBeInTheDocument();
    });
    expect(getPaymentMock).not.toHaveBeenCalled();

    storePendingPayment();
    act(() => {
      dispatchPageShow(true);
    });

    await waitFor(() => {
      expect(window.localStorage.getItem(LAST_PAYMENT_ID_STORAGE_KEY)).toBeNull();
    });
    expect(screen.queryByText("Pagamento em andamento")).not.toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["gifts"] });
  });

  it("keeps the banner when reconciliation finds the payment still pending", async () => {
    getPaymentMock.mockResolvedValue(makePaymentSummary("AWAITING_PAYMENT"));

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Escolher presente" })).toBeInTheDocument();
    });

    storePendingPayment();
    act(() => {
      dispatchPageShow(true);
    });

    await waitFor(() => {
      expect(getPaymentMock).toHaveBeenCalledWith("payment-1");
    });
    expect(screen.getByText("Pagamento em andamento")).toBeInTheDocument();
    expect(window.localStorage.getItem(LAST_PAYMENT_ID_STORAGE_KEY)).not.toBeNull();
  });

  it("opens the success dialog when reconciliation finds the payment confirmed", async () => {
    getPaymentMock.mockResolvedValue(makePaymentSummary("CONFIRMED"));
    const confirmationListener = vi.fn();
    window.addEventListener(PAYMENT_CONFIRMATION_OPEN_EVENT, confirmationListener);

    try {
      renderPresentes();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Escolher presente" })).toBeInTheDocument();
      });

      storePendingPayment();
      act(() => {
        dispatchPageShow(true);
      });

      await waitFor(() => {
        expect(confirmationListener).toHaveBeenCalledTimes(1);
      });
      const event = confirmationListener.mock.calls[0][0] as CustomEvent<PaymentConfirmationOpenDetail>;
      expect(event.detail).toEqual({ paymentId: "payment-1", paymentStatus: "success" });
      expect(window.localStorage.getItem(LAST_PAYMENT_ID_STORAGE_KEY)).toBeNull();
    } finally {
      window.removeEventListener(PAYMENT_CONFIRMATION_OPEN_EVENT, confirmationListener);
    }
  });

  it("deduplicates popstate and pageshow firing on a single back-navigation", async () => {
    getPaymentMock.mockResolvedValue(makePaymentSummary("AWAITING_PAYMENT"));

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Escolher presente" })).toBeInTheDocument();
    });

    storePendingPayment();
    act(() => {
      window.dispatchEvent(new Event("popstate"));
      dispatchPageShow(true);
    });

    await waitFor(() => {
      expect(getPaymentMock).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getPaymentMock).toHaveBeenCalledTimes(1);
  });

  it("skips reconciliation when an Asaas callback hash is present", async () => {
    storePendingPayment();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        href: "http://localhost/#paymentId=payment-1&paymentStatus=cancel",
        hash: "#paymentId=payment-1&paymentStatus=cancel",
      },
    });

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Escolher presente" })).toBeInTheDocument();
    });
    expect(getPaymentMock).not.toHaveBeenCalled();
  });

  it("clears storage when resume finds the payment gone (404)", async () => {
    storePendingPayment();
    getPaymentMock
      .mockResolvedValueOnce(makePaymentSummary("AWAITING_PAYMENT"))
      .mockRejectedValueOnce(new PaymentApiError("Pagamento não encontrado.", 404));

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByText("Pagamento em andamento")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(getPaymentMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continuar pagamento" }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Pagamento em andamento")).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(LAST_PAYMENT_ID_STORAGE_KEY)).toBeNull();
  });

  it("keeps the banner when reconciliation fails with a network error", async () => {
    storePendingPayment();
    getPaymentMock.mockRejectedValue(new Error("network down"));

    renderPresentes();

    await waitFor(() => {
      expect(getPaymentMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("Pagamento em andamento")).toBeInTheDocument();
    expect(window.localStorage.getItem(LAST_PAYMENT_ID_STORAGE_KEY)).not.toBeNull();
  });
});
