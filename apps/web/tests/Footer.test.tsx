import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Footer } from "../src/components/sections/Footer";

describe("Footer", () => {
  it("renders the RSVP platform attribution", () => {
    render(<Footer />);

    const attribution = screen.getByText(
      "Plataforma de RSVP desenvolvida e operada por MAXUEL GUIMARAES REIS CONSULTORIA EM TECNOLOGIA DA INFORMACAO - CNPJ 42.781.389/0001-08",
    );

    expect(attribution).toHaveClass("mt-4", "text-center", "text-xs");
  });
});
