import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Privacidade from "@/pages/Privacidade";
import App from "../src/App";

describe("Privacidade Page", () => {
  it("renders all required LGPD and wedding privacy policy sections and content", () => {
    window.scrollTo = vi.fn();
    render(<Privacidade />);

    // Header & Badges
    expect(
      screen.getByRole("heading", { level: 1, name: "Política de Privacidade" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Transparência & Privacidade/i)).toBeInTheDocument();
    expect(screen.getByText(/Em conformidade com a LGPD/i)).toBeInTheDocument();
    expect(screen.getByText(/06 de Dezembro de 2026/i)).toBeInTheDocument();

    // 1. Controlador dos Dados
    expect(
      screen.getByRole("heading", { level: 2, name: "1. Controlador dos Dados" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Casamento Brida & Max/i)).toBeInTheDocument();
    expect(screen.getAllByText(/06\/12\/2026/i).length).toBeGreaterThanOrEqual(1);

    // 2. Dados Pessoais Coletados
    expect(
      screen.getByRole("heading", { level: 2, name: "2. Dados Pessoais Coletados" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Identificação & Família" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Contato & WhatsApp" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Confirmação de Presença (RSVP)" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Mural de Recados" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Presentes e Doações via Pix:/i)).toBeInTheDocument();

    // 3. Finalidade do Tratamento
    expect(
      screen.getByRole("heading", { level: 2, name: "3. Finalidade do Tratamento" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Organização e Gestão de Convidados:/i)).toBeInTheDocument();
    expect(screen.getByText(/Notificações e Confirmações via WhatsApp:/i)).toBeInTheDocument();
    expect(screen.getByText(/Exibição de Mensagens no Mural:/i)).toBeInTheDocument();
    expect(screen.getByText(/Gestão da Lista de Presentes:/i)).toBeInTheDocument();

    // 4. Compartilhamento com Terceiros (Operadores)
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "4. Compartilhamento com Terceiros (Operadores)"
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/Meta Platforms \/ WhatsApp Cloud API/i)).toBeInTheDocument();
    expect(screen.getByText(/Asaas Gestão Financeira/i)).toBeInTheDocument();
    expect(screen.getByText(/Amazon Web Services \(AWS\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Compromisso de Não Comercialização/i)).toBeInTheDocument();

    // 5. Segurança e Retenção
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "5. Segurança da Informação e Retenção"
      })
    ).toBeInTheDocument();

    // 6. Direitos do Titular (LGPD)
    expect(
      screen.getByRole("heading", { level: 2, name: "6. Direitos do Titular (LGPD)" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Confirmação e Acesso/i)).toBeInTheDocument();
    expect(screen.getByText(/Correção e Atualização/i)).toBeInTheDocument();
    expect(screen.getByText(/Exclusão ou Anonimização/i)).toBeInTheDocument();

    // 7. Canal de Contato
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "7. Canal de Atendimento e Dúvidas"
      })
    ).toBeInTheDocument();
    const contactLinks = screen.getAllByRole("link", { name: "casamento@brimax.life" });
    expect(contactLinks.length).toBeGreaterThanOrEqual(1);
    expect(contactLinks[0]).toHaveAttribute("href", "mailto:casamento@brimax.life");

    // Navigation back to home
    const backLinks = screen.getAllByRole("link", { name: /Voltar para o início/i });
    expect(backLinks.length).toBeGreaterThanOrEqual(1);
    expect(backLinks[0]).toHaveAttribute("href", "/");
  });

  it("routes /privacidade cleanly via App router", () => {
    window.history.replaceState({}, "", "/privacidade");
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Política de Privacidade" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nossa História" })).not.toBeInTheDocument();
    expect(screen.getByText(/Casamento Brida & Max/i)).toBeInTheDocument();
  });

  it("renders the privacy policy link in the landing page footer", () => {
    window.history.replaceState({}, "", "/");
    render(<App />);

    const footerLink = screen.getByRole("link", { name: "Política de Privacidade" });
    expect(footerLink).toBeInTheDocument();
    expect(footerLink).toHaveAttribute("href", "/privacidade");
  });
});
