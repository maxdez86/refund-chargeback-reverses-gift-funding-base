import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InfiniteData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeTurnstileMock = vi.fn();
const listGuestMessagesMock = vi.fn();
const createGuestMessageMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/lib/guest-messages-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/guest-messages-api")>(
    "@/lib/guest-messages-api"
  );
  return {
    ...actual,
    listGuestMessages: (...args: unknown[]) => listGuestMessagesMock(...args),
    createGuestMessage: (...args: unknown[]) => createGuestMessageMock(...args)
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
    message: vi.fn()
  }
}));

vi.mock("@/components/Turnstile", () => ({
  Turnstile: forwardRef((_props: unknown, ref) => {
    useImperativeHandle(ref, () => ({
      execute: () => executeTurnstileMock(),
      reset: vi.fn()
    }));
    return <div data-testid="turnstile-widget" />;
  })
}));

import { GuestMessages } from "@/components/sections/GuestMessages";

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("GuestMessages section", () => {
  beforeEach(() => {
    executeTurnstileMock.mockReset().mockResolvedValue(null);
    listGuestMessagesMock.mockReset();
    createGuestMessageMock.mockReset();
    toastErrorMock.mockReset();
    Object.defineProperty(window, "scrollY", {
      writable: true,
      configurable: true,
      value: 200
    });
  });

  it("renders the empty-state CTA when there are no messages", async () => {
    listGuestMessagesMock.mockResolvedValueOnce({
      messages: [],
      nextCursor: null
    });

    renderWithClient(<GuestMessages />);

    expect(
      await screen.findByRole("heading", {
        name: "Seja o primeiro a deixar um recado para os noivos"
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escrever o primeiro recado" })).toBeInTheDocument();
  });

  it("submits a message, scrolls to the section top, and shows the success state", async () => {
    listGuestMessagesMock.mockResolvedValueOnce({
      messages: [
        {
          messageId: "msg-old",
          authorName: "Paula",
          message: "Com carinho.",
          createdAt: "2026-05-28T18:00:00.000Z"
        }
      ],
      nextCursor: null
    });
    createGuestMessageMock.mockResolvedValueOnce({
      ok: true,
      message: {
        messageId: "msg-new",
        authorName: "Ana",
        message: "Sejam muito felizes!",
        createdAt: "2026-05-29T18:00:00.000Z"
      }
    });
    const scrollToSpy = vi.spyOn(window, "scrollTo");

    renderWithClient(<GuestMessages />);
    const section = document.getElementById("recados");
    expect(section).not.toBeNull();
    vi.spyOn(section!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 120,
      top: 120,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({})
    });

    await screen.findByText("Paula");

    fireEvent.change(screen.getByLabelText("Seu nome"), {
      target: { value: "Ana" }
    });
    fireEvent.change(screen.getByLabelText("Sua mensagem"), {
      target: { value: "Sejam muito felizes!" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar recado" }));

    await screen.findByText("Seu carinho já chegou até os noivos");
    await waitFor(() =>
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 240, behavior: "smooth" })
    );
    expect(executeTurnstileMock).toHaveBeenCalledTimes(1);
    expect(createGuestMessageMock).toHaveBeenCalledWith(
      {
        authorName: "Ana",
        message: "Sejam muito felizes!"
      },
      null
    );
  });
});
