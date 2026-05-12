import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../src/App";

describe("official web app", () => {
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

    fireEvent.click(screen.getAllByRole("button", { name: /Contribuir|Escolher presente/i })[0]);

    expect(
      await screen.findByRole("heading", { name: /PIX Teste|4 Toalhas de Banho|Armário de Cozinha/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByLabelText("Seu e-mail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ir para o pagamento" })).toBeDisabled();
  });

  it("resolves an RSVP group and supports ambiguous search results", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Digite seu nome para localizar seu convite"), {
      target: { value: "Débora" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Localizar convite" }));

    expect(
      await screen.findByText("Confirme quais convidados do seu convite irão comparecer:")
    ).toBeInTheDocument();
    expect(screen.getByText("Débora")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enviar confirmação" }));
    expect(await screen.findByText(/Recebemos sua confirmação com carinho!/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar outro convite/i }));
    fireEvent.change(screen.getByLabelText("Digite seu nome para localizar seu convite"), {
      target: { value: "Car" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Localizar convite" }));

    expect(
      await screen.findByText(
        "Encontramos mais de um convite parecido. Selecione o seu grupo para continuar."
      )
    ).toBeInTheDocument();
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
