import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { RSVP } from "@/components/sections/RSVP";

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("RSVP section", () => {
  beforeEach(() => {
    fetchInvitationMock.mockReset();
    submitRsvpMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("disables the lookup button when no code is entered", () => {
    renderWithClient(<RSVP />);
    expect(
      screen.getByRole("button", { name: /Localizar convite/i })
    ).toBeDisabled();
  });

  it("pre-fills selections from prior rsvpStatus when re-editing", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitationCode: "ABCD2345",
      householdId: "grupo-debora-nael",
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
    });

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    expect(screen.getByText("Débora")).toBeInTheDocument();
    expect(screen.getByText("Nael")).toBeInTheDocument();
    const stateLabels = screen.getAllByText(/Vai comparecer|Não vai/);
    expect(stateLabels[0].textContent).toBe("Vai comparecer");
    expect(stateLabels[1].textContent).toBe("Não vai");
    expect(screen.getByText("1 pessoa confirmada")).toBeInTheDocument();
  });

  it("submits the household with note and shows the success state", async () => {
    fetchInvitationMock.mockResolvedValueOnce({
      invitationCode: "ABCD2345",
      householdId: "grupo-amanda-cris",
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
    });
    submitRsvpMock.mockResolvedValueOnce({
      ok: true,
      invitationCode: "ABCD2345",
      householdId: "grupo-amanda-cris",
      status: "attending",
      updatedAt: "2026-05-14T00:00:00.000Z"
    });

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "abcd2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    // Uncheck Chris by clicking the row label.
    fireEvent.click(screen.getByText("Chris"));
    fireEvent.change(screen.getByLabelText(/Recado para os noivos/i), {
      target: { value: "Chegamos no sábado!" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    await screen.findByText(/Recebemos sua confirmação com carinho!/i);
    expect(submitRsvpMock).toHaveBeenCalledWith({
      invitationCode: "ABCD2345",
      householdId: "grupo-amanda-cris",
      submittedBy: "g1",
      guestResponses: [
        { guestId: "g1", status: "attending" },
        { guestId: "g2", status: "declined" }
      ],
      attendingGuestCount: 1,
      note: "Chegamos no sábado!"
    });
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
      invitationCode: "ABCD2345",
      householdId: "grupo-amanda-cris",
      householdName: "Amanda e Chris",
      guests: [
        {
          guestId: "g1",
          guestName: "Amanda",
          allowedPlusOnes: 0,
          rsvpStatus: "pending"
        }
      ]
    });
    submitRsvpMock.mockRejectedValueOnce(new RsvpApiError("boom", 500));

    renderWithClient(<RSVP />);

    fireEvent.change(screen.getByLabelText("Digite seu código de convite"), {
      target: { value: "ABCD2345" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Localizar convite/i }));

    await screen.findByText("Confirme quais convidados do seu convite irão comparecer:");

    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("boom"));
    expect(
      screen.queryByText(/Recebemos sua confirmação com carinho!/i)
    ).not.toBeInTheDocument();
  });
});
