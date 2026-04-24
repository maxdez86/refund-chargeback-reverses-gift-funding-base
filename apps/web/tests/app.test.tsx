import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../src/app/App";

describe("App", () => {
  it("renders the wedding landing page in pt-BR", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Brida e Max" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contagem" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nossa História" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lista de Presentes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confirmação por grupo de convite" })).toBeInTheDocument();
  });

  it("opens the gift dialog and keeps funded gifts disabled", async () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole("button", { name: "Escolher cotas" })[0]);
    const dialog = await waitFor(() => {
      const element = document.querySelector(".gift-dialog[open]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });

    expect(within(dialog).getByRole("heading", { name: "Robô de Cozinha" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar contribuição" }));
    expect(
      screen.getByText("Obrigado pelo seu interesse! O link para a lista completa estará disponível em breve.")
    ).toBeInTheDocument();

    expect(document.querySelector(".gift-action.is-disabled")).toHaveAttribute("aria-disabled", "true");
  });

  it("resolves an invitation group and prevents adding names", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Digite seu nome para localizar seu convite"), {
      target: { value: "Débora" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Localizar convite" }));

    expect(await screen.findByText("Confirme quais convidados do seu convite irão comparecer:")).toBeInTheDocument();
    expect(screen.getByLabelText("Débora")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Adicionar/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar presença" }));

    await waitFor(() =>
      expect(screen.getByText("Confirmação registrada nesta experiência de teste.")).toBeInTheDocument()
    );
  });

  it("shows ambiguous RSVP choices when the search is not specific enough", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Digite seu nome para localizar seu convite"), {
      target: { value: "Car" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Localizar convite" }));

    expect(await screen.findAllByText("Encontramos mais de um convite parecido.")).toHaveLength(2);
    expect(document.querySelectorAll(".rsvp-choice-card").length).toBeGreaterThan(1);
  });
});
