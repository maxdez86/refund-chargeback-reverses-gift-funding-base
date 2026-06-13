import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentConfirmationDialog } from "@/components/PaymentConfirmationDialog";
import { PaymentApiError } from "@/lib/payments-api";
import { giftsQueryKey } from "@/lib/gifts-api";
import {
  LAST_PAYMENT_ID_STORAGE_KEY,
  openPaymentConfirmationDialog,
} from "@/lib/payment-flow";

const getPaymentMock = vi.fn();
const createPaymentMessageMock = vi.fn();
const discardPaymentMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/lib/payments-api", () => ({
  PaymentApiError: class PaymentApiError extends Error {
    constructor(message: string, readonly status?: number) {
      super(message);
      this.name = "PaymentApiError";
    }
  },
  getPayment: (...args: unknown[]) => getPaymentMock(...args),
  createPaymentMessage: (...args: unknown[]) => createPaymentMessageMock(...args),
  discardPayment: (...args: unknown[]) => discardPaymentMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    message: vi.fn(),
  },
}));

describe("PaymentConfirmationDialog", () => {
  function dispatchPageShow(persisted: boolean) {
    const event = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(event, "persisted", {
      configurable: true,
      value: persisted,
    });
    window.dispatchEvent(event);
  }

  function renderDialog(extraContent?: ReactNode) {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <>
        {extraContent}
        <QueryClientProvider client={queryClient}>
          <PaymentConfirmationDialog />
        </QueryClientProvider>
      </>
    );

    return { invalidateSpy };
  }

  beforeEach(() => {
    getPaymentMock.mockReset();
    createPaymentMessageMock.mockReset();
    discardPaymentMock.mockReset();
    discardPaymentMock.mockResolvedValue(undefined);
    toastErrorMock.mockReset();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.scrollTo = vi.fn();
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

    window.history.replaceState({}, "", "/#paymentId=payment-1&paymentStatus=success");

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Confirmando seu pagamento…")).toBeInTheDocument();
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 2_100));
    });

    await waitFor(() => {
      expect(screen.getByText("Presente recebido!")).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        /Maria, recebemos o seu presente e ficamos muito felizes por ter você fazendo parte desse momento tão especial da nossa história/i
      )
    ).toBeInTheDocument();
  }, 10_000);

  it("does not auto-open from localStorage alone", async () => {
    window.localStorage.setItem(
      LAST_PAYMENT_ID_STORAGE_KEY,
      JSON.stringify({ paymentId: "payment-recovery-1", createdAt: Date.now() })
    );

    renderDialog();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText("Presente recebido!")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirmando seu pagamento…")).not.toBeInTheDocument();
  });

  it("can be opened programmatically for resumed confirmed payments", async () => {
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

    renderDialog();

    act(() => {
      openPaymentConfirmationDialog({
        paymentId: "payment-recovery-1",
        paymentStatus: "success",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Presente recebido!")).toBeInTheDocument();
    });
  });

  it("closes on pageshow when runtime URL is #presentes", async () => {
    getPaymentMock.mockResolvedValue({
      paymentId: "payment-back-1",
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
    });

    window.history.replaceState({}, "", "/#paymentId=payment-back-1&paymentStatus=success");

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Confirmando seu pagamento…")).toBeInTheDocument();
    });

    window.history.replaceState({}, "", "/#presentes");
    act(() => {
      dispatchPageShow(true);
    });

    await waitFor(() => {
      expect(screen.queryByText("Confirmando seu pagamento…")).not.toBeInTheDocument();
    });
  });

  it("ignores stale captured initial hash on runtime refresh", async () => {
    getPaymentMock.mockResolvedValue({
      paymentId: "payment-stale-1",
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
    });

    const w = window as Window & { __brimaxInitialHash?: string };
    w.__brimaxInitialHash = "#paymentId=payment-stale-1&paymentStatus=success";
    window.history.replaceState({}, "", "/#presentes");

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Confirmando seu pagamento…")).toBeInTheDocument();
    });

    act(() => {
      dispatchPageShow(true);
    });

    await waitFor(() => {
      expect(screen.queryByText("Confirmando seu pagamento…")).not.toBeInTheDocument();
    });
  });

  it("shows fallback copy when success polling fails", async () => {
    getPaymentMock.mockRejectedValue(new Error("network error"));

    window.history.replaceState({}, "", "/#paymentId=payment-error-1&paymentStatus=success");

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Status indisponível")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Não conseguimos confirmar o status do pagamento. Em caso de dúvida, fale com a gente.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Confirmando seu pagamento…")).not.toBeInTheDocument();
  });

  it("keeps success confirmation open on fresh callback pageshow", async () => {
    getPaymentMock.mockResolvedValue({
      paymentId: "payment-fresh-success-1",
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

    window.history.replaceState({}, "", "/#paymentId=payment-fresh-success-1&paymentStatus=success");

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Presente recebido!")).toBeInTheDocument();
    });

    act(() => {
      dispatchPageShow(false);
    });

    expect(screen.getByText("Presente recebido!")).toBeInTheDocument();
  });

  it("keeps cancel confirmation open on fresh callback pageshow", async () => {
    window.history.replaceState({}, "", "/#paymentId=payment-fresh-cancel-1&paymentStatus=cancel");

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Pagamento cancelado")).toBeInTheDocument();
    });

    act(() => {
      dispatchPageShow(false);
    });

    expect(screen.getByText("Pagamento cancelado")).toBeInTheDocument();
  });

  it("keeps expired confirmation open on fresh callback pageshow", async () => {
    window.history.replaceState({}, "", "/#paymentId=payment-fresh-expired-1&paymentStatus=expired");

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Sessão expirada")).toBeInTheDocument();
    });

    act(() => {
      dispatchPageShow(false);
    });

    expect(screen.getByText("Sessão expirada")).toBeInTheDocument();
  });

  it("removes payment params and returns to #presentes when the modal closes", async () => {
    getPaymentMock.mockResolvedValue({
      paymentId: "payment-close-1",
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

    window.history.replaceState({}, "", "/#paymentId=payment-close-1&paymentStatus=success");

    const { invalidateSpy } = renderDialog(<section id="presentes">Presentes</section>);

    await waitFor(() => {
      expect(screen.getByText("Presente recebido!")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("#presentes");
    });
    expect(window.scrollTo).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: giftsQueryKey });
  });

  it("auto-discards the payment exactly once on the cancel variant", async () => {
    window.history.replaceState({}, "", "/#paymentId=payment-1&paymentStatus=cancel");

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Pagamento cancelado")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(discardPaymentMock).toHaveBeenCalledTimes(1);
    });
    expect(discardPaymentMock).toHaveBeenCalledWith("payment-1");
    // The url-cancel path never fetches the payment.
    expect(getPaymentMock).not.toHaveBeenCalled();
  });

  it("does not auto-discard on the success variant", async () => {
    getPaymentMock.mockResolvedValue({
      paymentId: "payment-success-nodiscard",
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
    });

    window.history.replaceState(
      {},
      "",
      "/#paymentId=payment-success-nodiscard&paymentStatus=success"
    );

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Presente recebido!")).toBeInTheDocument();
    });
    expect(discardPaymentMock).not.toHaveBeenCalled();
  });

  it("does not auto-discard on the pending variant", async () => {
    getPaymentMock.mockResolvedValue({
      paymentId: "payment-pending-nodiscard",
      paymentMethod: "HOSTED",
      status: "AWAITING_PAYMENT",
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
    });

    window.history.replaceState(
      {},
      "",
      "/#paymentId=payment-pending-nodiscard&paymentStatus=success"
    );

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Confirmando seu pagamento…")).toBeInTheDocument();
    });
    expect(discardPaymentMock).not.toHaveBeenCalled();
  });

  it("does not auto-discard again when the cancel dialog re-opens for the same payment", async () => {
    window.history.replaceState({}, "", "/#paymentId=payment-reopen&paymentStatus=cancel");

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Pagamento cancelado")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(discardPaymentMock).toHaveBeenCalledTimes(1);
    });

    // Re-trigger the dialog for the same id/hash via popstate and the open event.
    act(() => {
      window.dispatchEvent(new Event("popstate"));
    });
    act(() => {
      openPaymentConfirmationDialog({
        paymentId: "payment-reopen",
        paymentStatus: "cancel",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Pagamento cancelado")).toBeInTheDocument();
    });
    expect(discardPaymentMock).toHaveBeenCalledTimes(1);
  });

  it("swallows auto-discard failures without a toast and keeps the cancel screen", async () => {
    discardPaymentMock.mockRejectedValueOnce(new PaymentApiError("conflict", 409));

    window.history.replaceState({}, "", "/#paymentId=payment-discard-fail&paymentStatus=cancel");

    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Pagamento cancelado")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(discardPaymentMock).toHaveBeenCalledTimes(1);
    });

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(screen.getByText("Pagamento cancelado")).toBeInTheDocument();
  });
});
