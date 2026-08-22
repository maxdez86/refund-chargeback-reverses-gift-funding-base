import { useState } from "react";
import { Check, CircleAlert, Plus, Trash2 } from "lucide-react";
import {
  formatPhone,
  formatShortDate,
  pluralize
} from "@/lib/admin-dashboard-format";
import {
  COMMAND_LABELS,
  RSVP_LABELS,
  STAGE_LABELS,
  TONE_CLASSES,
  guestFlags,
  sendAvailability,
  templateLabel,
  templateForSend
} from "@/lib/admin-dashboard-model";
import type { AdminInvitation } from "@/lib/admin-dashboard-types";
import {
  ADMIN_BUTTON,
  AdminModal,
  ModalActions,
  ModalNote,
  TextInput
} from "@/components/dashboard/AdminPrimitives";
import { cn } from "@/lib/utils";

const MIN_PHONE_DIGITS = 10;
const digitsOf = (value: string) => value.replace(/\D/g, "");

/** One person being typed into a guest form, with the courtesy-seat flag. */
type GuestRowDraft = { name: string; isChild: boolean };

const EMPTY_GUEST_ROW: GuestRowDraft = { name: "", isChild: false };

const trimRows = (rows: GuestRowDraft[]) =>
  rows.map((row) => ({ ...row, name: row.name.trim() })).filter((row) => row.name);

/**
 * The “Criança” flag (0–11), shared by every form that types guests in. It is the seed that
 * makes the RSVP page ask the guest for the age band — the ≤6 cortesia is the guest's answer
 * to that question, never something the panel sets.
 */
function ChildToggle({
  checked,
  onToggle,
  srLabel
}: {
  checked: boolean;
  onToggle: () => void;
  srLabel: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onToggle}
      className={cn(
        "flex min-h-11 flex-none items-center gap-2.5 self-end rounded-[9px] border px-3.5 text-[13.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink",
        checked
          ? "border-admin-line-gold bg-admin-warn-bg text-admin-gold"
          : "border-admin-line-strong bg-admin-subtle text-admin-ink-soft"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-[19px] flex-none items-center justify-center rounded-md border-[1.5px] text-white",
          checked ? "border-admin-gold bg-admin-gold" : "border-admin-line-strong bg-admin-surface"
        )}
      >
        <Check className={cn("size-3", !checked && "opacity-0")} strokeWidth={2.2} />
      </span>
      Criança
      <span className="sr-only">{srLabel}</span>
    </button>
  );
}

/* ── Novo convite ────────────────────────────────────────────────────────── */

type NewInvitationDraft = {
  invitationCode: string;
  phoneNumber: string;
  householdName: string;
  guests: GuestRowDraft[];
};

const EMPTY_DRAFT: NewInvitationDraft = {
  invitationCode: "",
  phoneNumber: "",
  householdName: "",
  guests: [EMPTY_GUEST_ROW, EMPTY_GUEST_ROW]
};

/** Which required fields of the new-invitation form are still missing. */
export function newInvitationErrors(draft: NewInvitationDraft) {
  return {
    invitationCode: !draft.invitationCode.trim(),
    phoneNumber: digitsOf(draft.phoneNumber).length < MIN_PHONE_DIGITS,
    householdName: !draft.householdName.trim(),
    guest: !(draft.guests[0]?.name ?? "").trim()
  };
}

