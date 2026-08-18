import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const getGiftsMock = vi.fn();
const listGuestMessagesMock = vi.fn();
const fetchInvitationMock = vi.fn();
const submitRsvpMock = vi.fn();
const executeTurnstileMock = vi.fn();

vi.mock("@/lib/gifts-api", () => ({
  giftsQueryKey: ["gifts"],
  getGifts: (...args: unknown[]) => getGiftsMock(...args)
}));

vi.mock("@/lib/guest-messages-api", () => ({
  guestMessagesQueryKey: ["guest-messages"],
  listGuestMessages: (...args: unknown[]) => listGuestMessagesMock(...args),
  createGuestMessage: vi.fn()
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

vi.mock("@/components/Turnstile", () => ({
  Turnstile: forwardRef((_props: unknown, ref) => {
    useImperativeHandle(ref, () => ({
      execute: () => executeTurnstileMock(),
      reset: vi.fn()
    }));
    return <div data-testid="turnstile-widget" />;
  })
}));

import App from "../src/App";

describe("official web app", () => {
  beforeEach(() => {
    executeTurnstileMock.mockReset().mockResolvedValue(null);
    fetchInvitationMock.mockReset();
    submitRsvpMock.mockReset();
    listGuestMessagesMock.mockReset().mockResolvedValue({
      messages: [],
      nextCursor: null
    });
    getGiftsMock.mockReset().mockResolvedValue([
      {
        id: "g-toalhas-banho",
        name: "4 Toalhas de Banho",
        image: "toalhas-banho",
        fractional: false,
        totalValueCents: 17_600,
        partValueCents: null,
        totalParts: null,
        partsFunded: 0,
        fullyFunded: false,
        updatedAt: "2026-05-13T00:00:00.000Z"
      },
      {
        id: "g-armario",
        name: "Armário de Cozinha",
        image: "armario-cozinha",
        fractional: true,
        totalValueCents: 174900,
        partValueCents: 5000,
        totalParts: 35,
        partsFunded: 3,
        fullyFunded: false,
        updatedAt: "2026-05-13T00:00:00.000Z"
      }
    ]);
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.scrollTo = vi.fn();
  });

  it("renders the migrated brimax landing page sections", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /Brida/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "A história do ponto de vista dela" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lista de Presentes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sua presença é o nosso maior presente" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recados para os Noivos" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tire suas dúvidas." })).toBeInTheDocument();
    expect(await screen.findByText("4 Toalhas de Banho")).toBeInTheDocument();
    expect(document.querySelector('picture[data-media-policy-section="hero"] source[srcset="/media/hero/mobile.avif"]')).toBeInTheDocument();
    expect(document.querySelector('picture[data-media-policy-section="footer"] source[srcset="/media/footer/desktop.jpeg"]')).toBeInTheDocument();
    expect(
      document.querySelector(
        'picture[data-media-policy-section="story"] source[srcset*="/media/story/o-ultimo-primeiro-beijo/480.avif 480w"]'
      )
    ).toBeInTheDocument();
    expect(
      document.querySelector(
        'picture[data-media-policy-section="story"] source[srcset*="/media/story/ps-eu-te-amo/480.avif 480w"]'
      )
    ).toBeInTheDocument();
    expect(document.querySelector('video[src="/media/story/o-ultimo-primeiro-beijo.mp4"]')).not.toBeInTheDocument();
    expect(
      document.querySelector(
        'picture[data-media-policy-section="padrinhos"] source[srcset*="/media/padrinhos/nilza-e-cerqueira/480.avif 480w"]'
      )
    ).toBeInTheDocument();
    expect(
      document.querySelector(
        'picture[data-media-policy-section="presentes"] source[srcset*="/media/presentes/toalhas-banho/480.avif 480w"]'
      )
    ).toBeInTheDocument();
  });

  it("routes /dashboard to the administrative frontend without rendering the landing page", () => {
    window.history.replaceState({}, "", "/dashboard");
    render(<App />);

    expect(screen.getByRole("heading", { name: "Configuração pendente" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Brida/i })).not.toBeInTheDocument();
  });

  it("opens the gift dialog flow", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Escolher presente" }));

    expect(
      await screen.findByRole("heading", { name: /PIX Teste|4 Toalhas de Banho|Armário de Cozinha/i })
    ).toBeInTheDocument();

    expect(screen.getByTestId("gift-dialog-content").className).toContain("max-h-[92vh]");
    expect(screen.getByTestId("gift-dialog-image-frame")).toBeInTheDocument();
    expect(screen.queryByLabelText("Seu e-mail")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ir para o pagamento" })).toBeEnabled();
  });

  it("opens the fractional gift dialog with the dialog-specific image frame", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Contribuir" }));

    expect(
      await screen.findByRole("heading", { name: "Armário de Cozinha" })
    ).toBeInTheDocument();

    const imageFrame = screen.getByTestId("gift-dialog-image-frame");
    expect(imageFrame).toBeInTheDocument();
    expect(imageFrame.className).toContain("min-h-[15rem]");
    expect(screen.getByTestId("gift-dialog-content").className).toContain("overflow-y-auto");
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
    expect(window.scrollTo).toHaveBeenCalled();
  });

  it("renders funded gift state from the backend response", async () => {
    getGiftsMock.mockResolvedValueOnce([
      {
        id: "g-armario",
        name: "Armário de Cozinha",
        image: "armario-cozinha",
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

  it("keeps the gift card image markup unchanged after the dialog refactor", async () => {
    render(<App />);

    const cardHeading = await screen.findByText("4 Toalhas de Banho");
    const cardPicture = cardHeading
      .closest("article")
      ?.querySelector('picture[data-media-policy-section="presentes"]');

    expect(cardPicture).toBeInTheDocument();
    expect(cardPicture?.querySelector("img")?.className).toContain("p-2");
  });

  it("looks up an invitation by code and submits a confirmation", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
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
      },
      lookupProof: "proof-app-1",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });
    submitRsvpMock.mockResolvedValueOnce({
      ok: true,
      invitationCode: "ABCD2345",
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
    expect(screen.queryByText("Convite localizado")).not.toBeInTheDocument();
    expect(screen.getByText("Débora")).toBeInTheDocument();
    expect(fetchInvitationMock).toHaveBeenCalledWith("ABCD2345", null);

    fireEvent.click(screen.getByText("Débora"));
    fireEvent.click(screen.getByText("Nael"));
    expect(screen.queryByText("Confirme a faixa etária da criança")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));
    expect(await screen.findByText(/Recebemos sua confirmação com carinho!/i)).toBeInTheDocument();
    expect(screen.queryByText(/Convite de/i)).not.toBeInTheDocument();
    expect(submitRsvpMock).toHaveBeenCalledTimes(1);
    const payload = submitRsvpMock.mock.calls[0][0];
    const lookupProof = submitRsvpMock.mock.calls[0][1];
    expect(payload).toMatchObject({
      invitationCode: "ABCD2345",
      attendingGuestCount: 2,
      guestResponses: [
        expect.objectContaining({ isChildSixOrYounger: false }),
        expect.objectContaining({ isChildSixOrYounger: false })
      ]
    });
    expect(lookupProof).toBe("proof-app-1");
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
    expect(document.querySelector('video[src="/media/local/tour-360-villa-valentim.mp4"]')).toBeInTheDocument();
  });
});
