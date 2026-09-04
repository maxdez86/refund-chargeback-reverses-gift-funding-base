import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmAllModal } from "@/components/dashboard/modals/InvitationModals";
import { GuestActionModal } from "@/components/dashboard/modals/GuestActionModal";
import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import { toGuestRows } from "@/lib/admin-dashboard-model";

const invitation = () =>
  createFixtureDashboardSnapshot().invitations.find((item) => item.guests.length > 1)!;

const guestRow = () => toGuestRows([invitation()])[0]!;

const renderGuestAction = (
  props: Partial<React.ComponentProps<typeof GuestActionModal>> = {}
) => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <GuestActionModal
      guest={guestRow()}
      kind="attending"
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    />
  );
  return { onCancel, onConfirm };
};

const renderConfirmAll = (
  props: Partial<React.ComponentProps<typeof ConfirmAllModal>> = {}
) => {
  const onCancel = vi.fn();
  const onSave = vi.fn();
  render(
    <ConfirmAllModal invitation={invitation()} onCancel={onCancel} onSave={onSave} {...props} />
  );
  return { onCancel, onSave };
};

describe("GuestActionModal", () => {
  it("confirms the action while idle", () => {
    const { onConfirm } = renderGuestAction();

    fireEvent.click(screen.getByRole("button", { name: "Marcar como confirmado" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks both buttons and shows progress while the write is in flight", () => {
    const { onCancel, onConfirm } = renderGuestAction({ submitting: true });

    const confirm = screen.getByRole("button", { name: "Salvando…" });
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(cancel).toBeDisabled();

    fireEvent.click(confirm);
    fireEvent.click(cancel);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cannot be dismissed with Escape while submitting, and can be once it settles", () => {
    const { onCancel } = renderGuestAction({ submitting: true });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders the failure in place so the operator can retry on the same guest", () => {
    renderGuestAction({ error: "Este convidado não está mais disponível." });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Este convidado não está mais disponível."
    );
    // The modal stays usable: the confirm button is live again.
    expect(screen.getByRole("button", { name: "Marcar como confirmado" })).toBeEnabled();
  });

  it("keeps the criança copy honest about who owns the age band", () => {
    renderGuestAction({ kind: "child" });

    expect(
      screen.getByText(/A cortesia de até 6 anos continua sendo definida pelo convidado/)
    ).toBeInTheDocument();
  });
});

describe("ConfirmAllModal", () => {
  it("saves the current selection", () => {
    const { onSave } = renderConfirmAll();
    const target = invitation();

    fireEvent.click(screen.getByRole("button", { name: `Confirmar ${target.guests.length} nomes` }));

    expect(onSave).toHaveBeenCalledWith(target.guests.map((guest) => guest.guestId));
  });

  it("still promises that unselected names keep their current status", () => {
    renderConfirmAll();

    expect(screen.getByText(/Nomes desmarcados continuam com o status atual/)).toBeInTheDocument();
  });

  it("blocks the dialog while confirming", () => {
    const { onCancel, onSave } = renderConfirmAll({ submitting: true });

    const confirm = screen.getByRole("button", { name: "Confirmando…" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(confirm);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("renders a failure without closing", () => {
    renderConfirmAll({ error: "Os dados do convite mudaram." });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Os dados do convite mudaram.")).toBeInTheDocument();
  });
});