export function NewInvitationModal({
  onCancel,
  onCreate
}: {
  onCancel: () => void;
  onCreate: (draft: {
    invitationCode: string;
    phoneNumber: string;
    householdName: string;
    guests: GuestRowDraft[];
  }) => void;
}) {
  const [draft, setDraft] = useState<NewInvitationDraft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState(false);
  const errors = newInvitationErrors(draft);
  const valid = !Object.values(errors).some(Boolean);
  const filled = trimRows(draft.guests);
  const children = filled.filter((row) => row.isChild).length;
  const showError = (bad: boolean) => touched && bad;

  const patchGuest = (index: number, changes: Partial<GuestRowDraft>) =>
    setDraft((current) => ({
      ...current,
      guests: current.guests.map((row, position) =>
        position === index ? { ...row, ...changes } : row
      )
    }));

  const submit = () => {
    if (!valid) {
      setTouched(true);
      return;
    }
    onCreate({
      invitationCode: draft.invitationCode,
      phoneNumber: draft.phoneNumber,
      householdName: draft.householdName,
      guests: filled
    });
  };

  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && onCancel()}
      alignTop
      closeButton
      widthClassName="max-w-[640px]"
      eyebrow="NOVO CONVITE"
      title="Criar convite"
      description="Um convite reúne os convidados de uma mesma casa sob um código e um telefone de WhatsApp."
      footer={
        <>
          <ModalNote tone={showError(!valid) ? "error" : "info"}>
            {showError(!valid)
              ? "Preencha código, telefone, nome do convite e o convidado principal."
              : "O convite é criado com RSVP pendente. O fluxo de WhatsApp começa depois do envio."}
          </ModalNote>
          <ModalActions>
            <button type="button" className={ADMIN_BUTTON.neutral} onClick={onCancel}>
              Cancelar
            </button>
            <button
              type="button"
              className={ADMIN_BUTTON.primary}
              aria-disabled={!valid}
              onClick={submit}
            >
              Criar convite
            </button>
          </ModalActions>
        </>
      }
    >
      <div className="mt-6 grid gap-[18px] sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
        <TextInput
          label="CÓDIGO DO CONVITE *"
          placeholder="BRX-014"
          value={draft.invitationCode}
          invalid={showError(errors.invitationCode)}
          onChange={(event) => setDraft({ ...draft, invitationCode: event.target.value })}
          hint="Usado pelo convidado para abrir o convite no site."
          className="tracking-[0.06em]"
        />
        <TextInput
          label="TELEFONE (WHATSAPP) *"
          placeholder="+55 11 91234-5678"
          inputMode="tel"
          value={draft.phoneNumber}
          invalid={showError(errors.phoneNumber)}
          onChange={(event) => setDraft({ ...draft, phoneNumber: event.target.value })}
          hint="Número único que recebe o fluxo de mensagens."
        />
      </div>

      <TextInput
        className="mt-[18px]"
        label="NOME DO CONVITE *"
        placeholder="Família Moretti"
        value={draft.householdName}
        invalid={showError(errors.householdName)}
        onChange={(event) => setDraft({ ...draft, householdName: event.target.value })}
      />

      <div className="mt-[26px] border-t border-admin-line pt-[22px]">
        <div className="flex flex-wrap items-baseline gap-3.5">
          <h3 className="font-admin-sans text-[11.5px] font-medium tracking-[0.13em] text-admin-muted">
            CONVIDADOS
          </h3>
          <p className="text-[12.5px] text-admin-fainter">
            {pluralize(filled.length, "pessoa neste convite", "pessoas neste convite")}
            {children > 0 && ` · ${pluralize(children, "criança", "crianças")}`}
          </p>
        </div>

        <div className="mt-3.5 flex flex-col gap-2.5">
          {draft.guests.map((row, index) => (
            <div key={index} className="flex flex-wrap items-end gap-3">
              <TextInput
                className="min-w-[220px] flex-1"
                label={index === 0 ? "Convidado principal *" : `Convidado ${index + 1}`}
                placeholder={
                  index === 0 ? "Nome completo de quem responde o RSVP" : "Nome completo"
                }
                value={row.name}
                invalid={index === 0 && showError(errors.guest)}
                onChange={(event) => patchGuest(index, { name: event.target.value })}
              />
              <ChildToggle
                checked={row.isChild}
                onToggle={() => patchGuest(index, { isChild: !row.isChild })}
                srLabel={index === 0 ? "convidado principal" : `convidado ${index + 1}`}
              />
              {index > 0 && (
                <button
                  type="button"
                  title="Remover convidado"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      guests: draft.guests.filter((_, position) => position !== index)
                    })
                  }
                  className="flex size-11 flex-none items-center justify-center self-end rounded-[9px] border border-admin-danger-edge bg-admin-surface text-admin-danger hover:bg-admin-err-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
                >
                  <Trash2 className="size-4" strokeWidth={1.7} aria-hidden="true" />
                  <span className="sr-only">Remover convidado {index + 1}</span>
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setDraft({ ...draft, guests: [...draft.guests, EMPTY_GUEST_ROW] })}
          className="mt-3.5 flex min-h-11 items-center gap-2.5 rounded-[9px] border border-dashed border-admin-line-strong bg-admin-surface px-3.5 text-[13.5px] font-medium text-admin-ink hover:border-admin-ink hover:bg-admin-gold-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
        >
          <Plus className="size-[15px] shrink-0 opacity-70" strokeWidth={1.7} aria-hidden="true" />
          Adicionar convidado a este convite
        </button>
      </div>
    </AdminModal>
  );
}

