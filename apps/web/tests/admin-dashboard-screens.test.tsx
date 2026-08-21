import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResponse } from "@brimax/contracts";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

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
const renderShell = async () => {
  const utils = render(<DashboardShell session={session} preview={false} onSignOut={vi.fn()} />);
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

describe("dashboard screens", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/dashboard");
  });

  it("opens an invitation from the list and returns with the back link", async () => {
    await renderShell();
    await goTo(/Convites/);

    fireEvent.click(await screen.findByRole("button", { name: /Abrir convite HL4120/ }));
    expect(await screen.findByRole("heading", { name: "Família Tavares" })).toBeInTheDocument();
    expect(screen.getByText("Etapa atual · Follow-up")).toBeInTheDocument();

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
      target: { value: "brx-014" }
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
    expect(screen.getByRole("button", { name: /Abrir convite BRX-014/ })).toBeInTheDocument();
  });

  it("creates a guest flagged as a child from the new-invitation form", async () => {
    await renderShell();
    await goTo(/Convites/);
    fireEvent.click(await screen.findByRole("button", { name: "Novo convite" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("CÓDIGO DO CONVITE *"), {
      target: { value: "BRX-015" }
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

    fireEvent.click(await screen.findByRole("button", { name: /Abrir convite BRX-015/ }));
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

  it("queues a retry for a failed invitation", async () => {
    await renderShell();
    openHash("#convites/LB6640");

    fireEvent.click(await screen.findByRole("button", { name: "Enviar WhatsApp" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("RETENTATIVA")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reenviar mensagem" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The queued opener heads the timeline and the flow badge follows it.
    expect(screen.getByText("NA FILA")).toBeInTheDocument();
    expect(screen.getAllByText("Envio na fila").length).toBeGreaterThan(0);
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

  it("hides a guest message from the mural and puts it back", async () => {
    await renderShell();
    await goTo(/Recados/);

    const article = (await screen.findByText(/Que alegria imensa/)).closest("article")!;
    fireEvent.click(within(article).getByRole("button", { name: /Esconder do site/ }));

    expect(await screen.findByText("PUBLICADOS")).toBeInTheDocument();
    expect(screen.getAllByText("ESCONDIDO DO SITE")).toHaveLength(2);

    fireEvent.click(within(article).getByRole("button", { name: /Mostrar no site/ }));
    expect(screen.getAllByText("ESCONDIDO DO SITE")).toHaveLength(1);
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

  it("opens a conversation, clears its unread badge and sends a reply", async () => {
    await renderShell();
    await goTo(/WhatsApp/);

    const chat = await screen.findByRole("button", { name: /Conversa com Helena Prado Ribeiro, 2/ });
    fireEvent.click(chat);

    expect(await screen.findByRole("heading", { name: "Helena Prado Ribeiro" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Conversa com Helena Prado Ribeiro, 2/ })
    ).not.toBeInTheDocument();

    const composer = screen.getByLabelText("Resposta para o convidado");
    fireEvent.change(composer, { target: { value: "Atualizamos aqui, Helena!" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    expect(await screen.findByText("Atualizamos aqui, Helena!")).toBeInTheDocument();
    expect(composer).toHaveValue("");
  });

  it("keeps the composer inert until there is something to send", async () => {
    await renderShell();
    openHash("#whatsapp/SW2748");

    expect(await screen.findByRole("button", { name: /^Enviar/ })).toBeDisabled();
  });
});
