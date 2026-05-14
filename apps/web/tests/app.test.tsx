import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const getGiftsMock = vi.fn();
const fetchInvitationMock = vi.fn();
const submitRsvpMock = vi.fn();

vi.mock("@/lib/gifts-api", () => ({
  giftsQueryKey: ["gifts"],
  getGifts: (...args: unknown[]) => getGiftsMock(...args)
}));

vi.mock("@/lib/rsvp-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rsvp-api")>(
    "@/lib/rsvp-api"
  );
  return {
    ...actual,
    fetchInvitation: (...args: unknown[]) => fetchInvitationMock(...args),
    submitRsvp: (...args: unknown[]) => submitRsvpMock(...args)
  };
});

import App from "../src/App";

describe("official web app", () => {
  beforeEach(() => {
    fetchInvitationMock.mockReset();
    submitRsvpMock.mockReset();
    getGiftsMock.mockReset().mockResolvedValue([
      {
        id: "g-test-pix",
        name: "PIX Teste",
        imageUrl: "https://brimax.life/images/gifts-home.png",
        fractional: false,
        totalValueCents: 500,
        partValueCents: null,
        totalParts: null,
        partsFunded: 0,
        fullyFunded: false,
        updatedAt: "2026-05-13T00:00:00.000Z"
      },
      {
        id: "g-armario",
        name: "Armário de Cozinha",
        imageUrl: "https://example.com/armario.webp",
        fractional: true,
        totalValueCents: 174900,
        partValueCents: 5000,
        totalParts: 35,
        partsFunded: 3,
        fullyFunded: false,
        updatedAt: "2026-05-13T00:00:00.000Z"
      }
    ]);
    window.history.replaceState({}, "", "/");
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("renders the migrated brimax landing page sections", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /Brida/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nossa História" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lista de Presentes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sua presença é o nosso maior presente" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tire suas dúvidas." })).toBeInTheDocument();
  });

  it("opens the gift dialog flow", async () => {
    render(<App />);

    fireEvent.click((await screen.findAllByRole("button", { name: /Contribuir|Escolher presente/i }))[0]);

    expect(
      await screen.findByRole("heading", { name: /PIX Teste|4 Toalhas de Banho|Armário de Cozinha/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.queryByLabelText("Seu e-mail")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ir para o pagamento" })).toBeEnabled();
  });

  it("returns to #presentes when the gift modal closes", async () => {
    render(<App />);

    fireEvent.click((await screen.findAllByRole("button", { name: /Contribuir|Escolher presente/i }))[0]);

    expect(
      await screen.findByRole("heading", { name: /PIX Teste|4 Toalhas de Banho|Armário de Cozinha/i })
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("#presentes");
    });
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("renders funded gift state from the backend response", async () => {
    getGiftsMock.mockResolvedValueOnce([
      {
        id: "g-armario",
        name: "Armário de Cozinha",
        imageUrl: "https://example.com/armario.webp",
        fractional: true,
        totalValueCents: 174900,
        partValueCents: 5000,
        totalParts: 35,
        partsFunded: 34,
        fullyFunded: false,
        updatedAt: "2026-05-13T00:00:00.000Z"
      }
    ]);

    render(<App />);

    expect(await screen.findByText("1 cota restante")).toBeInTheDocument();
    expect(screen.getByText("97%")).toBeInTheDocument();
  });

  it("looks up an invitation by code and submits a confirmation", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitationCode: "ABCD2345",
      householdId: "grupo-debora-nael",
      householdName: "Débora e Nael",
      guests: [
        {
          guestId: "grupo-debora-nael--debora",
          guestName: "Débora",
          allowedPlusOnes: 0,
          rsvpStatus: "pending"
        },
        {
          guestId: "grupo-debora-nael--nael",
          guestName: "Nael",
          allowedPlusOnes: 0,
          rsvpStatus: "pending"
        }
      ]
    });
    submitRsvpMock.mockResolvedValueOnce({
      ok: true,
      invitationCode: "ABCD2345",
      householdId: "grupo-debora-nael",
      status: "attending",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "abcd2345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    expect(
      await screen.findByText("Confirme quais convidados do seu convite irão comparecer:")
    ).toBeInTheDocument();
    expect(screen.getByText("Débora")).toBeInTheDocument();
    expect(fetchInvitationMock).toHaveBeenCalledWith("ABCD2345");

    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));
    expect(await screen.findByText(/Recebemos sua confirmação com carinho!/i)).toBeInTheDocument();
    expect(submitRsvpMock).toHaveBeenCalledTimes(1);
    const payload = submitRsvpMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      invitationCode: "ABCD2345",
      householdId: "grupo-debora-nael",
      attendingGuestCount: 2
    });
  });

  it("renders the not-found state when the code does not match", async () => {
    const { RsvpApiError } = await import("@/lib/rsvp-api");
    fetchInvitationMock.mockRejectedValueOnce(
      new RsvpApiError("Invitation not found.", 404)
    );

    render(<App />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "MISSING1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    expect(await screen.findByText(/Código não encontrado/i)).toBeInTheDocument();
  });

  it("keeps the local section map link and venue media", async () => {
    render(<App />);

    expect(screen.getByRole("link", { name: /Ver no mapa:/i })).toHaveAttribute(
      "href",
      expect.stringContaining("google.com/maps")
    );

    fireEvent.click(screen.getByRole("button", { name: /Reproduzir Tour 360 do Villa Valentim/i }));

    await waitFor(() =>
      expect(screen.getByTitle("Tour 360 do Villa Valentim")).toBeInTheDocument()
    );
  });
});
