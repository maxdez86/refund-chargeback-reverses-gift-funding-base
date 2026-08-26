import type { MouseEvent } from "react";
import { ChevronRight, CircleAlert, Flag, MessageCircle } from "lucide-react";
import { musicSuggestionFromNote } from "@brimax/contracts";
import {
  formatDateTimeOfDay,
  formatLongDate,
  formatPhone,
  formatShortDate,
  initials,
  pluralize
} from "@/lib/admin-dashboard-format";
import {
  COMMAND_LABELS,
  FLOW_LABELS,
  PHONE_SOURCE_LABELS,
  RSVP_LABELS,
  STAGE_LABELS,
  TONE_CLASSES,
  TONE_FG_CLASSES,
  attentionMessage,
  templateLabel
} from "@/lib/admin-dashboard-model";
import type {
  AdminInvitation,
  AdminWhatsappThreadLoadState
} from "@/lib/admin-dashboard-types";
import {
  ADMIN_BUTTON,
  BackLink,
  Field,
  Panel,
  PanelHeading,
  StatusPill
} from "@/components/dashboard/AdminPrimitives";

export function InviteDetailScreen({
  invitation,
  backHref,
  onBack,
  onOpenGuest,
  onAskDelete,
  onAskSend,
  onChangePhone,
  onConfirmAll,
  onAddGuests,
  loadState,
  onRetryLoad
}: {
  invitation: AdminInvitation;
  backHref: string;
  onBack: (event: MouseEvent) => void;
  onOpenGuest: (guestId: string) => void;
  onAskDelete: () => void;
  onAskSend: () => void;
  onChangePhone: () => void;
  onConfirmAll: () => void;
  onAddGuests: () => void;
  loadState?: AdminWhatsappThreadLoadState;
  onRetryLoad?: () => void;
}) {
  const rsvp = RSVP_LABELS[invitation.rsvp.status];
  const flow = FLOW_LABELS[invitation.whatsappFlowStatus];
  const alert = attentionMessage(invitation);
  const submitter = invitation.rsvp.submittedBy
    ? (invitation.guests.find((guest) => guest.guestId === invitation.rsvp.submittedBy) ??
      invitation.guests[0])
    : null;
  // Only `attendance_confirmed_whatsapp` records an answer taken on WhatsApp itself;
  // every other answered state came back through the website RSVP form.
  const answerChannel = invitation.rsvp.submittedBy
    ? invitation.whatsappFlowStatus === "attendance_confirmed_whatsapp"
      ? "WhatsApp"
      : "Site do casamento"
    : "Aguardando resposta";

  return (
    <div>
      <BackLink href={backHref} onClick={onBack}>
        <ChevronRight className="size-4 shrink-0 rotate-180" strokeWidth={1.7} aria-hidden="true" />
        VOLTAR PARA CONVITES
      </BackLink>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="admin-mono rounded-md border border-admin-line-gold bg-admin-gold-pale px-2.5 py-1 text-[12.5px] tracking-[0.1em] text-admin-gold">
              {invitation.invitationCode}
            </span>
            <span className="text-[13px] text-admin-faint">
              Convite · {pluralize(invitation.guests.length, "convidado", "convidados")}
            </span>
          </div>
          <h1 id="conteudo-titulo" className="mt-3.5 text-[clamp(2rem,4.5vw,2.875rem)] leading-[1.05]">
            {invitation.householdName}
          </h1>
          <div className="mt-3.5 flex flex-wrap items-center gap-3">
            <StatusPill tone={rsvp.tone} withDot className="text-[13px]">
              RSVP · {rsvp.label}
            </StatusPill>
            <span
              className={`inline-flex items-center gap-[7px] rounded-full px-3 py-[5px] text-[13px] font-medium ${TONE_CLASSES[flow.tone]}`}
            >
              <MessageCircle className="size-3.5 shrink-0" strokeWidth={1.7} aria-hidden="true" />
              {flow.label}
            </span>
            <span className="text-[13px] text-admin-faint">
              Fluxo atualizado em {formatLongDate(invitation.whatsappFlowUpdatedAt)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2.5">
          <button type="button" className={ADMIN_BUTTON.danger} onClick={onAskDelete}>
            Excluir convite
          </button>
          <button type="button" className={ADMIN_BUTTON.primary} onClick={onAskSend}>
            Enviar WhatsApp
          </button>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_430px] flex-col gap-6">
          <Panel className="px-7 py-[26px]">
            <PanelHeading
              aside={submitter ? `Respondido por ${submitter.guestName}` : "Ninguém respondeu ainda"}
            >
              Convidados deste convite
            </PanelHeading>
            <ul className="mt-5 flex flex-col gap-2.5">
              {invitation.guests.map((guest, index) => {
                const status = RSVP_LABELS[guest.rsvpStatus];
                return (
                  <li key={guest.guestId}>
                    <button
                      type="button"
                      onClick={() => onOpenGuest(guest.guestId)}
                      aria-label={`Abrir ${guest.guestName}. Situação: ${status.label}.`}
                      className="flex w-full items-center gap-3.5 rounded-[11px] border border-admin-line-soft bg-admin-subtle px-4 py-3.5 text-left hover:bg-admin-inset-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-admin-mute-bg text-[11.5px] font-semibold text-admin-ink-soft"
                      >
                        {initials(guest.guestName)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2.5">
                          <span className="text-[14.5px] font-medium">{guest.guestName}</span>
                          {index === 0 && (
                            <span className="rounded-full bg-admin-role-bg px-2 py-0.5 text-[11px] font-medium tracking-[0.04em] text-admin-role-fg">
                              PRINCIPAL
                            </span>
                          )}
                          {guest.isChildSixOrYounger === true && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-gold-tint px-2 py-0.5 text-[11px] font-medium tracking-[0.04em] text-admin-gold">
                              <Flag className="size-[11px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
                              CORTESIA
                            </span>
                          )}
                        </span>
                        <span className="admin-mono mt-1 block text-[11.5px] text-admin-fainter">
                          {guest.guestId}
                        </span>
                      </span>
                      <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      <ChevronRight
                        className="size-4 shrink-0 opacity-30"
                        strokeWidth={1.7}
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel className="px-7 py-[26px]">
            <h2 className="text-[25px]">Resposta ao convite (RSVP)</h2>
            <div className="mt-[22px] grid gap-[18px] sm:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
              {[
                { label: "CONFIRMADOS", value: invitation.rsvp.attending, className: "text-admin-ok-fg" },
                { label: "PAGANTES", value: invitation.rsvp.paid, className: "text-admin-ink" },
                {
                  label: "CORTESIAS (≤6 ANOS)",
                  value: invitation.rsvp.childrenSixOrYounger,
                  className: "text-admin-gold"
                },
                { label: "NO CONVITE", value: invitation.guests.length, className: "text-admin-ink" }
              ].map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-[11px] border border-admin-line-soft bg-admin-subtle px-[18px] py-4"
                >
                  <div className="text-[11px] font-medium tracking-[0.12em] text-admin-faint">
                    {metric.label}
                  </div>
                  <div className={`mt-2 font-admin-serif text-[28px] leading-none ${metric.className}`}>
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>
            <dl className="mt-[22px] grid gap-5 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] sm:gap-x-8">
              <Field label="CANAL DA RESPOSTA" value={answerChannel} />
              <Field label="ATUALIZADO EM" value={formatLongDate(invitation.rsvp.updatedAt)} />
              <Field
                className="sm:col-span-full"
                label="MÚSICA SUGERIDA"
                value={musicSuggestionFromNote(invitation.rsvp.note) ?? "—"}
              />
            </dl>
          </Panel>

          <Panel className="px-7 py-[26px]">
            <PanelHeading aside={`Envios recentes · Etapa ${STAGE_LABELS[invitation.whatsappFlowStage]}`}>
              Fluxo de WhatsApp
            </PanelHeading>
            {loadState?.status === "loading" && !loadState.hasLoaded ? (
              <p role="status" aria-label="Carregando fluxo do WhatsApp" className="mt-5 text-sm text-admin-faint">
                Carregando fluxo do WhatsApp…
              </p>
            ) : loadState?.status === "error" && !loadState.hasLoaded ? (
              <div
                role="alert"
                aria-label="Erro ao carregar fluxo do WhatsApp"
                className="mt-5 flex flex-col items-start gap-3 text-sm text-admin-danger"
              >
                <p>Não foi possível carregar o fluxo do WhatsApp.</p>
                {onRetryLoad && (
                  <button
                    type="button"
                    onClick={onRetryLoad}
                    className="min-h-11 rounded-lg border border-admin-line-strong bg-admin-surface px-4 text-sm font-medium text-admin-ink hover:bg-admin-inset-hover"
                  >
                    Tentar novamente
                  </button>
                )}
              </div>
            ) : invitation.commands.length === 0 ? (
              <p className="mt-5 rounded-[11px] border border-dashed border-admin-line-strong px-4 py-5 text-[13.5px] leading-[1.5] text-admin-muted">
                Nenhuma mensagem enviada ainda. Este convite ainda não entrou no fluxo.
              </p>
            ) : (
              <ol className="mt-6 flex flex-col gap-0.5">
                {invitation.commands.map((command) => {
                  const status = COMMAND_LABELS[command.status];
                  const details = [`Etapa ${STAGE_LABELS[command.stage]}`];
                  if (command.retryCount) {
                    details.push(pluralize(command.retryCount, "tentativa", "tentativas"));
                  }
                  if (command.reconciliationStatus !== "none") {
                    details.push(
                      `reconciliação ${command.reconciliationStatus === "required" ? "necessária" : "resolvida"}`
                    );
                  }
                  return (
                    <li
                      key={command.commandId}
                      className="grid grid-cols-[92px_24px_1fr] items-start gap-3.5 sm:grid-cols-[108px_24px_1fr]"
                    >
                      <span className="pt-[3px] text-[12.5px] tabular-nums text-admin-faint">
                        {formatShortDate(command.createdAt)} · {formatDateTimeOfDay(command.createdAt)}
                      </span>
                      <span className="flex h-full flex-col items-center gap-1" aria-hidden="true">
                        <span
                          className={`mt-1.5 size-[9px] rounded-full bg-current ${TONE_FG_CLASSES[status.tone]}`}
                        />
                        <span className="w-px flex-1 bg-admin-line-strong" />
                      </span>
                      <span className="block pb-[22px]">
                        <span className="flex flex-wrap items-center gap-2.5">
                          <span className="text-[14.5px] font-medium">
                            {templateLabel(command.templateId)}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-[3px] text-[11.5px] font-medium tracking-[0.03em] ${TONE_CLASSES[status.tone]}`}
                          >
                            {status.label}
                          </span>
                        </span>
                        <span className="admin-mono mt-1.5 block break-all text-[11.5px] text-admin-gold">
                          {command.templateId}
                        </span>
                        <span className="mt-1 block text-[13.5px] leading-[1.5] text-admin-ink-soft">
                          {details.join(" · ")}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-6">
          <Panel className="px-[26px] py-6">
            <h2 className="text-[22px]">Telefone do convite</h2>
            <p className="mt-4 text-[19px] tabular-nums">{formatPhone(invitation.phoneNumber)}</p>
            <dl className="mt-4 flex flex-col gap-3.5">
              <Field label="ORIGEM" value={PHONE_SOURCE_LABELS[invitation.phoneNumberSource]} />
              <Field label="ATUALIZADO EM" value={formatLongDate(invitation.phoneNumberUpdatedAt)} />
            </dl>
          </Panel>

          <Panel className="px-[26px] py-6">
            <h2 className="text-[22px]">Estado do fluxo</h2>
            <dl className="mt-4 flex flex-col gap-3.5">
              <Field label="STATUS" value={flow.label} />
              {invitation.whatsappFailureReason && (
                <Field label="MOTIVO DA FALHA" value={invitation.whatsappFailureReason} />
              )}
              <Field label="CONCLUÍDO EM" value={formatLongDate(invitation.whatsappFlowCompletedAt)} />
              <Field label="FALLBACK ENVIADO" value={formatLongDate(invitation.whatsappFallbackSentAt)} />
              <Field
                label="ÚLTIMO ENVIO"
                value={
                  <span className="break-words text-[12.5px]">
                    {invitation.whatsappConversation?.lastOutboundMessagePreview ??
                      invitation.whatsappConversation?.lastOutboundMessageTemplateId ??
                      "—"}
                  </span>
                }
              />
              <Field
                label="ÚLTIMA RESPOSTA"
                value={
                  <span className="break-words text-[12.5px]">
                    {invitation.whatsappConversation?.lastInboundMessagePreview ??
                      (invitation.whatsappConversation?.lastInboundMessageButtonAction === "decline"
                        ? "Não vai"
                        : invitation.whatsappConversation?.lastInboundMessageButtonAction === "confirm_all" ||
                            invitation.whatsappConversation?.lastInboundMessageButtonAction === "attend_all"
                          ? "Confirmou presença"
                          : invitation.whatsappConversation?.lastInboundMessageButtonAction === "undecided"
                            ? "Ainda não decidiu"
                            : invitation.whatsappConversation?.lastInboundMessageButtonId
                              ? `Resposta por botão: ${invitation.whatsappConversation.lastInboundMessageButtonId}`
                              : undefined) ??
                      invitation.whatsappConversation?.lastInboundMessageTemplateId ??
                      "—"}
                  </span>
                }
              />
            </dl>
          </Panel>

          {alert && (
            <section className="rounded-[14px] border border-admin-danger-edge bg-admin-danger-soft px-6 py-[22px]">
              <div className="flex items-center gap-2.5 text-admin-danger">
                <CircleAlert className="size-[17px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
                <h2 className="text-[21px]">Requer atenção</h2>
              </div>
              <p className="mt-3 text-sm leading-[1.55] text-admin-danger-ink">{alert}</p>
            </section>
          )}

          <Panel className="px-[26px] py-6">
            <h2 className="text-[22px]">Ações</h2>
            <div className="mt-4 flex flex-col gap-2">
              {[
                { label: "Trocar telefone do convite", onClick: onChangePhone },
                { label: "Confirmar todos no convite", onClick: onConfirmAll },
                { label: "Adicionar convidado ao convite", onClick: onAddGuests }
              ].map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[10px] border border-admin-line bg-admin-subtle px-3.5 py-3 text-left text-sm text-admin-ink hover:bg-admin-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ink"
                >
                  {action.label}
                  <ChevronRight className="size-4 shrink-0 opacity-30" strokeWidth={1.7} aria-hidden="true" />
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
