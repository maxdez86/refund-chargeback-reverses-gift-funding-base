import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResponse } from "@brimax/contracts";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import type { AdminDashboardSource } from "@/lib/admin-dashboard-source";
import { fixtureDashboardSource } from "@/lib/admin-dashboard-source";
import { AdminApiError } from "@/lib/admin-api";
import { INVITATION_CODE_REGEX } from "@brimax/contracts";
import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import type {
  AdminWhatsappConversationSummary,
  AdminWhatsappFlowSnapshot,
  AdminWhatsappInvitationPage,
  AdminWhatsappMessage
} from "@/lib/admin-dashboard-types";

const session: AdminSessionResponse = {
  authenticated: true,
  stage: "dev",
  admin: {
    subject: "subject",
    email: "casamento@brimax.life",
    hostedDomain: "brimax.life",
    name: "Casamento Brimax"
  }
};

/** Renders the panel and waits for the snapshot load to settle before the test acts. */
const renderShell = async (source?: AdminDashboardSource) => {
  const utils = render(<DashboardShell session={session} preview={false} onSignOut={vi.fn()} source={source} />);
  await screen.findByRole("heading", { name: "Visão geral" });
  return utils;
};

/** Deep-links to a dashboard hash the way a bookmark or the back button would. */
const openHash = (hash: string) =>
  act(() => {
    window.history.replaceState({}, "", `/dashboard${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

/** Navigates through the sidebar the way an operator does. */
const goTo = async (label: RegExp | string) => {
  const nav = screen.getAllByRole("navigation", { name: "Navegação administrativa" })[0];
  fireEvent.click(within(nav).getByRole("link", { name: label }));
};

/** The live-mode shape — summaries only — with one conversation summary of the test's choosing. */
const snapshotWithSummary = (invitationCode: string, summary: AdminWhatsappConversationSummary) => {
  const snapshot = createFixtureDashboardSnapshot();
  snapshot.threads = {};
  snapshot.invitations = snapshot.invitations.map((invitation) => ({
    ...invitation,
    commands: [],
    whatsappConversation:
      invitation.invitationCode === invitationCode ? summary : invitation.whatsappConversation
  }));
  return snapshot;
};

const defaultFlow = (_invitationCode: string): AdminWhatsappFlowSnapshot => ({
  whatsappFreeTextWindow: { open: false },
  phoneNumber: "5511999999999",
  phoneNumberSource: "guest",
  phoneNumberUpdatedAt: null,
  whatsappFlowStatus: "message_sent",
  whatsappFlowStage: "pending",
  whatsappFlowUpdatedAt: null,
  whatsappFlowCompletedAt: null,
  whatsappFallbackSentAt: null,
  whatsappLastInboundMessageId: null,
  whatsappLastOutboundMessageId: null,
  whatsappFailureReason: null,
  whatsappSendAvailability: { firstAllowed: false, resendAllowed: false },
  reconciliationStatus: "none"
});

const message = (
  messageId: string,
  sentAt: string,
  text = messageId
): AdminWhatsappMessage => ({ messageId, direction: "inbound", sentAt, text });

const threadPage = (
  invitationCode: string,
  messages: AdminWhatsappMessage[],
  nextCursor: string | null = null,
  flowOverrides?: Partial<AdminWhatsappFlowSnapshot>
): AdminWhatsappInvitationPage => ({
  flow: { ...defaultFlow(invitationCode), ...flowOverrides },
  page: { invitationCode, messages, commands: [], nextCursor }
});

const loadOlderControl = () =>
  screen.queryByRole("button", { name: "Carregar mensagens anteriores" });

describe("dashboard screens", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/dashboard");
  });

  it("shows accessible refresh progress in the sidebar, retains the screen on failure, and retries", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    let rejectRefresh!: (error: Error) => void;
    const pendingRefresh = new Promise<never>((_, reject) => {
      rejectRefresh = reject;
    });
    const load = vi.fn()
      .mockResolvedValueOnce(snapshot)
      .mockReturnValueOnce(pendingRefresh)
      .mockResolvedValueOnce(snapshot);
    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load,
      loadWhatsappInvitation: vi.fn()
    };
    await renderShell(source);

    const refresh = screen.getByRole("button", { name: "Atualizar dados" });
    expect(screen.getByText(/^Atualizado/)).toBeInTheDocument();
    refresh.focus();
    expect(refresh).toHaveFocus();
    fireEvent.click(refresh);
    fireEvent.click(refresh);

    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Atualizando dados");
    expect(load).toHaveBeenCalledTimes(2);

    rejectRefresh(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível atualizar os dados"
    );
    expect(screen.getByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    expect(refresh).toBeEnabled();

    fireEvent.click(refresh);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/^Atualizado/)).toBeInTheDocument();
  });

  it("keeps the open WhatsApp conversation across a refresh and reloads only that one", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((invitation) => ({ ...invitation, commands: [] }));
    const load = vi.fn().mockResolvedValue(snapshot);
    const loadWhatsappInvitation = vi.fn(
      (invitationCode: string, _cursor?: string, _signal?: AbortSignal) =>
        Promise.resolve(
          threadPage(invitationCode, [message("m1", "2026-08-20T12:00:00Z", "Recarregada")])
        )
    );
    await renderShell({ demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load, loadWhatsappInvitation });
    await goTo(/WhatsApp/);
    fireEvent.click(await screen.findByRole("button", { name: "Conversa com Eugênia Ribeiro" }));
    expect(await screen.findByRole("heading", { name: "Eugênia Ribeiro" })).toBeInTheDocument();
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Atualizar dados" }));

    // A refresh empties every thread, so the conversation the operator is reading is reloaded —
    // and it is the only one: the other six listed rows stay on their summaries.
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(2));
    expect(loadWhatsappInvitation.mock.calls.map((call) => call[0])).toEqual(["SW2748", "SW2748"]);
    expect(loadWhatsappInvitation.mock.calls[1][1]).toBeUndefined();
    expect(screen.getByRole("heading", { name: "Eugênia Ribeiro" })).toBeInTheDocument();
    expect((await screen.findAllByText("Recarregada")).length).toBeGreaterThan(0);
    expect(within(screen.getByRole("list", { name: "Conversas" })).getAllByRole("button")).toHaveLength(7);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("opens an invitation from the list and returns with the back link", async () => {
    await renderShell();
    await goTo(/Convites/);

    fireEvent.click(await screen.findByRole("button", { name: /Abrir convite HL4120/ }));
    expect(await screen.findByRole("heading", { name: "Família Tavares" })).toBeInTheDocument();
    expect(screen.getByText("Envios recentes · Etapa Follow-up")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /VOLTAR PARA CONVITES/ }));
    expect(await screen.findByRole("heading", { name: "Convites" })).toBeInTheDocument();
  });

  it("narrows the invitation list to the ones that need attention", async () => {
    await renderShell();
    await goTo(/Convites/);
    await screen.findByRole("button", { name: /Abrir convite HL4120/ });

    fireEvent.click(screen.getByRole("button", { name: "Requer atenção" }));

    expect(screen.getByText("Mostrando 2 de 8 convites")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Abrir convite LB6640/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Abrir convite HL4120/ })).not.toBeInTheDocument();
  });

  it("searches invitations by household name", async () => {
    await renderShell();
    await goTo(/Convites/);
    await screen.findByRole("button", { name: /Abrir convite HL4120/ });

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar convites" }), {
      target: { value: "queiroz" }
    });

    expect(screen.getByText("Mostrando 1 de 8 convites")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Abrir convite RQ7712/ })).toBeInTheDocument();
  });

  it("confirms a whole invitation and updates its RSVP roll-up", async () => {
    await renderShell();
    openHash("#convites/LB6640");

    fireEvent.click(await screen.findByRole("button", { name: /Confirmar todos no convite/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2 de 2 convidados serão confirmados/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar 2 nomes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Antônio is a criança, but only the guest can confirm "6 anos ou menos" — until then
    // both seats are billed and the invitation shows no cortesia.
    const rsvp = screen.getByRole("heading", { name: "Resposta ao convite (RSVP)" }).parentElement!;
    expect(within(rsvp).getByText("CONFIRMADOS").nextElementSibling).toHaveTextContent("2");
    expect(within(rsvp).getByText("PAGANTES").nextElementSibling).toHaveTextContent("2");
    expect(within(rsvp).getByText("CORTESIAS (≤6 ANOS)").nextElementSibling).toHaveTextContent("0");
  });

  it("validates the new-invitation form before creating anything", async () => {
    await renderShell();
    await goTo(/Convites/);
    fireEvent.click(await screen.findByRole("button", { name: "Novo convite" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar convite" }));
    expect(
      within(dialog).getByText(/Preencha código, telefone, nome do convite/)
    ).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("CÓDIGO DO CONVITE *"), {
      target: { value: "kp3456" }
    });
    fireEvent.change(within(dialog).getByLabelText("TELEFONE (WHATSAPP) *"), {
      target: { value: "+55 11 91234-5678" }
    });
    fireEvent.change(within(dialog).getByLabelText("NOME DO CONVITE *"), {
      target: { value: "Família Moretti" }
    });
    fireEvent.change(within(dialog).getByLabelText("Convidado principal *"), {
      target: { value: "Ana Moretti" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar convite" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Mostrando 9 de 9 convites")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Abrir convite KP3456/ })).toBeInTheDocument();
  });

  it("keeps the new-invitation modal open and shows the reason when the code is taken", async () => {
    // The fixture source refuses a code the snapshot already uses, which is the 409 the API
    // returns for the same reason. The modal must survive it rather than closing on a failure.
    // Several fixture codes predate the contract's alphabet, so pick one the form accepts.
    const taken = createFixtureDashboardSnapshot().invitations.find((invitation) =>
      INVITATION_CODE_REGEX.test(invitation.invitationCode)
    )!.invitationCode;
    await renderShell();
    await goTo(/Convites/);
    fireEvent.click(await screen.findByRole("button", { name: "Novo convite" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("CÓDIGO DO CONVITE *"), {
      target: { value: taken }
    });
    fireEvent.change(within(dialog).getByLabelText("TELEFONE (WHATSAPP) *"), {
      target: { value: "+55 11 91234-5678" }
    });
    fireEvent.change(within(dialog).getByLabelText("NOME DO CONVITE *"), {
      target: { value: "Família Moretti" }
    });
    fireEvent.change(within(dialog).getByLabelText("Convidado principal *"), {
      target: { value: "Ana Moretti" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar convite" }));

    expect(
      await within(dialog).findByText(/Já existe um convite com este código/)
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("refuses a code that is not two letters and four digits from 2 to 9", async () => {
    await renderShell();
    await goTo(/Convites/);
    fireEvent.click(await screen.findByRole("button", { name: "Novo convite" }));

    const dialog = await screen.findByRole("dialog");
    // Zero and one are excluded from the alphabet precisely because they read as O and I.
    fireEvent.change(within(dialog).getByLabelText("CÓDIGO DO CONVITE *"), {
      target: { value: "KP3401" }
    });
    fireEvent.change(within(dialog).getByLabelText("TELEFONE (WHATSAPP) *"), {
      target: { value: "+55 11 91234-5678" }
    });
    fireEvent.change(within(dialog).getByLabelText("NOME DO CONVITE *"), {
      target: { value: "Família Moretti" }
    });
    fireEvent.change(within(dialog).getByLabelText("Convidado principal *"), {
      target: { value: "Ana Moretti" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar convite" }));

    // The click still lands even though the form is invalid — that is what reveals the note.
    // The hint carries the same phrase, so assert on the error note's own opening words.
    expect(within(dialog).getByText(/Preencha código/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("creates a guest flagged as a child from the new-invitation form", async () => {
    await renderShell();
    await goTo(/Convites/);
    fireEvent.click(await screen.findByRole("button", { name: "Novo convite" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("CÓDIGO DO CONVITE *"), {
      target: { value: "KP3457" }
    });
    fireEvent.change(within(dialog).getByLabelText("TELEFONE (WHATSAPP) *"), {
      target: { value: "+55 11 91234-5678" }
    });
    fireEvent.change(within(dialog).getByLabelText("NOME DO CONVITE *"), {
      target: { value: "Família Moretti" }
    });
    fireEvent.change(within(dialog).getByLabelText("Convidado principal *"), {
      target: { value: "Ana Moretti" }
    });
    fireEvent.change(within(dialog).getByLabelText("Convidado 2"), {
      target: { value: "Caio Moretti" }
    });

    const childToggle = within(dialog).getByRole("button", { name: "Criança convidado 2" });
    expect(childToggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(childToggle);
    expect(childToggle).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByText(/1 criança/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Criar convite" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(await screen.findByRole("button", { name: /Abrir convite KP3457/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Abrir Caio Moretti/ }));

    // The seed reaches the guest record; the cortesia stays open for the guest to answer.
    expect(await screen.findByRole("heading", { name: "Caio Moretti" })).toBeInTheDocument();
    expect(screen.getByText("CRIANÇA (0–11 ANOS)").nextElementSibling).toHaveTextContent(
      "Sim · o RSVP pede a faixa etária"
    );
    expect(screen.getByText("CORTESIA (≤6 ANOS)").nextElementSibling).toHaveTextContent(
      "Aguardando confirmação do convidado"
    );
  });

  it("rejects a phone number that is too short to dial", async () => {
    await renderShell();
    openHash("#convites/SW2748");

    fireEvent.click(await screen.findByRole("button", { name: /Trocar telefone do convite/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("NOVO TELEFONE (WHATSAPP) *"), {
      target: { value: "1234" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar telefone" }));

    expect(within(dialog).getByText(/Informe um número válido com DDI e DDD/)).toBeInTheDocument();
  });

  it("keeps the phone modal open and shows the API error when saving fails", async () => {
    const updateInvitationPhone = vi.fn().mockRejectedValue(new AdminApiError("Serviço indisponível.", "unavailable"));
    await renderShell({ ...fixtureDashboardSource, demo: false, updateInvitationPhone });
    openHash("#convites/SW2748");

    fireEvent.click(await screen.findByRole("button", { name: /Trocar telefone do convite/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("NOVO TELEFONE (WHATSAPP) *"), {
      target: { value: "+55 11 91234-5678" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar telefone" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Serviço indisponível.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(updateInvitationPhone).toHaveBeenCalledWith("SW2748", "+55 11 91234-5678", expect.any(AbortSignal));
  });

  it("blocks a WhatsApp resend when the flow is neither failed nor undecided", async () => {
    await renderShell();
    openHash("#convites/MV2093");

    fireEvent.click(await screen.findByRole("button", { name: "Enviar WhatsApp" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByRole("radio", { name: /Primeiro envio/ })).toBeDisabled();
    expect(within(dialog).getByText("BLOQUEADO")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Reenviar mensagem" })).toBeDisabled();
    expect(within(dialog).getByText(/Nenhum envio disponível/)).toBeInTheDocument();
  });

  it("enables a resend for an authoritative completed-pending journey", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.invitations = snapshot.invitations.map((invitation) =>
      invitation.invitationCode === "ZR5567"
        ? {
            ...invitation,
            whatsappFlowStatus: "completed",
            whatsappFlowCompletedAt: "2026-08-26T16:54:07.954Z",
            whatsappSendAvailability: {
              firstAllowed: false,
              resendAllowed: true,
              resendReason: "completed_pending"
            }
          }
        : invitation
    );
    const source: AdminDashboardSource = {
      ...fixtureDashboardSource,
      demo: false,
      load: async () => snapshot,
      loadWhatsappInvitation: vi.fn().mockResolvedValue(threadPage("ZR5567", [], null, {
        whatsappFlowStatus: "completed",
        whatsappFlowCompletedAt: "2026-08-26T16:54:07.954Z",
        whatsappSendAvailability: {
          firstAllowed: false,
          resendAllowed: true,
          resendReason: "completed_pending"
        }
      }))
    };
    await renderShell(source);
    openHash("#convites/ZR5567");

    fireEvent.click(await screen.findByRole("button", { name: "Enviar WhatsApp" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("PERMITIDO")).toBeInTheDocument();
    expect(within(dialog).getByText(/todos os convidados continuam pendentes/)).toBeInTheDocument();
    expect(within(dialog).getAllByText("wedding_rsvp_pending_reminder_group")).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "Reenviar mensagem" })).toBeEnabled();
  });

  it("queues a retry for a failed invitation", async () => {
    await renderShell();
    openHash("#convites/LB6640");

    fireEvent.click(await screen.findByRole("button", { name: "Enviar WhatsApp" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("RETENTATIVA")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reenviar mensagem" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The response-backed command appears immediately; flow state remains server-authoritative.
    expect(screen.getByText("NA FILA")).toBeInTheDocument();
    expect(screen.getAllByText("Falha no envio").length).toBeGreaterThan(0);
  });

  it("keeps the send modal busy and prevents duplicate submission until the backend accepts", async () => {
    let resolveSend!: (value: {
      commandId: string; invitationCode: "LB6640"; templateId: "wedding_rsvp_pending_reminder_group";
      templateVersion: number; status: "queued"; replayed: false;
    }) => void;
    const sendWhatsappRsvp = vi.fn(() => new Promise<Parameters<typeof resolveSend>[0]>((resolve) => {
      resolveSend = resolve;
    }));
    const source: AdminDashboardSource = { ...fixtureDashboardSource, demo: false, sendWhatsappRsvp };
    await renderShell(source);
    openHash("#convites/LB6640");

    fireEvent.click(await screen.findByRole("button", { name: "Enviar WhatsApp" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Reenviar mensagem" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(sendWhatsappRsvp).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("button", { name: "Enviando…" })).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(within(dialog).getAllByRole("radio").every((radio) => radio.hasAttribute("disabled"))).toBe(true);
    expect(within(dialog).getByRole("status")).toHaveTextContent("Solicitando o envio");

    resolveSend({
      commandId: "accepted-resend",
      invitationCode: "LB6640",
      templateId: "wedding_rsvp_pending_reminder_group",
      templateVersion: 2,
      status: "queued",
      replayed: false
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("NA FILA")).toBeInTheDocument();
  });

  it("keeps the modal open with an alert and no queued state when the backend rejects", async () => {
    const source: AdminDashboardSource = {
      ...fixtureDashboardSource,
      demo: false,
      sendWhatsappRsvp: vi.fn().mockRejectedValue(
        new AdminApiError("O estado do fluxo mudou e este envio não é mais permitido.", "rejected", 409, "INVALID_FLOW_TRANSITION")
      )
    };
    await renderShell(source);
    openHash("#convites/LB6640");

    fireEvent.click(await screen.findByRole("button", { name: "Enviar WhatsApp" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reenviar mensagem" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("O estado do fluxo mudou");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("NA FILA")).not.toBeInTheDocument();
  });

  it("disables a stale resend after a 409 refresh returns blocked availability", async () => {
    const failedFlow: Partial<AdminWhatsappFlowSnapshot> = {
      whatsappFlowStatus: "failed",
      whatsappSendAvailability: {
        firstAllowed: false,
        resendAllowed: true,
        resendReason: "failed"
      }
    };
    const blockedFlow: Partial<AdminWhatsappFlowSnapshot> = {
      whatsappFlowStatus: "completed",
      whatsappFlowCompletedAt: "2026-08-26T17:00:00.000Z",
      whatsappSendAvailability: { firstAllowed: false, resendAllowed: false }
    };
    const loadWhatsappInvitation = vi.fn()
      .mockResolvedValueOnce(threadPage("LB6640", [], null, failedFlow))
      .mockResolvedValueOnce(threadPage("LB6640", [], null, blockedFlow));
    const source: AdminDashboardSource = {
      ...fixtureDashboardSource,
      demo: false,
      loadWhatsappInvitation,
      sendWhatsappRsvp: vi.fn().mockRejectedValue(
        new AdminApiError("O estado do fluxo mudou.", "rejected", 409, "INVALID_FLOW_TRANSITION")
      )
    };
    await renderShell(source);
    openHash("#convites/LB6640");
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("button", { name: "Enviar WhatsApp" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reenviar mensagem" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("O estado do fluxo mudou");
    await waitFor(() => expect(loadWhatsappInvitation).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Reenviar mensagem" })).toBeDisabled());
    expect(screen.queryByText("NA FILA")).not.toBeInTheDocument();
  });

  it("lists every person with their invitation, role and courtesy flag", async () => {
    await renderShell();
    await goTo(/Convidados/);

    expect(await screen.findByRole("heading", { name: "Convidados" })).toBeInTheDocument();
    // Fifteen people across the eight fixture invitations.
    expect(screen.getByText("Mostrando 15 de 15 convidados")).toBeInTheDocument();

    const row = screen.getByRole("button", { name: /Abrir Manuela Tavares/ });
    expect(row).toHaveAccessibleName(/Convite HL4120, Família Tavares/);
    expect(row).toHaveAccessibleName(/Acompanhante, cortesia/);
    expect(row).toHaveAccessibleName(/Situação: Confirmado/);

    expect(
      screen.getByRole("button", { name: /Abrir Eugênia Ribeiro/ })
    ).toHaveAccessibleName(/Principal/);
  });

  it("filters the guest list down to the courtesy seats", async () => {
    await renderShell();
    await goTo(/Convidados/);
    await screen.findByRole("button", { name: /Abrir Manuela Tavares/ });

    fireEvent.click(screen.getByRole("button", { name: "Cortesias" }));

    // Only Manuela confirmed "6 anos ou menos". Bento answered "7 anos ou mais" and nobody has
    // answered for Antônio yet, so neither of them is a cortesia.
    expect(screen.getByText("Mostrando 1 de 15 convidados")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Abrir Bento Tavares/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Abrir Antônio Freitas/ })).not.toBeInTheDocument();
  });

  it("shows the criança seed and the guest's own age answer as two separate facts", async () => {
    await renderShell();

    // Manuela confirmed "6 anos ou menos": criança and cortesia at once.
    openHash("#convidados/HL4120--guest-03");
    expect(await screen.findByRole("heading", { name: "Manuela Tavares" })).toBeInTheDocument();
    expect(screen.getByText("CRIANÇA (0–11 ANOS)").nextElementSibling).toHaveTextContent(
      "Sim · o RSVP pede a faixa etária"
    );
    expect(screen.getByText("CORTESIA (≤6 ANOS)").nextElementSibling).toHaveTextContent(
      "Sim · isenta de cobrança"
    );
    expect(screen.getByText("CRIANÇA", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("CORTESIA", { selector: "span" })).toBeInTheDocument();

    // Bento is a criança who answered "7 anos ou mais", so he keeps a paying seat.
    openHash("#convidados/HL4120--guest-04");
    expect(await screen.findByRole("heading", { name: "Bento Tavares" })).toBeInTheDocument();
    expect(screen.getByText("CORTESIA (≤6 ANOS)").nextElementSibling).toHaveTextContent(
      "Não · 7 anos ou mais"
    );
    expect(screen.queryByText("CORTESIA", { selector: "span" })).not.toBeInTheDocument();

    // Nobody has answered for Antônio, so his age band is still open.
    openHash("#convidados/LB6640--guest-02");
    expect(await screen.findByRole("heading", { name: "Antônio Freitas" })).toBeInTheDocument();
    expect(screen.getByText("CORTESIA (≤6 ANOS)").nextElementSibling).toHaveTextContent(
      "Aguardando confirmação do convidado"
    );
  });

  it("clears the confirmed age band when the criança flag is removed", async () => {
    await renderShell();
    openHash("#convidados/HL4120--guest-03");
    await screen.findByRole("heading", { name: "Manuela Tavares" });

    fireEvent.click(screen.getByRole("button", { name: "Desmarcar como criança" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/A faixa etária já respondida é descartada/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Desmarcar como criança" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("CRIANÇA (0–11 ANOS)").nextElementSibling).toHaveTextContent("Não");
    expect(screen.getByText("CORTESIA (≤6 ANOS)").nextElementSibling).toHaveTextContent("—");
    expect(screen.queryByText("CRIANÇA", { selector: "span" })).not.toBeInTheDocument();
    // The action flips, so the operator can put the flag straight back.
    expect(screen.getByRole("button", { name: "Marcar como criança" })).toBeInTheDocument();
  });

  it("searches guests by name and opens one from the list", async () => {
    await renderShell();
    await goTo(/Convidados/);
    await screen.findByRole("button", { name: /Abrir Manuela Tavares/ });

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar convidados" }), {
      target: { value: "bento" }
    });
    expect(screen.getByText("Mostrando 1 de 15 convidados")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Abrir Bento Tavares/ }));
    expect(await screen.findByRole("heading", { name: "Bento Tavares" })).toBeInTheDocument();
    expect(screen.getByText("Família Tavares")).toBeInTheDocument();
  });

  it("tells the operator when a guest search matches nothing", async () => {
    await renderShell();
    await goTo(/Convidados/);
    await screen.findByRole("button", { name: /Abrir Manuela Tavares/ });

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar convidados" }), {
      target: { value: "zzz" }
    });

    expect(screen.getByText("Nenhum convidado corresponde a esta busca.")).toBeInTheDocument();
    expect(screen.getByText("Mostrando 0 de 15 convidados")).toBeInTheDocument();
  });

  it("changes a guest's status through the confirmation dialog", async () => {
    await renderShell();
    openHash("#convidados/HL4120--guest-02");

    expect(await screen.findByRole("heading", { name: "Paulo Tavares" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Marcar como não vai/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/sai da contagem de confirmados/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Marcar como não vai" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("RSVP DO CONVITE").nextElementSibling).toHaveTextContent(
      "Confirmado · 3 de 4"
    );
  });

  it("routes removing the primary guest into deleting the invitation", async () => {
    await renderShell();
    openHash("#convidados/SW2748--guest-01");

    fireEvent.click(await screen.findByRole("button", { name: /Remover do convite/ }));
    const blocked = await screen.findByRole("dialog");
    expect(within(blocked).getByText("NÃO É POSSÍVEL REMOVER")).toBeInTheDocument();
    fireEvent.click(within(blocked).getByRole("button", { name: "Excluir convite" }));

    const confirm = await screen.findByRole("dialog");
    expect(
      within(confirm).getByRole("heading", { name: "Excluir este convite?" })
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Excluir convite" }));

    expect(await screen.findByText("Mostrando 7 de 7 convites")).toBeInTheDocument();
  });

  it("deletes a guest message after the operator confirms", async () => {
    const deleteGuestMessage = vi.fn(async (messageId: string) => ({
      ok: true as const,
      messageId,
      deletedAt: "2026-08-27T12:00:00.000Z"
    }));
    await renderShell({ ...fixtureDashboardSource, demo: false, deleteGuestMessage });
    await goTo(/Recados/);

    expect(await screen.findByText("Mostrando 6 de 6 recados")).toBeInTheDocument();
    const article = (await screen.findByText(/Que alegria imensa/)).closest("article")!;
    fireEvent.click(within(article).getByRole("button", { name: /Excluir recado/ }));

    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByRole("heading", { name: "Excluir este recado?" })).toBeInTheDocument();
    expect(within(confirm).getByText("Amanda Moura")).toBeInTheDocument();
    expect(within(confirm).getByText("Esta ação não pode ser desfeita.")).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Excluir recado" }));

    expect(await screen.findByText("Mostrando 5 de 5 recados")).toBeInTheDocument();
    expect(screen.queryByText(/Que alegria imensa/)).not.toBeInTheDocument();
    expect(deleteGuestMessage).toHaveBeenCalledWith(
      "7c30a1e2-9b44-4d21-8f0a-15c7ab993410",
      expect.anything()
    );
  });

  it("keeps the recado and shows why when the delete is refused", async () => {
    const deleteGuestMessage = vi.fn(async () => {
      throw new AdminApiError("O serviço administrativo está indisponível.", "unavailable", 503);
    });
    await renderShell({ ...fixtureDashboardSource, demo: false, deleteGuestMessage });
    await goTo(/Recados/);

    const article = (await screen.findByText(/Que alegria imensa/)).closest("article")!;
    fireEvent.click(within(article).getByRole("button", { name: /Excluir recado/ }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Excluir recado" })
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("O serviço administrativo está indisponível.");
    // Still open, and still listed: the row leaves only once the API confirms.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Mostrando 6 de 6 recados")).toBeInTheDocument();
  });

  it("drops a recado that the API says is already gone", async () => {
    const deleteGuestMessage = vi.fn(async () => {
      throw new AdminApiError("Este recado não existe mais.", "rejected", 404);
    });
    await renderShell({ ...fixtureDashboardSource, demo: false, deleteGuestMessage });
    await goTo(/Recados/);

    const article = (await screen.findByText(/Que alegria imensa/)).closest("article")!;
    fireEvent.click(within(article).getByRole("button", { name: /Excluir recado/ }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Excluir recado" })
    );

    expect(await screen.findByText("Mostrando 5 de 5 recados")).toBeInTheDocument();
  });

  it("shows only the two truthful recado stats and no moderation filter tabs", async () => {
    await renderShell();
    await goTo(/Recados/);

    expect(await screen.findByText("RECADOS RECEBIDOS")).toBeInTheDocument();
    expect(screen.getByText("ÚLTIMO RECEBIDO")).toBeInTheDocument();
    expect(screen.queryByText("PUBLICADOS")).not.toBeInTheDocument();
    expect(screen.queryByText("ESCONDIDOS")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filtrar recados" })).not.toBeInTheDocument();
  });

  it("lists every music suggestion, newest first, without the site prefix", async () => {
    await renderShell();
    await goTo(/Músicas/);

    const rows = within(await screen.findByRole("list", { name: "Músicas sugeridas" })).getAllByRole(
      "button"
    );
    expect(rows.map((row) => row.getAttribute("aria-label")?.slice(0, 20))).toEqual([
      "Abrir convite SW2748",
      "Abrir convite TX6935",
      "Abrir convite HL4120",
      "Abrir convite RQ7712",
      "Abrir convite MV2093"
    ]);
    expect(screen.getByText("Evidências - Chitãozinho e Xororó")).toBeInTheDocument();
    // A note typed without the site prefix is shown exactly as the guest wrote it.
    expect(screen.getByText("Trem-Bala - Ana Vilela")).toBeInTheDocument();
    // Invitations nobody answered contribute no row.
    expect(screen.queryByRole("button", { name: /Abrir convite QP8814/ })).not.toBeInTheDocument();
    expect(screen.getByText("Mostrando 5 de 5 músicas")).toBeInTheDocument();
  });

  it("searches músicas by song, household name and code", async () => {
    await renderShell();
    await goTo(/Músicas/);
    await screen.findByRole("list", { name: "Músicas sugeridas" });

    const search = screen.getByRole("searchbox", { name: "Buscar músicas" });
    fireEvent.change(search, { target: { value: "hermanos" } });
    expect(screen.getByText("Mostrando 1 de 5 músicas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Abrir convite HL4120/ })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "queiroz" } });
    expect(screen.getByRole("button", { name: /Abrir convite RQ7712/ })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "bohemian" } });
    expect(screen.getByText("Nenhuma música corresponde a esta busca.")).toBeInTheDocument();
    expect(screen.getByText("Mostrando 0 de 5 músicas")).toBeInTheDocument();
  });

  it("opens the invitation behind a suggestion", async () => {
    await renderShell();
    await goTo(/Músicas/);

    fireEvent.click(await screen.findByRole("button", { name: /Abrir convite HL4120/ }));
    expect(await screen.findByRole("heading", { name: "Família Tavares" })).toBeInTheDocument();
  });

  it("shows the suggested song on the invitation RSVP panel, or a dash when there is none", async () => {
    await renderShell();
    openHash("#convites/SW2748");
    expect(await screen.findByText("MÚSICA SUGERIDA")).toBeInTheDocument();
    expect(screen.getByText("Evidências - Chitãozinho e Xororó")).toBeInTheDocument();

    openHash("#convites/QP8814");
    await screen.findByRole("heading", { name: "Helena Prado Ribeiro" });
    const music = screen.getByText("MÚSICA SUGERIDA").closest("div")!;
    expect(within(music).getByText("—")).toBeInTheDocument();
  });

  it("counts the music suggestions on the overview", async () => {
    await renderShell();

    const card = screen.getByRole("button", { name: /MÚSICAS/ });
    expect(within(card).getByText("5")).toBeInTheDocument();
    // 5 of the 8 fixture invitations sent a song.
    expect(within(card).getByText("63% dos convites")).toBeInTheDocument();

    fireEvent.click(card);
    expect(await screen.findByRole("heading", { name: "Músicas" })).toBeInTheDocument();
  });

  it("edits a gift and re-derives its quotas", async () => {
    await renderShell();
    await goTo(/Presentes/);

    fireEvent.click(await screen.findByRole("button", { name: /Editar Jogo de panelas/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("COTAS TOTAIS").nextElementSibling).toHaveTextContent("18");

    fireEvent.change(within(dialog).getByLabelText("VALOR TOTAL (R$)"), {
      target: { value: "1.000,00" }
    });
    expect(within(dialog).getByText("Gera 20 cotas de R$ 50,00")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: /Editar Jogo de panelas.*de R\$ 1\.000,00/ })
    ).toBeInTheDocument();
  });

  it("refuses a fractional gift total that is not a multiple of the quota", async () => {
    await renderShell();
    await goTo(/Presentes/);
    fireEvent.click(await screen.findByRole("button", { name: "Novo presente" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("NOME DO PRESENTE *"), {
      target: { value: "Batedeira" }
    });
    fireEvent.change(within(dialog).getByLabelText("VALOR TOTAL (R$) *"), {
      target: { value: "1.234,00" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar presente" }));

    expect(within(dialog).getByText(/use múltiplos de R\$ 50,00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Preencha nome, valor válido e imagem/)).toBeInTheDocument();
  });

  it("lists only invitations that own messages, and keeps the excluded one everywhere else", async () => {
    await renderShell();
    await goTo(/WhatsApp/);

    const list = await screen.findByRole("list", { name: "Conversas" });
    expect(within(list).getAllByRole("button")).toHaveLength(7);
    // LB6640 never exchanged a message, so it owns no conversation row.
    expect(screen.queryByRole("button", { name: /Conversa com Luciana Barros Freitas/ })).not.toBeInTheDocument();

    // A search that matches its household name still must not surface it.
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar conversa" }), {
      target: { value: "luciana" }
    });
    expect(screen.queryByRole("button", { name: /Conversa com Luciana Barros Freitas/ })).not.toBeInTheDocument();
    expect(screen.getByText("Nenhuma conversa corresponde a este filtro.")).toBeInTheDocument();

    // The exclusion is local to this tab: the invitation is untouched in Convites.
    await goTo(/Convites/);
    expect(await screen.findByRole("button", { name: /Abrir convite LB6640/ })).toBeInTheDocument();
  });

  it("reports the real unread total in the header and filters on it before any load", async () => {
    await renderShell();
    await goTo(/WhatsApp/);
    await screen.findByRole("list", { name: "Conversas" });

    // 2 unread on QP8814 plus 1 on ZR5567, across the 7 listed conversations.
    expect(screen.getByText("3 mensagens sem resposta · 7 conversas")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Não lidas" }));

    const list = screen.getByRole("list", { name: "Conversas" });
    expect(within(list).getAllByRole("button").map((row) => row.getAttribute("aria-label"))).toEqual([
      "Conversa com Helena Prado Ribeiro, 2 mensagens não lidas",
      "Conversa com Eduardo Nunes Filho, 1 mensagem não lida"
    ]);
    expect(screen.getByText("3 mensagens sem resposta · 2 conversas")).toBeInTheDocument();
  });

  it("names the empty list differently when no invitation has ever exchanged a message", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((invitation) => ({
      ...invitation,
      whatsappConversation: null
    }));
    await renderShell({ demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation: vi.fn() });
    await goTo(/WhatsApp/);

    expect(await screen.findByText("Nenhum convite trocou mensagens no WhatsApp ainda.")).toBeInTheDocument();
    expect(screen.getByText("0 mensagens sem resposta · 0 conversas")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Conversas" })).queryAllByRole("button")).toHaveLength(0);
  });

  it("sorts a loaded conversation and summary-only ones on one timeline", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    // RQ7712's summary is the oldest of the eight, but its loaded thread is the newest message
    // in the panel — the loaded value has to win the sort.
    snapshot.threads = {
      RQ7712: [
        { messageId: "rq-new", direction: "inbound", sentAt: "2026-09-01T09:00:00Z", text: "Mudei de ideia!" }
      ]
    };
    await renderShell({ demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation: vi.fn() });
    await goTo(/WhatsApp/);

    const list = await screen.findByRole("list", { name: "Conversas" });
    expect(
      within(list).getAllByRole("button").map((row) => row.getAttribute("aria-label")?.split(",")[0])
    ).toEqual([
      "Conversa com Rafael Queiroz",
      "Conversa com Helena Prado Ribeiro",
      "Conversa com Eugênia Ribeiro",
      "Conversa com Amanda Moura e Chris Kaneda",
      "Conversa com Eduardo Nunes Filho",
      "Conversa com Família Tavares",
      "Conversa com Marcos e Juliana Alves"
    ]);
    expect(within(list).getByText("Mudei de ideia!")).toBeInTheDocument();
  });

  it("shows a template-only summary preview with the outbound prefix", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((invitation) =>
      invitation.invitationCode === "SW2748"
        ? {
            ...invitation,
            whatsappConversation: {
              messageCount: 1,
              unreadCount: 0,
              lastMessageAt: "2026-08-18T20:18:40Z",
              lastMessageDirection: "outbound" as const,
              lastMessageType: "template" as const,
              lastMessageTemplateId: "wedding_rsvp_reconfirmation_single"
            }
          }
        : invitation
    );
    const loadWhatsappInvitation = vi.fn();
    await renderShell({ demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation });
    await goTo(/WhatsApp/);

    const row = await screen.findByRole("button", { name: "Conversa com Eugênia Ribeiro" });
    expect(within(row).getByText("Você: Mensagem de modelo: wedding_rsvp_reconfirmation_single")).toBeInTheDocument();
    expect(loadWhatsappInvitation).not.toHaveBeenCalled();
  });

  it("opens a conversation, keeps its response-needed badge, and sends a reply", async () => {
    await renderShell();
    await goTo(/WhatsApp/);

    const chat = await screen.findByRole("button", {
      name: "Conversa com Helena Prado Ribeiro, 2 mensagens não lidas"
    });
    // Preview and badge come from the summary, before any history request.
    expect(within(chat).getByText("Consegui atualizar no site? Não apareceu nada lá")).toBeInTheDocument();
    fireEvent.click(chat);

    expect(await screen.findByRole("heading", { name: "Helena Prado Ribeiro" })).toBeInTheDocument();
    expect((await screen.findAllByText("Consegui atualizar no site? Não apareceu nada lá")).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Conversa com Helena Prado Ribeiro, 2 mensagens não lidas" })
    ).toBeInTheDocument();

    const composer = screen.getByLabelText("Resposta para o convidado");
    fireEvent.change(composer, { target: { value: "Atualizamos aqui, Helena!" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(await screen.findByText("Atualizamos aqui, Helena!")).toBeInTheDocument();
    expect(composer).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "Conversa com Helena Prado Ribeiro, 2 mensagens não lidas" })
    ).not.toBeInTheDocument();
  });

  it("renders a pending bubble that settles once the backend accepts the reply", async () => {
    // Threads cleared so the conversation loads on open and the flow refresh applies.
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    let resolveSend!: () => void;
    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: async (invitationCode) =>
        threadPage(invitationCode, [], null, { whatsappFreeTextWindow: { open: true, lastInboundAt: "2026-08-20T12:00:00.000Z", expiresAt: "2126-08-21T12:00:00.000Z" } }),
      sendWhatsappText: () => new Promise((resolve) => {
        resolveSend = () => resolve({
          commandId: "idempotency-admin-text-1", invitationCode: "QP8814", status: "queued", replayed: false
        });
      })
    };
    await renderShell(source);
    openHash("#whatsapp/QP8814");

    const composer = await screen.findByLabelText("Resposta para o convidado");
    fireEvent.change(composer, { target: { value: "Já atualizamos!" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(await screen.findByText("Já atualizamos!")).toBeInTheDocument();
    // The bubble footer and the button both say so while the request is in flight.
    await waitFor(() => expect(screen.getAllByText("Enviando…")).toHaveLength(2));
    expect(screen.getByRole("button", { name: /Enviando/ })).toBeDisabled();

    await act(async () => {
      resolveSend();
    });

    await waitFor(() => expect(screen.queryAllByText("Enviando…")).toHaveLength(0));
    expect(screen.queryByText("Falha no envio")).not.toBeInTheDocument();
  });

  it("marks a rejected reply as failed and explains why in the composer", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: async (invitationCode) =>
        threadPage(invitationCode, [], null, { whatsappFreeTextWindow: { open: true, lastInboundAt: "2026-08-20T12:00:00.000Z", expiresAt: "2126-08-21T12:00:00.000Z" } }),
      sendWhatsappText: async () => {
        throw new AdminApiError("A janela de 24 horas do WhatsApp expirou.", "rejected", 422, "INVALID_INVITATION_STATE");
      }
    };
    await renderShell(source);
    openHash("#whatsapp/QP8814");

    const composer = await screen.findByLabelText("Resposta para o convidado");
    fireEvent.change(composer, { target: { value: "Tentativa" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    // The failed bubble is the only surviving record of the text the composer already cleared.
    expect(await screen.findByText("Falha no envio")).toBeInTheDocument();
    expect(screen.getByText("Tentativa")).toBeInTheDocument();
    expect(await screen.findByText("A janela de 24 horas do WhatsApp expirou.")).toBeInTheDocument();
  });

  it("disables the composer with a reason once the 24-hour window has closed", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    const sendWhatsappText = vi.fn();
    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: async (invitationCode) =>
        threadPage(invitationCode, [], null, { whatsappFreeTextWindow: { open: false } }),
      sendWhatsappText
    };
    await renderShell(source);
    openHash("#whatsapp/QP8814");

    const composer = await screen.findByLabelText("Resposta para o convidado");
    await waitFor(() => expect(composer).toBeDisabled());
    expect(
      screen.getByText("A janela de 24 h do WhatsApp expirou. Envie um modelo aprovado.")
    ).toBeInTheDocument();

    fireEvent.change(composer, { target: { value: "Oi!" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(sendWhatsappText).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Enviar/ })).toBeDisabled();
  });

  it("keeps the composer inert until there is something to send", async () => {
    await renderShell();
    openHash("#whatsapp/SW2748");

    expect(await screen.findByRole("button", { name: /^Enviar/ })).toBeDisabled();
  });

  it("shows the response-needed overview total until a reply is sent", async () => {
    await renderShell();
    const card = screen.getByRole("button", { name: /WHATSAPP/ });
    // QP8814 has 2 unread and ZR5567 has 1, across the 7 invitations that own a conversation.
    expect(card).toHaveTextContent("3");
    expect(card).toHaveTextContent("2 conversas sem resposta de 7 conversas");
    expect(card).not.toHaveTextContent("carregam sob demanda");

    await goTo(/WhatsApp/);
    fireEvent.click(
      await screen.findByRole("button", { name: "Conversa com Helena Prado Ribeiro, 2 mensagens não lidas" })
    );
    await screen.findAllByText("Consegui atualizar no site? Não apareceu nada lá");
    await goTo(/Visão geral/);

    const updated = screen.getByRole("button", { name: /WHATSAPP/ });
    expect(updated).toHaveTextContent("3");
    expect(updated).toHaveTextContent("2 conversas sem resposta de 7 conversas");
  });

  it("renders loading, first-load error, retry, and an empty loaded conversation", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((invitation) => ({ ...invitation, commands: [] }));
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<never>((_, reject) => { rejectFirst = reject; });
    const loadWhatsappInvitation = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(threadPage("SW2748", []));
    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation
    };
    await renderShell(source);
    await goTo(/WhatsApp/);
    fireEvent.click(await screen.findByRole("button", { name: "Conversa com Eugênia Ribeiro" }));
    expect(await screen.findByRole("status", { name: "" })).toHaveTextContent("Carregando conversa");

    rejectFirst(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar a conversa");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect((await screen.findAllByText("Sem mensagens")).length).toBeGreaterThan(0);
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(2);
  });

  it("loads older pages through the accessible pagination control", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((invitation) => ({ ...invitation, commands: [] }));
    const loadWhatsappInvitation = vi.fn()
      .mockResolvedValueOnce(
        threadPage("SW2748", [message("new", "2026-08-20T12:00:00Z", "Nova")], "older")
      )
      .mockResolvedValueOnce(
        threadPage("SW2748", [message("old", "2026-08-19T12:00:00Z", "Antiga")], null)
      );
    await renderShell({ demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation });
    await goTo(/WhatsApp/);
    fireEvent.click(await screen.findByRole("button", { name: "Conversa com Eugênia Ribeiro" }));
    const loadMore = await screen.findByRole("button", { name: "Carregar mensagens anteriores" });
    loadMore.focus();
    fireEvent.click(loadMore);

    expect(await screen.findByText("Antiga")).toBeInTheDocument();
    expect(screen.getAllByText("Nova").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Histórico da conversa")).toHaveFocus();
    expect(loadWhatsappInvitation).toHaveBeenNthCalledWith(2, "SW2748", "older", expect.any(AbortSignal));
  });

  it("retains loaded messages on load-more error and retries with the same cursor", async () => {
    const snapshot = snapshotWithSummary("SW2748", {
      messageCount: 2,
      unreadCount: 0,
      lastMessageAt: "2026-08-20T12:00:00Z",
      lastMessageDirection: "inbound",
      lastMessageType: "text",
      lastMessagePreview: "Nova"
    });
    const loadWhatsappInvitation = vi.fn()
      .mockResolvedValueOnce(
        threadPage("SW2748", [message("new", "2026-08-20T12:00:00Z", "Nova")], "older")
      )
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(
        threadPage("SW2748", [message("old", "2026-08-19T12:00:00Z", "Antiga")], null)
      );
    await renderShell({ demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation });
    await goTo(/WhatsApp/);
    fireEvent.click(await screen.findByRole("button", { name: "Conversa com Eugênia Ribeiro" }));
    expect((await screen.findAllByText("Nova")).length).toBeGreaterThan(0);

    const loadMore = await screen.findByRole("button", { name: "Carregar mensagens anteriores" });
    fireEvent.click(loadMore);

    // Failed load-more displays the error alert, while keeping the already-loaded message.
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar a conversa");
    expect(screen.getAllByText("Nova").length).toBeGreaterThan(0);

    // Clicking retry resumes from the stored cursor "older".
    const retry = screen.getByRole("button", { name: "Tentar novamente" });
    fireEvent.click(retry);

    expect(await screen.findByText("Antiga")).toBeInTheDocument();
    expect(screen.getAllByText("Nova").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(3);
    expect(loadWhatsappInvitation).toHaveBeenNthCalledWith(2, "SW2748", "older", expect.any(AbortSignal));
    expect(loadWhatsappInvitation).toHaveBeenNthCalledWith(3, "SW2748", "older", expect.any(AbortSignal));
  });

  it("preserves scroll position and returns focus to the pagination control across older page loads", async () => {
    const snapshot = snapshotWithSummary("SW2748", {
      messageCount: 3,
      unreadCount: 0,
      lastMessageAt: "2026-08-20T12:00:00Z",
      lastMessageDirection: "inbound",
      lastMessageType: "text",
      lastMessagePreview: "Nova"
    });
    const loadWhatsappInvitation = vi.fn()
      .mockResolvedValueOnce(
        threadPage("SW2748", [message("m3", "2026-08-20T12:00:00Z", "Mensagem 3")], "cursor-2")
      )
      .mockResolvedValueOnce(
        threadPage("SW2748", [message("m2", "2026-08-19T12:00:00Z", "Mensagem 2")], "cursor-1")
      )
      .mockResolvedValueOnce(
        threadPage("SW2748", [message("m1", "2026-08-18T12:00:00Z", "Mensagem 1")], null)
      );
    await renderShell({ demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation });
    await goTo(/WhatsApp/);
    fireEvent.click(await screen.findByRole("button", { name: "Conversa com Eugênia Ribeiro" }));
    const historyContainer = await screen.findByLabelText("Histórico da conversa");

    let scrollTopVal = 100;
    Object.defineProperty(historyContainer, "scrollHeight", {
      configurable: true,
      get: () => (
        historyContainer.textContent?.includes("Mensagem 1")
          ? 1100
          : historyContainer.textContent?.includes("Mensagem 2")
            ? 800
            : 500
      )
    });
    Object.defineProperty(historyContainer, "scrollTop", {
      configurable: true,
      get: () => scrollTopVal,
      set: (val: number) => {
        scrollTopVal = val;
      }
    });

    const loadMore1 = await screen.findByRole("button", { name: "Carregar mensagens anteriores" });
    fireEvent.click(loadMore1);

    expect(await screen.findByText("Mensagem 2")).toBeInTheDocument();
    // Scroll adjusted: scrollTop = preserved.top (100) + new scrollHeight (800) - old scrollHeight (500) = 400
    expect(scrollTopVal).toBe(400);

    // Focus returns to the load-older button because more messages remain (cursor-1, 2 of 3 loaded)
    const loadMore2 = screen.getByRole("button", { name: "Carregar mensagens anteriores" });
    expect(loadMore2).toHaveFocus();

    // Now load the final page
    fireEvent.click(loadMore2);

    expect(await screen.findByText("Mensagem 1")).toBeInTheDocument();
    expect(scrollTopVal).toBe(700);
    // Because all 3 messages are now loaded, load-older unmounts and focus returns to the history container
    expect(loadOlderControl()).not.toBeInTheDocument();
    expect(historyContainer).toHaveFocus();
  });

  it("gates the load-older control on both cursor and summary count", async () => {
    // Behavior 21: A query that exhausted the thread but still received a LastEvaluatedKey
    // must NOT render the load-older button if messageCount is already met.
    const snapshot = snapshotWithSummary("SW2748", {
      messageCount: 2,
      unreadCount: 0,
      lastMessageAt: "2026-08-20T12:00:00Z",
      lastMessageDirection: "inbound",
      lastMessageType: "text",
      lastMessagePreview: "Nova"
    });
    const loadWhatsappInvitation = vi.fn().mockResolvedValueOnce(
      threadPage(
        "SW2748",
        [
          message("m1", "2026-08-19T12:00:00Z", "Antiga"),
          message("m2", "2026-08-20T12:00:00Z", "Nova")
        ],
        "spurious-next-cursor"
      )
    );
    await renderShell({ demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation });
    await goTo(/WhatsApp/);
    fireEvent.click(await screen.findByRole("button", { name: "Conversa com Eugênia Ribeiro" }));

    expect((await screen.findAllByText("Nova")).length).toBeGreaterThan(0);
    expect(screen.getByText("Antiga")).toBeInTheDocument();
    // Gated on summary count (2 loaded == 2 summary count), so the button is not offered
    expect(loadOlderControl()).not.toBeInTheDocument();
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(1);
  });

  it("removes the load-older control when message count reaches summary without extra requests", async () => {
    // Behavior 22: When paginating, the control disappears the moment loaded count reaches summary count
    const snapshot = snapshotWithSummary("QP8814", {
      messageCount: 2,
      unreadCount: 0,
      lastMessageAt: "2026-08-20T12:00:00Z",
      lastMessageDirection: "inbound",
      lastMessageType: "text",
      lastMessagePreview: "QP Nova"
    });
    const loadWhatsappInvitation = vi.fn()
      .mockResolvedValueOnce(
        threadPage("QP8814", [message("qp-new", "2026-08-20T12:00:00Z", "QP Nova")], "cursor-qp")
      )
      .mockResolvedValueOnce(
        threadPage("QP8814", [message("qp-old", "2026-08-19T12:00:00Z", "QP Antiga")], "cursor-extra")
      );
    await renderShell({ demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation });
    await goTo(/WhatsApp/);
    fireEvent.click(await screen.findByRole("button", { name: "Conversa com Helena Prado Ribeiro" }));

    const loadMoreBtn = await screen.findByRole("button", { name: "Carregar mensagens anteriores" });
    fireEvent.click(loadMoreBtn);

    expect(await screen.findByText("QP Antiga")).toBeInTheDocument();
    expect(loadOlderControl()).not.toBeInTheDocument();
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(2);
  });

  it("lets the loaded thread win for display when a summary is stale and keeps the pagination control available", async () => {
    // Summary was taken earlier (messageCount: 2, lastMessageAt: 12:00).
    // A guest message arrived at 13:00 (after snapshot).
    // First page returns the 13:00 message and the 12:00 message, with nextCursor: "older-page".
    const snapshot = snapshotWithSummary("SW2748", {
      messageCount: 2,
      unreadCount: 0,
      lastMessageAt: "2026-08-20T12:00:00Z",
      lastMessageDirection: "inbound",
      lastMessageType: "text",
      lastMessagePreview: "Mensagem do snapshot"
    });
    const loadWhatsappInvitation = vi.fn()
      .mockResolvedValueOnce(
        threadPage(
          "SW2748",
          [
            message("m-snap", "2026-08-20T12:00:00Z", "Mensagem do snapshot"),
            message("m-newer", "2026-08-20T13:00:00Z", "Mensagem recente pós-snapshot")
          ],
          "older-page"
        )
      )
      .mockResolvedValueOnce(
        threadPage(
          "SW2748",
          [message("m-oldest", "2026-08-19T10:00:00Z", "Mensagem mais antiga")],
          null
        )
      );
    await renderShell({ demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation });
    await goTo(/WhatsApp/);
    fireEvent.click(await screen.findByRole("button", { name: "Conversa com Eugênia Ribeiro" }));

    // Loaded thread wins for display
    expect((await screen.findAllByText("Mensagem recente pós-snapshot")).length).toBeGreaterThan(0);
    expect(screen.getByText("Mensagem do snapshot")).toBeInTheDocument();

    // Control is not stranded: the 13:00 message is discounted from the summary count, so
    // only 1 message (<= 12:00) is accounted for against messageCount: 2.
    const loadOlder = await screen.findByRole("button", { name: "Carregar mensagens anteriores" });
    fireEvent.click(loadOlder);

    expect(await screen.findByText("Mensagem mais antiga")).toBeInTheDocument();
    expect(loadOlderControl()).not.toBeInTheDocument();
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(2);
  });

  it("renders accessible loading status and button during thread loads", async () => {
    const snapshot = snapshotWithSummary("SW2748", {
      messageCount: 2,
      unreadCount: 0,
      lastMessageAt: "2026-08-20T12:00:00Z",
      lastMessageDirection: "inbound",
      lastMessageType: "text",
      lastMessagePreview: "Nova"
    });
    let resolveFirst!: (page: AdminWhatsappInvitationPage) => void;
    let resolveSecond!: (page: AdminWhatsappInvitationPage) => void;
    const loadWhatsappInvitation = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    await renderShell({ demo: false, deleteGuestMessage: vi.fn(), updateGuest: vi.fn(), confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(), load: async () => snapshot, loadWhatsappInvitation });
    await goTo(/WhatsApp/);
    fireEvent.click(await screen.findByRole("button", { name: "Conversa com Eugênia Ribeiro" }));

    // First load in flight: role="status" with accessible text
    expect(await screen.findByRole("status")).toHaveTextContent("Carregando conversa…");

    resolveFirst(threadPage("SW2748", [message("m2", "2026-08-20T12:00:00Z", "Nova")], "cursor-1"));
    expect(await screen.findByRole("button", { name: "Carregar mensagens anteriores" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Carregar mensagens anteriores" }));

    // Load-more in flight: disabled button with aria-busy="true" and loading label
    const loadingMoreButton = await screen.findByRole("button", { name: "Carregando mensagens anteriores…" });
    expect(loadingMoreButton).toBeDisabled();
    expect(loadingMoreButton).toHaveAttribute("aria-busy", "true");

    resolveSecond(threadPage("SW2748", [message("m1", "2026-08-19T12:00:00Z", "Antiga")], null));
    expect(await screen.findByText("Antiga")).toBeInTheDocument();
  });
});

describe("invite-detail WhatsApp flow panel states", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/dashboard");
  });

  it("renders loading state while invitation flow is loading", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((i) => ({ ...i, commands: [] }));

    let resolveLoad!: (page: AdminWhatsappInvitationPage) => void;
    const pendingLoad = new Promise<AdminWhatsappInvitationPage>((resolve) => {
      resolveLoad = resolve;
    });

    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: vi.fn(() => pendingLoad)
    };

    await renderShell(source);
    openHash("#convites/SW2748");

    expect(await screen.findByRole("status")).toHaveTextContent("Carregando fluxo do WhatsApp…");

    resolveLoad(threadPage("SW2748", []));
    await screen.findByText("Nenhuma mensagem enviada ainda. Este convite ainda não entrou no fluxo.");
  });

  it("renders error state with retry button on invitation flow load failure and retries successfully", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((i) => ({ ...i, commands: [] }));

    const loadWhatsappInvitation = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        threadPage("SW2748", [], null, {
          whatsappFlowStatus: "attendance_confirmed_whatsapp"
        })
      );

    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation
    };

    await renderShell(source);
    openHash("#convites/SW2748");

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar o fluxo do WhatsApp");
    const retryBtn = screen.getByRole("button", { name: "Tentar novamente" });
    fireEvent.click(retryBtn);

    expect(await screen.findByText("Nenhuma mensagem enviada ainda. Este convite ainda não entrou no fluxo.")).toBeInTheDocument();
    expect(loadWhatsappInvitation).toHaveBeenCalledTimes(2);
  });

  it("renders empty state when invitation has zero commands", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((i) => ({ ...i, commands: [] }));

    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: vi.fn().mockResolvedValue(threadPage("SW2748", []))
    };

    await renderShell(source);
    openHash("#convites/SW2748");

    expect(await screen.findByText("Nenhuma mensagem enviada ainda. Este convite ainda não entrou no fluxo.")).toBeInTheDocument();
  });

  it("renders populated commands and bounded-history copy", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((i) => ({ ...i, commands: [] }));

    const invitationPageData: AdminWhatsappInvitationPage = {
      flow: {
        ...defaultFlow("SW2748"),
        whatsappFlowStage: "reconfirmation"
      },
      page: {
        invitationCode: "SW2748",
        messages: [],
        commands: [
          {
            commandId: "cmd-1",
            createdAt: "2026-08-20T14:00:00Z",
            templateId: "wedding_rsvp_reconfirmation_single",
            stage: "reconfirmation",
            status: "sent",
            retryCount: 1,
            reconciliationStatus: "none"
          }
        ],
        nextCursor: null
      }
    };

    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: vi.fn().mockResolvedValue(invitationPageData)
    };

    await renderShell(source);
    openHash("#convites/SW2748");

    expect(await screen.findByText("Envios recentes · Etapa Reconfirmação")).toBeInTheDocument();
    expect(screen.getByText("wedding_rsvp_reconfirmation_single")).toBeInTheDocument();
    expect(screen.getByText(/1 tentativa/)).toBeInTheDocument();
  });

  it("renders the newest body independently for the last send and last response", async () => {
    const summary: AdminWhatsappConversationSummary = {
      messageCount: 4,
      unreadCount: 1,
      lastMessageAt: "2026-08-20T14:00:00Z",
      lastMessageDirection: "inbound",
      lastMessageType: "text",
      lastMessagePreview: "Resposta mais nova",
      lastOutboundMessagePreview: "Envio mais novo",
      lastInboundMessagePreview: "Resposta mais nova"
    };
    const snapshot = snapshotWithSummary("SW2748", summary);
    snapshot.threads = {};
    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: vi.fn().mockResolvedValue(threadPage("SW2748", []))
    };

    await renderShell(source);
    openHash("#convites/SW2748");

    expect(await screen.findByText("Envio mais novo")).toBeInTheDocument();
    expect(screen.getByText("Resposta mais nova")).toBeInTheDocument();
  });

  it("falls back to the direction-specific template IDs when bodies are unavailable", async () => {
    const summary: AdminWhatsappConversationSummary = {
      messageCount: 2,
      unreadCount: 1,
      lastMessageAt: "2026-08-20T14:00:00Z",
      lastMessageDirection: "inbound",
      lastMessageType: "template",
      lastOutboundMessageTemplateId: "wedding_rsvp_attending_followup_website",
      lastInboundMessageTemplateId: "wedding_rsvp_reconfirmation_single"
    };
    const snapshot = snapshotWithSummary("SW2748", summary);
    snapshot.threads = {};
    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: vi.fn().mockResolvedValue(threadPage("SW2748", []))
    };

    await renderShell(source);
    openHash("#convites/SW2748");

    expect(await screen.findByText("wedding_rsvp_attending_followup_website")).toBeInTheDocument();
    expect(screen.getByText("wedding_rsvp_reconfirmation_single")).toBeInTheDocument();
  });

  it("renders failure reason and refreshed status in invitation flow state panel", async () => {
    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((i) => ({ ...i, commands: [] }));

    const invitationPageData: AdminWhatsappInvitationPage = {
      flow: {
        ...defaultFlow("SW2748"),
        whatsappFlowStatus: "failed",
        whatsappFailureReason: "Número de WhatsApp inválido ou sem conta"
      },
      page: {
        invitationCode: "SW2748",
        messages: [],
        commands: [],
        nextCursor: null
      }
    };

    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load: async () => snapshot,
      loadWhatsappInvitation: vi.fn().mockResolvedValue(invitationPageData)
    };

    await renderShell(source);
    openHash("#convites/SW2748");

    expect(await screen.findByText("Número de WhatsApp inválido ou sem conta")).toBeInTheDocument();
    expect(screen.getByText("MOTIVO DA FALHA")).toBeInTheDocument();
    expect(screen.getAllByText("Falha no envio").length).toBeGreaterThanOrEqual(1);
  });

  it("asserts the exact request sequence across a full operator session (decision 2 E2E)", async () => {
    const requestLog: Array<{ type: "dashboard" } | { type: "whatsapp"; code: string; cursor?: string }> = [];

    const snapshot = createFixtureDashboardSnapshot();
    snapshot.threads = {};
    snapshot.invitations = snapshot.invitations.map((i) => ({ ...i, commands: [] }));

    const load = vi.fn().mockImplementation(async () => {
      requestLog.push({ type: "dashboard" });
      return snapshot;
    });

    const page1Messages = [
      message("sw-2", "2026-08-20T12:00:00Z", "Nova mensagem"),
      message("sw-3", "2026-08-20T12:01:00Z", "Última mensagem")
    ];
    const page2Messages = [
      message("sw-1", "2026-08-19T10:00:00Z", "Mensagem anterior")
    ];

    const loadWhatsappInvitation = vi.fn().mockImplementation(async (invitationCode: string, cursor?: string) => {
      requestLog.push({ type: "whatsapp", code: invitationCode, cursor });
      if (cursor === "cursor-older") {
        return threadPage(invitationCode, page2Messages, null);
      }
      return threadPage(invitationCode, page1Messages, "cursor-older");
    });

    const source: AdminDashboardSource = {
      demo: false,
      deleteGuestMessage: vi.fn(),
      updateGuest: vi.fn(),
      confirmGuests: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), addGuests: vi.fn(), removeGuest: vi.fn(),
      load,
      loadWhatsappInvitation
    };

    // 1. Initial dashboard load: exactly 1 dashboard request, 0 WhatsApp requests
    await renderShell(source);
    expect(requestLog).toEqual([{ type: "dashboard" }]);

    // 2. Render every tab, search, and filter without issuing ANY network requests:
    // 2a. Convites tab + search + filter
    await goTo(/Convites/);
    expect(await screen.findByRole("heading", { name: "Convites" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar convites" }), {
      target: { value: "Tavares" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Pendentes" }));
    expect(requestLog).toHaveLength(1);

    // 2b. Convidados tab
    await goTo(/Convidados/);
    expect(await screen.findByRole("heading", { name: "Convidados" })).toBeInTheDocument();
    expect(requestLog).toHaveLength(1);

    // 2c. Recados tab
    await goTo(/Recados/);
    expect(await screen.findByRole("heading", { name: "Recados" })).toBeInTheDocument();
    expect(requestLog).toHaveLength(1);

    // 2d. Músicas tab
    await goTo(/Músicas/);
    expect(await screen.findByRole("heading", { name: "Músicas" })).toBeInTheDocument();
    expect(requestLog).toHaveLength(1);

    // 2e. Presentes tab
    await goTo(/Presentes/);
    expect(await screen.findByRole("heading", { name: "Presentes" })).toBeInTheDocument();
    expect(requestLog).toHaveLength(1);

    // 2f. WhatsApp tab + search + filter: renders summaries only, 0 WhatsApp requests
    await goTo(/WhatsApp/);
    expect(await screen.findByRole("heading", { name: "WhatsApp" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar conversa" }), {
      target: { value: "Ribeiro" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Não lidas" }));
    expect(requestLog).toHaveLength(1);

    // 3. Open an invitation: exactly 1 WhatsApp request
    openHash("#convites/SW2748");
    expect(await screen.findByRole("heading", { name: "Eugênia Ribeiro" })).toBeInTheDocument();
    await waitFor(() => expect(requestLog).toHaveLength(2));
    expect(requestLog[1]).toEqual({ type: "whatsapp", code: "SW2748", cursor: undefined });

    // 4. Open its conversation: already loaded, 0 additional requests
    openHash("#whatsapp/SW2748");
    expect(await screen.findByRole("heading", { name: "Eugênia Ribeiro" })).toBeInTheDocument();
    expect(requestLog).toHaveLength(2);

    // 5. Load older messages: exactly 1 WhatsApp request with cursor
    const olderBtn = await screen.findByRole("button", { name: "Carregar mensagens anteriores" });
    fireEvent.click(olderBtn);
    await waitFor(() => expect(requestLog).toHaveLength(3));
    expect(requestLog[2]).toEqual({ type: "whatsapp", code: "SW2748", cursor: "cursor-older" });

    // 6. Refresh: 1 dashboard request + 1 WhatsApp reload for currently open conversation
    fireEvent.click(screen.getByRole("button", { name: "Atualizar dados" }));
    await waitFor(() => expect(requestLog).toHaveLength(5));
    expect(requestLog[3]).toEqual({ type: "dashboard" });
    expect(requestLog[4]).toEqual({ type: "whatsapp", code: "SW2748", cursor: undefined });

    // 7. Reopen: navigate away to Overview, then back to WhatsApp conversation -> 0 new requests
    await goTo(/Visão geral/);
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeInTheDocument();
    openHash("#whatsapp/SW2748");
    expect(await screen.findByRole("heading", { name: "Eugênia Ribeiro" })).toBeInTheDocument();
    expect(requestLog).toHaveLength(5);

    // 8. Assert exact sequence
    expect(requestLog).toEqual([
      { type: "dashboard" },
      { type: "whatsapp", code: "SW2748", cursor: undefined },
      { type: "whatsapp", code: "SW2748", cursor: "cursor-older" },
      { type: "dashboard" },
      { type: "whatsapp", code: "SW2748", cursor: undefined }
    ]);
  });
});