/* ── Excluir convite ─────────────────────────────────────────────────────── */

export function DeleteInvitationModal({
  invitation,
  onCancel,
  onConfirm
}: {
  invitation: AdminInvitation;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const count = invitation.guests.length;
  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && onCancel()}
      widthClassName="max-w-[470px]"
      title="Excluir este convite?"
      icon={
        <span
          aria-hidden="true"
          className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-admin-err-bg text-admin-err-fg"
        >
          <CircleAlert className="size-[19px]" strokeWidth={1.7} />
        </span>
      }
      description={`O convite e ${count === 1 ? "o convidado vinculado" : `os ${count} convidados vinculados`} serão removidos da lista, junto com o histórico de RSVP e do fluxo de WhatsApp.`}
      footer={
        <ModalActions>
          <button type="button" className={ADMIN_BUTTON.neutral} onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className={ADMIN_BUTTON.destructive} onClick={onConfirm}>
            Excluir convite
          </button>
        </ModalActions>
      }
    >
      <div className="mt-[18px] rounded-[11px] border border-admin-line bg-admin-surface px-4 py-3.5">
        <p className="text-[11.5px] font-medium tracking-[0.13em] text-admin-muted">
          {invitation.invitationCode}
        </p>
        <p className="mt-1.5 text-[15px] font-semibold">{invitation.householdName}</p>
        <p className="mt-1 text-[13px] text-admin-faint">
          {formatPhone(invitation.phoneNumber)} · {pluralize(count, "convidado", "convidados")}
        </p>
      </div>
      <p className="mt-4 text-[13px] leading-[1.5] text-admin-danger">
        Esta ação não pode ser desfeita.
      </p>
    </AdminModal>
  );
}

/* ── Trocar telefone ─────────────────────────────────────────────────────── */

export function PhoneModal({
  invitation,
  onCancel,
  onSave
}: {
  invitation: AdminInvitation;
  onCancel: () => void;
  onSave: (phoneNumber: string) => void;
}) {
  const [value, setValue] = useState(() => formatPhone(invitation.phoneNumber));
  const [touched, setTouched] = useState(false);
  const invalid = digitsOf(value).length < MIN_PHONE_DIGITS;

  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && onCancel()}
      widthClassName="max-w-[500px]"
      eyebrow={`CONVITE ${invitation.invitationCode}`}
      title="Trocar telefone do convite"
      description="O novo número passa a receber todo o fluxo de WhatsApp deste convite. Mensagens já enviadas continuam no histórico."
      footer={
        <ModalActions>
          <button type="button" className={ADMIN_BUTTON.neutral} onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className={ADMIN_BUTTON.primary}
            aria-disabled={invalid}
            onClick={() => (invalid ? setTouched(true) : onSave(value))}
          >
            Salvar telefone
          </button>
        </ModalActions>
      }
    >
      <div className="mt-5 rounded-[11px] border border-admin-line bg-admin-surface px-4 py-3.5">
        <p className="text-[11.5px] font-medium tracking-[0.13em] text-admin-muted">NÚMERO ATUAL</p>
        <p className="mt-1.5 text-[15.5px] tabular-nums">{formatPhone(invitation.phoneNumber)}</p>
      </div>

      <TextInput
        className="mt-[18px]"
        label="NOVO TELEFONE (WHATSAPP) *"
        placeholder="+55 11 91234-5678"
        inputMode="tel"
        value={value}
        invalid={touched && invalid}
        onChange={(event) => setValue(event.target.value)}
        hint={
          <span className={touched && invalid ? "text-admin-danger" : undefined}>
            {touched && invalid
              ? "Informe um número válido com DDI e DDD."
              : "Inclua DDI e DDD — ex.: +55 11 91234-5678."}
          </span>
        }
      />
    </AdminModal>
  );
}

/* ── Confirmar presença ──────────────────────────────────────────────────── */

