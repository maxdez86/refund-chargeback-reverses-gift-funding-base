import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeTurnstileMock = vi.fn();
const fetchInvitationMock = vi.fn();
const submitRsvpMock = vi.fn();
const toastErrorMock = vi.fn();

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

import { RSVP } from "@/components/sections/RSVP";

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("RSVP section", () => {
  beforeEach(() => {
    executeTurnstileMock.mockReset().mockResolvedValue(null);
    fetchInvitationMock.mockReset();
    submitRsvpMock.mockReset();
    toastErrorMock.mockReset();
    Object.defineProperty(window, "scrollY", {
      writable: true,
      configurable: true,
      value: 0
    });
  });

  it("disables the lookup button when no code is entered", () => {
    renderWithClient(<RSVP />);
    expect(
      screen.getByRole("button", { name: /Localizar convite/i })
    ).toBeDisabled();
    expect(executeTurnstileMock).not.toHaveBeenCalled();
  });

  it("pre-fills selections from prior rsvpStatus when re-editing", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
        householdName: "Débora e Nael",
        guests: [
          {
            guestId: "g1",
            guestName: "Débora",
            allowedPlusOnes: 0,
            rsvpStatus: "attending"
          },
          {
            guestId: "g2",
            guestName: "Nael",
            allowedPlusOnes: 0,
            rsvpStatus: "declined"
          }
        ]
      },
      lookupProof: "proof-1",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");
    expect(executeTurnstileMock).toHaveBeenCalledTimes(1);

    expect(screen.queryByText("Convite localizado")).not.toBeInTheDocument();
    expect(screen.getByText("Débora")).toBeInTheDocument();
    expect(screen.getByText("Nael")).toBeInTheDocument();
    const stateLabels = screen.getAllByText(/Vai comparecer|Não vai/);
    expect(stateLabels[0].textContent).toBe("Vai comparecer");
    expect(stateLabels[1].textContent).toBe("Não vai");
    expect(screen.getByText("1 pessoa confirmada")).toBeInTheDocument();
    expect(screen.queryByText("Confirme a faixa etária da criança")).not.toBeInTheDocument();
  });

  it("submits the household and shows the success state", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending",
            isChild: true
          },
          {
            guestId: "g2",
            guestName: "Chris",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      },
      lookupProof: "proof-2",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });
    submitRsvpMock.mockResolvedValueOnce({
      ok: true,
      invitationCode: "ABCD2345",
      status: "attending",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    const scrollToSpy = vi.spyOn(window, "scrollTo");
    Object.defineProperty(window, "scrollY", {
      writable: true,
      configurable: true,
      value: 200
    });

    renderWithClient(<RSVP />);
    const section = document.getElementById("confirmar-presenca");
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

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "abcd2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    fireEvent.click(screen.getByText("Amanda"));
    fireEvent.click(screen.getByLabelText("7 anos ou mais"));

    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    await screen.findByText(/Recebemos sua confirmação com carinho!/i);
    expect(
      screen.getByText("Qual música não pode faltar na festa para você?")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sugerir uma música" })).toBeInTheDocument();
    await waitFor(() =>
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 240, behavior: "smooth" })
    );
    expect(screen.queryByText(/Convite de/i)).not.toBeInTheDocument();
    expect(submitRsvpMock).toHaveBeenCalledWith(
      {
        invitationCode: "ABCD2345",
        submittedBy: "g1",
        guestResponses: [
          { guestId: "g1", status: "attending", isChildSixOrYounger: false },
          { guestId: "g2", status: "declined", isChildSixOrYounger: false }
        ],
        attendingGuestCount: 1
      },
      "proof-2"
    );
  });

  it("allows skipping the optional music suggestion after RSVP success", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      },
      lookupProof: "proof-skip",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });
    submitRsvpMock.mockResolvedValueOnce({
      ok: true,
      invitationCode: "ABCD2345",
      status: "attending",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    fireEvent.click(screen.getByText("Amanda"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    await screen.findByText(/Recebemos sua confirmação com carinho!/i);
    fireEvent.click(screen.getByRole("button", { name: "Agora não" }));

    expect(screen.queryByRole("button", { name: "Sugerir uma música" })).not.toBeInTheDocument();
    expect(submitRsvpMock).toHaveBeenCalledTimes(1);
  });

  it("submits a music suggestion as a second optional RSVP request", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          },
          {
            guestId: "g2",
            guestName: "Chris",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      },
      lookupProof: "proof-music",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });
    submitRsvpMock
      .mockResolvedValueOnce({
        ok: true,
        invitationCode: "ABCD2345",
        status: "attending",
        updatedAt: "2026-05-14T00:00:00.000Z"
      })
      .mockResolvedValueOnce({
        ok: true,
        invitationCode: "ABCD2345",
        status: "attending",
        updatedAt: "2026-05-14T00:01:00.000Z"
      });

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    fireEvent.click(screen.getByText("Amanda"));
    fireEvent.click(screen.getByText("Chris"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    await screen.findByText(/Recebemos sua confirmação com carinho!/i);
    fireEvent.click(screen.getByRole("button", { name: "Sugerir uma música" }));

    const textarea = screen.getByPlaceholderText("Ex.: Evidências - Chitãozinho & Xororó");
    fireEvent.change(textarea, { target: { value: "Tempo Perdido - Legião Urbana" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar sugestão" }));

    await screen.findByText("Obrigado por compartilhar esse pedacinho da pista com a gente.");
    expect(screen.getByText("Tempo Perdido - Legião Urbana")).toBeInTheDocument();
    expect(submitRsvpMock).toHaveBeenCalledTimes(2);
    expect(submitRsvpMock).toHaveBeenNthCalledWith(
      2,
      {
        invitationCode: "ABCD2345",
        submittedBy: "g1",
        guestResponses: [
          { guestId: "g1", status: "attending", isChildSixOrYounger: false },
          { guestId: "g2", status: "attending", isChildSixOrYounger: false }
        ],
        attendingGuestCount: 2,
        note: "Música sugerida: Tempo Perdido - Legião Urbana"
      },
      "proof-music"
    );
  });

  it("does not send an empty music suggestion", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      },
      lookupProof: "proof-empty-music",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });
    submitRsvpMock.mockResolvedValueOnce({
      ok: true,
      invitationCode: "ABCD2345",
      status: "attending",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    fireEvent.click(screen.getByText("Amanda"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    await screen.findByText(/Recebemos sua confirmação com carinho!/i);
    fireEvent.click(screen.getByRole("button", { name: "Sugerir uma música" }));

    const submitSuggestionButton = screen.getByRole("button", { name: "Enviar sugestão" });
    expect(submitSuggestionButton).toBeDisabled();
    expect(submitRsvpMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a toast when saving the music suggestion fails", async () => {
    const { RsvpApiError } = await import("@/lib/rsvp-api");
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      },
      lookupProof: "proof-music-error",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });
    submitRsvpMock
      .mockResolvedValueOnce({
        ok: true,
        invitationCode: "ABCD2345",
        status: "attending",
        updatedAt: "2026-05-14T00:00:00.000Z"
      })
      .mockRejectedValueOnce(new RsvpApiError("sem playlist", 500));

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    fireEvent.click(screen.getByText("Amanda"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    await screen.findByText(/Recebemos sua confirmação com carinho!/i);
    fireEvent.click(screen.getByRole("button", { name: "Sugerir uma música" }));
    fireEvent.change(screen.getByPlaceholderText("Ex.: Evidências - Chitãozinho & Xororó"), {
      target: { value: "Sina - Djavan" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar sugestão" }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("sem playlist"));
    expect(screen.getByDisplayValue("Sina - Djavan")).toBeInTheDocument();
  });

  it("renders the not-found message when the API returns 404", async () => {
    const { RsvpApiError } = await import("@/lib/rsvp-api");
    fetchInvitationMock.mockRejectedValueOnce(
      new RsvpApiError("Invitation not found.", 404)
    );

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "MISSING1" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    expect(await screen.findByText(/Código não encontrado/i)).toBeInTheDocument();
  });

  it("surfaces a toast when the submit fails", async () => {
    const { RsvpApiError } = await import("@/lib/rsvp-api");
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending",
            isChild: true
          }
        ]
      },
      lookupProof: "proof-3",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });
    submitRsvpMock.mockRejectedValueOnce(new RsvpApiError("boom", 500));

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    expect(screen.getByRole("button", { name: "Enviar confirmação" })).toBeEnabled();
    fireEvent.click(screen.getByText("Amanda"));
    fireEvent.click(screen.getByLabelText("7 anos ou mais"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("boom"));
    expect(
      screen.queryByText(/Recebemos sua confirmação com carinho!/i)
    ).not.toBeInTheDocument();
  });

  it("preselects the child option when the invitation seed marks a guest as 6 or younger", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "attending",
            isChild: true,
            isChildSixOrYounger: true
          }
        ]
      },
      lookupProof: "proof-4",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    expect(screen.getByText("Confirme a faixa etária da criança")).toBeInTheDocument();
    expect(
      screen.queryByText(/Preenchido com base na sua confirmação anterior/i)
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar confirmação" })).toBeEnabled();
  });

  it("does not ask for age confirmation for attending non-child guests", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      },
      lookupProof: "proof-4b",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });
    submitRsvpMock.mockResolvedValueOnce({
      ok: true,
      invitationCode: "ABCD2345",
      status: "attending",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    fireEvent.click(screen.getByText("Amanda"));

    expect(screen.queryByText("Confirme a faixa etária da criança")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar confirmação" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    await waitFor(() =>
      expect(submitRsvpMock).toHaveBeenCalledWith(
        expect.objectContaining({
          guestResponses: [
            { guestId: "g1", status: "attending", isChildSixOrYounger: false }
          ]
        }),
        "proof-4b"
      )
    );
  });

  it("does not render a free-text RSVP message field", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      },
      lookupProof: "proof-5",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    expect(screen.queryByLabelText(/Esquecemos de algum especial/i)).not.toBeInTheDocument();
  });

  it("runs Turnstile only when lookup starts", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitation: {
        invitationCode: "ABCD2345",
        householdName: "Amanda e Chris",
        guests: [
          {
            guestId: "g1",
            guestName: "Amanda",
            allowedPlusOnes: 0,
            rsvpStatus: "pending"
          }
        ]
      },
      lookupProof: "proof-6",
      lookupProofExpiresAt: "2026-05-29T12:30:00.000Z"
    });

    renderWithClient(<RSVP />);

    expect(executeTurnstileMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    expect(executeTurnstileMock).toHaveBeenCalledTimes(1);
  });
});
