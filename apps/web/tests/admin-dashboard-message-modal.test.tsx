import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DeleteMessageModal, truncateMessage } from "@/components/dashboard/modals/MessageModals";
import type { AdminGuestMessage } from "@/lib/admin-dashboard-types";

const message: AdminGuestMessage = {
  messageId: "b2f91fa5-41dc-4444-b466-9ca5f974cabc",
  authorName: "Amanda Moura",
  createdAt: "2026-08-02T09:12:07Z",
  message: "Que alegria imensa poder celebrar esse dia com vocês."
};

const renderModal = (props: Partial<React.ComponentProps<typeof DeleteMessageModal>> = {}) => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <DeleteMessageModal
      message={message}
      submitting={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    />
  );
  return { onCancel, onConfirm };
};

describe("truncateMessage", () => {
  it("returns a short recado untouched and trims surrounding space", () => {
    expect(truncateMessage("  Curto e direto.  ")).toBe("Curto e direto.");
  });

  it("cuts a long recado at the limit and marks the cut", () => {
    const truncated = truncateMessage("a".repeat(200), 10);
    expect(truncated).toBe(`${"a".repeat(10)}…`);
  });

  it("does not leave a dangling space before the ellipsis", () => {
    expect(truncateMessage("palavra  seguinte", 8)).toBe("palavra…");
  });
});

describe("DeleteMessageModal", () => {
  it("shows who wrote the recado, when, and what it says", () => {
    renderModal();
    expect(screen.getByRole("heading", { name: "Excluir este recado?" })).toBeInTheDocument();
    expect(screen.getByText("Amanda Moura")).toBeInTheDocument();
    expect(screen.getByText(/Que alegria imensa/)).toBeInTheDocument();
    expect(screen.getByText("Esta ação não pode ser desfeita.")).toBeInTheDocument();
  });

  it("truncates an overlong recado in the preview card", () => {
    renderModal({ message: { ...message, message: "Parabéns! ".repeat(40) } });
    expect(screen.getByText(/…$/)).toBeInTheDocument();
  });

  it("wires the two footer actions", () => {
    const { onCancel, onConfirm } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Excluir recado" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("locks both actions while the delete is in flight", () => {
    renderModal({ submitting: true });
    const confirm = screen.getByRole("button", { name: "Excluindo…" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Excluir recado" })).not.toBeInTheDocument();
  });

  it("announces a failure without closing", () => {
    renderModal({ error: "Este recado não existe mais." });
    expect(screen.getByRole("alert")).toHaveTextContent("Este recado não existe mais.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
