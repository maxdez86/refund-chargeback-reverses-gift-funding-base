import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeTurnstileMock = vi.fn();
const listGuestMessagesMock = vi.fn();
const createGuestMessageMock = vi.fn();
const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("@/lib/guest-messages-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/guest-messages-api")>(
    "@/lib/guest-messages-api"
  );
  return {
    ...actual,
    listGuestMessages: (...args: unknown[]) => listGuestMessagesMock(...args),
    createGuestMessage: (...args: unknown[]) => createGuestMessageMock(...args),
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
    message: vi.fn(),
  },
}));

vi.mock("@/components/Turnstile", () => ({
  Turnstile: forwardRef((_props: unknown, ref) => {
    useImperativeHandle(ref, () => ({
      execute: () => executeTurnstileMock(),
      reset: vi.fn(),
    }));
    return <div data-testid="turnstile-widget" />;
  }),
}));

import { GuestMessages } from "@/components/sections/GuestMessages";

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("GuestMessages section", () => {
  beforeEach(() => {
    executeTurnstileMock.mockReset().mockResolvedValue(null);
    listGuestMessagesMock.mockReset();
    createGuestMessageMock.mockReset();
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    Object.defineProperty(window, "scrollY", {
      writable: true,
      configurable: true,
      value: 200,
    });
  });

  it("renders the compose card even when there are no messages", async () => {
    listGuestMessagesMock.mockResolvedValueOnce({
      messages: [],
      nextCursor: null,
    });

    renderWithClient(<GuestMessages />);

    expect(await screen.findByText("Deixe seu recado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar recado" })).toBeInTheDocument();
  });

  it("keeps the compose card first and prepends the new message after submit", async () => {
    listGuestMessagesMock.mockResolvedValueOnce({
      messages: [
        {
          messageId: "msg-old",
          authorName: "Paula",
          message: "Com carinho.",
          createdAt: "2026-05-28T18:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    createGuestMessageMock.mockResolvedValueOnce({
      ok: true,
      message: {
        messageId: "msg-new",
        authorName: "Ana",
        message: "Sejam muito felizes!",
        createdAt: "2026-05-29T18:00:00.000Z",
      },
    });

    renderWithClient(<GuestMessages />);

    await screen.findByText("Paula");
    expect(screen.getByText("Deixe seu recado")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Seu nome"), {
      target: { value: "Ana" },
    });
    fireEvent.change(screen.getByLabelText("Sua mensagem"), {
      target: { value: "Sejam muito felizes!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar recado" }));

    await screen.findByText("Sejam muito felizes!");
    await waitFor(() => expect(screen.getByLabelText("Seu nome")).toHaveValue(""));
    expect(screen.getByLabelText("Sua mensagem")).toHaveValue("");
    expect(executeTurnstileMock).toHaveBeenCalledTimes(1);
    expect(createGuestMessageMock).toHaveBeenCalledWith(
      {
        authorName: "Ana",
        message: "Sejam muito felizes!",
      },
      null
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Recado enviado.");
  });

  it("shows ... mais only for overflowing messages and opens a modal with the full content", async () => {
    listGuestMessagesMock.mockResolvedValueOnce({
      messages: [
        {
          messageId: "msg-long",
          authorName: "Marina",
          message: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(8),
          createdAt: "2026-05-28T18:00:00.000Z",
        },
        {
          messageId: "msg-short",
          authorName: "Paulo",
          message: "Mensagem curta.",
          createdAt: "2026-05-27T18:00:00.000Z",
        },
      ],
      nextCursor: null,
    });

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.textContent?.includes("Lorem ipsum") ? 400 : 100;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 120;
      },
    });

    renderWithClient(<GuestMessages />);

    expect(await screen.findByText("Marina")).toBeInTheDocument();
    const moreButtons = screen.getAllByRole("button", { name: "... mais" });
    expect(moreButtons).toHaveLength(1);

    fireEvent.click(moreButtons[0]);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Lorem ipsum dolor sit amet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mensagem curta/i })).not.toBeInTheDocument();
  });

  it("wraps long unbroken message text in the card and full-content dialog", async () => {
    const longUnbrokenMessage = "long".repeat(100);
    listGuestMessagesMock.mockResolvedValueOnce({
      messages: [
        {
          messageId: "msg-unbroken",
          authorName: "Carla",
          message: longUnbrokenMessage,
          createdAt: "2026-05-28T18:00:00.000Z",
        },
      ],
      nextCursor: null,
    });

    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.textContent?.includes(longUnbrokenMessage) ? 400 : 100;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 120;
      },
    });

    renderWithClient(<GuestMessages />);

    const cardMessage = await screen.findByText(longUnbrokenMessage);
    expect(cardMessage).toHaveClass("w-full", "min-w-0", "break-all");

    fireEvent.click(screen.getByRole("button", { name: "... mais" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(longUnbrokenMessage)).toHaveClass(
      "w-full",
      "min-w-0",
      "break-all"
    );
  });

  it("scrolls to FAQ when the bottom arrow is clicked", async () => {
    listGuestMessagesMock.mockResolvedValueOnce({
      messages: [],
      nextCursor: null,
    });
    const scrollToSpy = vi.spyOn(window, "scrollTo");

    renderWithClient(
      <>
        <GuestMessages />
        <div id="faq">FAQ</div>
      </>
    );

    const faq = document.querySelector("#faq");
    expect(faq).not.toBeNull();
    vi.spyOn(faq!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 300,
      top: 300,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Rolar para a próxima seção" }));

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 220, behavior: "smooth" });
  });
});
