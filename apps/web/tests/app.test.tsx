import { render, screen } from "@testing-library/react";
import { App } from "../src/app/App";

describe("App", () => {
  it("renders the Brimax landing page shell", () => {
    render(<App />);

    expect(screen.getByText("Brimax Life")).toBeInTheDocument();
    expect(screen.getByText("RSVP")).toBeInTheDocument();
    expect(screen.getByText("Digital Registry")).toBeInTheDocument();
  });
});
