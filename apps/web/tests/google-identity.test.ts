import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleSignInButton } from "@/components/dashboard/GoogleSignInButton";
import { disableGoogleAutoSelect, loadGoogleIdentityServices } from "@/lib/google-identity";

afterEach(() => {
  delete window.google;
});

describe("Google Identity Services", () => {
  it("loads the official script and reuses an in-flight request", async () => {
    const isolatedDocument = document.implementation.createHTMLDocument();
    const first = loadGoogleIdentityServices(isolatedDocument);
    const second = loadGoogleIdentityServices(isolatedDocument);
    expect(second).toBe(first);
    const script = isolatedDocument.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    expect(script).not.toBeNull();

    const id = { initialize: vi.fn(), renderButton: vi.fn(), disableAutoSelect: vi.fn() };
    window.google = { accounts: { id } };
    script?.dispatchEvent(new Event("load"));
    await expect(first).resolves.toBe(id);
  });

  it("rejects a failed script load and removes the failed element", async () => {
    const isolatedDocument = document.implementation.createHTMLDocument();
    const loading = loadGoogleIdentityServices(isolatedDocument);
    const script = isolatedDocument.querySelector("script");
    script?.dispatchEvent(new Event("error"));
    await expect(loading).rejects.toThrow("Não foi possível carregar");
    expect(isolatedDocument.querySelector("script")).toBeNull();
  });

  it("clears the rejected load when the script does not expose Google and allows retry", async () => {
    const isolatedDocument = document.implementation.createHTMLDocument();
    const firstLoad = loadGoogleIdentityServices(isolatedDocument);
    const firstScript = isolatedDocument.querySelector<HTMLScriptElement>("script");
    firstScript?.dispatchEvent(new Event("load"));

    await expect(firstLoad).rejects.toThrow("não ficou disponível");
    expect(isolatedDocument.querySelector("script")).toBeNull();

    const retry = loadGoogleIdentityServices(isolatedDocument);
    const retryScript = isolatedDocument.querySelector<HTMLScriptElement>("script");
    expect(retryScript).not.toBe(firstScript);

    const id = { initialize: vi.fn(), renderButton: vi.fn(), disableAutoSelect: vi.fn() };
    window.google = { accounts: { id } };
    retryScript?.dispatchEvent(new Event("load"));

    await expect(retry).resolves.toBe(id);
  });

  it("initializes and renders the standard localized button", async () => {
    let callback: ((response: GoogleCredentialResponse) => void) | undefined;
    const id = {
      initialize: vi.fn((config: GoogleIdConfiguration) => { callback = config.callback; }),
      renderButton: vi.fn((parent: HTMLElement) => { parent.textContent = "Google"; }),
      disableAutoSelect: vi.fn()
    };
    window.google = { accounts: { id } };
    const onCredential = vi.fn();
    render(
      createElement(GoogleSignInButton, {
        clientId: "dev-client",
        hostedDomain: "brimax.life",
        onCredential
      })
    );

    await screen.findByText("Google");
    expect(id.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: "dev-client", hd: "brimax.life" }));
    expect(id.renderButton).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ locale: "pt-BR", width: 280 }));
    callback?.({ credential: "google-token" });
    expect(onCredential).toHaveBeenCalledWith("google-token");
  });

  it("shows a retryable state when the Google script is unavailable", async () => {
    render(
      createElement(GoogleSignInButton, {
        clientId: "dev-client",
        hostedDomain: "brimax.life",
        onCredential: vi.fn()
      })
    );
    expect(screen.getByText("Preparando acesso seguro…")).toBeInTheDocument();
    document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
      ?.dispatchEvent(new Event("error"));

    expect(await screen.findByText("Não foi possível carregar o acesso pelo Google.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(screen.getByText("Preparando acesso seguro…")).toBeInTheDocument();
    expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).not.toBeNull();
  });

  it("disables automatic selection when Google is available", () => {
    const disableAutoSelect = vi.fn();
    window.google = { accounts: { id: { initialize: vi.fn(), renderButton: vi.fn(), disableAutoSelect } } };
    disableGoogleAutoSelect();
    expect(disableAutoSelect).toHaveBeenCalledOnce();
  });
});
