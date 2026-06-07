import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Presentes } from "@/components/sections/Presentes";
import { LAST_PAYMENT_ID_STORAGE_KEY } from "@/lib/payment-flow";

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
  }

  beforeEach(() => {
    getGiftsMock.mockReset();
    getPaymentMock.mockReset();
    createPaymentMock.mockReset();
    getGiftsMock.mockResolvedValue([
      {
        id: "g-test",
        name: "Jogo de Taças",
        image: "g-tacas",
        totalValueCents: 25000,
        fractional: false,
        partValueCents: null,
        totalParts: null,
        partsFunded: null,
        fullyFunded: false,
      },
    ]);
    window.localStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        href: "http://localhost/",
      },
    });
  });

  it("shows the recovery surface when there is a stored pending payment", async () => {
    window.localStorage.setItem(
      LAST_PAYMENT_ID_STORAGE_KEY,
      JSON.stringify({
        paymentId: "payment-1",
        createdAt: Date.now(),
        giftName: "Jogo de Taças",
        amountCents: 25000,
        checkoutUrl: "https://www.asaas.com/checkout/session-1",
      })
    );

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByText("Pagamento em andamento")).toBeInTheDocument();
    });
    expect(screen.getByText(/você iniciou um pagamento e pode retomá-lo quando quiser/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar pagamento" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument();
  });

  it("clears the stored payment when the guest discards recovery", async () => {
    window.localStorage.setItem(
      LAST_PAYMENT_ID_STORAGE_KEY,
      JSON.stringify({
        paymentId: "payment-1",
        createdAt: Date.now(),
      })
    );

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
    window.localStorage.setItem(
      LAST_PAYMENT_ID_STORAGE_KEY,
      JSON.stringify({
        paymentId: "payment-1",
        createdAt: Date.now(),
        checkoutUrl: "https://www.asaas.com/checkout/session-1",
      })
    );
    getPaymentMock.mockResolvedValue({
      paymentId: "payment-1",
      paymentMethod: "HOSTED",
      status: "AWAITING_PAYMENT",
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
    });

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByText("Pagamento em andamento")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Continuar pagamento" }));

    await waitFor(() => {
      expect(getPaymentMock).toHaveBeenCalledWith("payment-1");
    });
    expect(window.location.href).toBe("https://www.asaas.com/checkout/session-1");
  });

  it("closes the gift modal on pageshow back-return and keeps the recovery banner", async () => {
    createPaymentMock.mockResolvedValue({
      paymentId: "payment-1",
      paymentMethod: "HOSTED",
      status: "CREATED",
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
    });

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

  it("removes the recovery surface when the stored payment is already canceled", async () => {
    window.localStorage.setItem(
      LAST_PAYMENT_ID_STORAGE_KEY,
      JSON.stringify({
        paymentId: "payment-1",
        createdAt: Date.now(),
      })
    );
    getPaymentMock.mockResolvedValue({
      paymentId: "payment-1",
      paymentMethod: "HOSTED",
      status: "CANCELED",
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
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:05.000Z",
    });

    renderPresentes();

    await waitFor(() => {
      expect(screen.getByText("Pagamento em andamento")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continuar pagamento" }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Pagamento em andamento")).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(LAST_PAYMENT_ID_STORAGE_KEY)).toBeNull();
  });
});