export function ConfirmAllModal({
  invitation,
  onCancel,
  onSave
}: {
  invitation: AdminInvitation;
  onCancel: () => void;
  onSave: (guestIds: string[]) => void;
}) {
  const allIds = invitation.guests.map((guest) => guest.guestId);
  const [selected, setSelected] = useState<string[]>(allIds);
  const everyone = selected.length === allIds.length;

  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && onCancel()}
      widthClassName="max-w-[520px]"
      eyebrow={`CONVITE ${invitation.invitationCode}`}
      title="Confirmar presença"
      description={`Marque quem será confirmado no RSVP de ${invitation.householdName}. Nomes desmarcados continuam com o status atual.`}
      footer={
        <ModalActions>
          <button type="button" className={ADMIN_BUTTON.neutral} onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className={ADMIN_BUTTON.confirm}
            disabled={selected.length === 0}
            onClick={() => onSave(selected)}
          >
            {selected.length > 1 ? `Confirmar ${selected.length} nomes` : "Confirmar presença"}
          </button>
        </ModalActions>
      }
    >
      <div className="mt-5 flex flex-col gap-2">
        {invitation.guests.map((guest) => {
          const on = selected.includes(guest.guestId);
          return (
            <label
              key={guest.guestId}
              className={cn(
                "flex min-h-11 w-full cursor-pointer items-center gap-3.5 rounded-[11px] border px-[15px] py-3 text-left focus-within:ring-2 focus-within:ring-admin-ink",
                on ? "border-admin-ok-fg/35 bg-admin-ok-bg" : "border-admin-line bg-admin-surface"
              )}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  setSelected((current) =>
                    current.includes(guest.guestId)
                      ? current.filter((id) => id !== guest.guestId)
                      : [...current, guest.guestId]
                  )
                }
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-[21px] flex-none items-center justify-center rounded-md border-[1.5px] text-white",
                  on ? "border-admin-ok-fg bg-admin-ok-fg" : "border-admin-line-strong bg-admin-surface"
                )}
              >
                <Check className={cn("size-3.5", !on && "opacity-0")} strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium text-admin-ink">
                  {guest.guestName}
                </span>
                <span className="mt-0.5 block text-[12.5px] text-admin-faint">
                  {["Status atual · " + RSVP_LABELS[guest.rsvpStatus].label, ...guestFlags(guest)].join(
                    " · "
                  )}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setSelected(everyone ? [] : allIds)}
          className="min-h-11 rounded-lg border border-admin-line-strong bg-admin-surface px-3.5 text-[13px] font-medium text-admin-ink hover:bg-admin-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
        >
          {everyone ? "Desmarcar todos" : "Marcar todos"}
        </button>
        <p
          className={cn(
            "text-[13px]",
            selected.length === 0 ? "text-admin-danger" : "text-admin-muted"
          )}
        >
          {selected.length === 0
            ? "Nenhum nome selecionado"
            : `${selected.length} de ${allIds.length} ${allIds.length === 1 ? "convidado" : "convidados"} serão confirmados`}
        </p>
      </div>
    </AdminModal>
  );
}

/* ── Adicionar convidado ─────────────────────────────────────────────────── */

export function AddGuestsModal({
  invitation,
  onCancel,
  onSave
}: {
  invitation: AdminInvitation;
  onCancel: () => void;
  onSave: (rows: GuestRowDraft[]) => void;
}) {
  const [rows, setRows] = useState<GuestRowDraft[]>([EMPTY_GUEST_ROW]);
  const [touched, setTouched] = useState(false);
  const filled = trimRows(rows);

  const patch = (index: number, changes: Partial<GuestRowDraft>) =>
    setRows((current) =>
      current.map((row, position) => (position === index ? { ...row, ...changes } : row))
    );

  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && onCancel()}
      alignTop
      widthClassName="max-w-[560px]"
      eyebrow={`CONVITE ${invitation.invitationCode}`}
      title="Adicionar convidado"
      description={`Os nomes entram no convite de ${invitation.householdName} com RSVP pendente. Marque “Criança” para quem tem de 0 a 11 anos.`}
      footer={
        <>
          <ModalNote tone={touched && filled.length === 0 ? "error" : "info"}>
            {touched && filled.length === 0
              ? "Informe pelo menos um nome."
              : "A marcação de criança faz o RSVP pedir a faixa etária. A cortesia de até 6 anos é definida pelo próprio convidado ao confirmar."}
          </ModalNote>
          <ModalActions>
            <button type="button" className={ADMIN_BUTTON.neutral} onClick={onCancel}>
              Cancelar
            </button>
            <button
              type="button"
              className={ADMIN_BUTTON.primary}
              aria-disabled={filled.length === 0}
              onClick={() => (filled.length === 0 ? setTouched(true) : onSave(filled))}
            >
              {filled.length > 1 ? `Adicionar ${filled.length} convidados` : "Adicionar convidado"}
            </button>
          </ModalActions>
        </>
      }
    >
      <div className="mt-5 flex flex-col gap-2.5">
        {rows.map((row, index) => (
          <div
            key={index}
            className="flex flex-wrap items-end gap-3 rounded-xl border border-admin-line bg-admin-surface px-[15px] py-3.5"
          >
            <TextInput
              className="min-w-[200px] flex-1"
              label="NOME COMPLETO *"
              placeholder="Nome do convidado"
              value={row.name}
              invalid={touched && filled.length === 0}
              onChange={(event) => patch(index, { name: event.target.value })}
            />
            <ChildToggle
              checked={row.isChild}
              onToggle={() => patch(index, { isChild: !row.isChild })}
              srLabel={`linha ${index + 1}`}
            />
            {rows.length > 1 && (
              <button
                type="button"
                title="Remover linha"
                onClick={() => setRows((current) => current.filter((_, position) => position !== index))}
                className="flex size-11 flex-none items-center justify-center rounded-[9px] border border-admin-danger-edge bg-admin-surface text-admin-danger hover:bg-admin-err-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
              >
                <Trash2 className="size-4" strokeWidth={1.7} aria-hidden="true" />
                <span className="sr-only">Remover linha {index + 1}</span>
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setRows((current) => [...current, EMPTY_GUEST_ROW])}
        className="mt-3.5 flex min-h-11 items-center gap-2.5 rounded-[9px] border border-dashed border-admin-line-strong bg-admin-surface px-3.5 text-[13.5px] font-medium text-admin-ink hover:border-admin-ink hover:bg-admin-gold-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
      >
        <Plus className="size-[15px] shrink-0 opacity-70" strokeWidth={1.7} aria-hidden="true" />
        Adicionar outro nome
      </button>
    </AdminModal>
  );
}

/* ── Enviar WhatsApp ─────────────────────────────────────────────────────── */

export function SendWhatsappModal({
  invitation,
  onCancel,
  onSend
}: {
  invitation: AdminInvitation;
  onCancel: () => void;
  onSend: (mode: "first" | "resend") => void;
}) {
  const availability = sendAvailability(invitation);
  const [mode, setMode] = useState<"first" | "resend">(
    availability.sentCount ? "resend" : "first"
  );
  const anyAllowed = availability.firstAllowed || availability.resendAllowed;
  const allowed =
    (mode === "first" && availability.firstAllowed) ||
    (mode === "resend" && availability.resendAllowed);

  const options = [
    {
      key: "first" as const,
      title: "Primeiro envio de confirmação",
      tag: availability.sentCount ? "JÁ ENVIADO" : "RECOMENDADO",
      tagTone: availability.sentCount ? ("mute" as const) : ("ok" as const),
      description:
        "Abre o fluxo com o convite e o pedido de RSVP. Disponível apenas para convites que ainda não receberam mensagem.",
      template: templateForSend(invitation, "first"),
      disabled: availability.sentCount > 0
    },
    {
      key: "resend" as const,
      title: "Reenvio",
      tag: availability.failed ? "RETENTATIVA" : availability.undecided ? "PERMITIDO" : "BLOQUEADO",
      tagTone: availability.failed
        ? ("err" as const)
        : availability.undecided
          ? ("ok" as const)
          : ("mute" as const),
      description:
        availability.sentCount === 0
          ? "Só depois do primeiro envio de confirmação."
          : availability.failed
            ? "A última tentativa falhou. Corrija o telefone ou os dados do convite e repita o envio — conta como nova tentativa."
            : availability.undecided
              ? "O convidado respondeu como indeciso e o fluxo segue aberto. Envia novamente o pedido de confirmação."
              : "O backend só aceita reenvio quando o convidado está indeciso ou quando houve falha no envio. Este convite não está em nenhuma das duas situações.",
      template: templateForSend(invitation, "resend"),
      disabled: !availability.resendAllowed
    }
  ];

  return (
    <AdminModal
      open
      onOpenChange={(next) => !next && onCancel()}
      alignTop
      widthClassName="max-w-[600px]"
      eyebrow={`CONVITE ${invitation.invitationCode}`}
      title="Enviar WhatsApp"
      description={`Para ${invitation.householdName} · ${formatPhone(invitation.phoneNumber)}`}
      footer={
        <>
          <ModalNote tone={anyAllowed ? "info" : "error"}>
            {!anyAllowed
              ? "Nenhum envio disponível: o fluxo deste convite já foi iniciado e não está indeciso nem com falha."
              : mode === "first"
                ? "A mensagem entra na fila e o fluxo passa a acompanhar a resposta."
                : "O reenvio mantém o histórico anterior e soma uma tentativa."}
          </ModalNote>
          <ModalActions>
            <button type="button" className={ADMIN_BUTTON.neutral} onClick={onCancel}>
              Cancelar
            </button>
            <button
              type="button"
              className={ADMIN_BUTTON.primary}
              disabled={!allowed}
              onClick={() => onSend(mode)}
            >
              {mode === "first" ? "Enviar confirmação" : "Reenviar mensagem"}
            </button>
          </ModalActions>
        </>
      }
    >
      <div
        role="radiogroup"
        aria-label="Tipo de envio"
        className="mt-5 flex flex-col gap-2.5"
      >
        {options.map((option) => {
          const on = mode === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={option.disabled}
              onClick={() => setMode(option.key)}
              className={cn(
                "flex w-full items-start gap-3.5 rounded-xl border px-4 py-[15px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink",
                on ? "border-admin-gold/40 bg-admin-gold-tint" : "border-admin-line bg-admin-surface",
                option.disabled && "cursor-not-allowed opacity-50"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-[19px] flex-none items-center justify-center rounded-full border-[1.5px] bg-admin-surface",
                  on ? "border-admin-gold" : "border-admin-line-strong"
                )}
              >
                <span className={cn("size-[9px] rounded-full", on && "bg-admin-gold")} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[15px] font-semibold text-admin-ink">{option.title}</span>
                  <span
                    className={`rounded-md px-2 py-[3px] text-[11px] font-semibold tracking-[0.06em] ${TONE_CLASSES[option.tagTone]}`}
                  >
                    {option.tag}
                  </span>
                </span>
                <span className="mt-1.5 block text-[13.5px] leading-[1.5] text-admin-ink-soft">
                  {option.description}
                </span>
                <span className="admin-mono mt-1.5 block break-all text-[12.5px] text-admin-faint">
                  {option.template}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 border-t border-admin-line pt-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="font-admin-sans text-[11.5px] font-medium tracking-[0.13em] text-admin-muted">
            HISTÓRICO DE ENVIOS
          </h3>
          <p className="text-[12.5px] text-admin-fainter">
            {availability.sentCount
              ? pluralize(availability.sentCount, "mensagem registrada", "mensagens registradas")
              : "sem envios"}
          </p>
        </div>

        {availability.sentCount === 0 ? (
          <p className="mt-3 rounded-[11px] border border-dashed border-admin-line-strong p-4 text-[13.5px] leading-[1.5] text-admin-muted">
            Nenhuma mensagem enviada ainda. Este será o primeiro contato deste convite.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {invitation.commands.map((command) => {
              const status = COMMAND_LABELS[command.status];
              const meta = [formatShortDate(command.createdAt), `etapa ${STAGE_LABELS[command.stage]}`];
              if (command.retryCount) {
                meta.push(pluralize(command.retryCount, "tentativa", "tentativas"));
              }
              return (
                <li
                  key={command.commandId}
                  className="flex flex-wrap items-center gap-3.5 rounded-[11px] border border-admin-line bg-admin-surface px-3.5 py-3"
                >
                  <div className="min-w-[190px] flex-1">
                    <p className="text-[13.5px] font-medium text-admin-ink">
                      {templateLabel(command.templateId)}
                    </p>
                    <p className="mt-1 text-[12.5px] text-admin-faint">{meta.join(" · ")}</p>
                  </div>
                  <span
                    className={`flex-none rounded-md px-2.5 py-[5px] text-xs font-semibold ${TONE_CLASSES[status.tone]}`}
                  >
                    {status.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AdminModal>
  );
}
