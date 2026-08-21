import {
  RsvpSubmissionRequestSchema,
  RsvpSubmissionResponseSchema,
  type GuestProfile,
  type RsvpSubmissionRequest
} from "@brimax/contracts";
import type { WhatsappFlowStatus } from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { getEnv } from "../lib/env";
import { deriveOverallRsvpStatus, deriveRsvpCounts } from "../services/dynamodb/mappers";
import { WeddingRepository, type RsvpOperationIdentity } from "../services/dynamodb/repositories/wedding-repository";
import { EmailService } from "../services/email/client";
import { WhatsappTemplateRepository } from "../services/whatsapp/template-repository";
import { enqueueWhatsappRsvp } from "../services/sqs/whatsapp-rsvp-publisher";
import { validateWhatsappTemplateVariables } from "./whatsapp-template-variables";
import {
  selectWhatsappDeclinedFollowupTemplate,
  selectWebsiteAttendanceFollowupTemplate
} from "./whatsapp-rsvp-template-selection";
import { createRsvpOperationIdentity } from "./rsvp-idempotency";
import { isTerminalFlowStatus } from "./whatsapp-flow-state";
import { isConditionalTransactionCancellation } from "../services/dynamodb/transaction-errors";
import {
  escapeHtml,
  renderDetailLine,
  renderEmailDocument
} from "../services/email/html";

type RsvpSubmitResult = {
  response: ReturnType<typeof RsvpSubmissionResponseSchema.parse>;
  notificationSent: boolean;
};

const MUSIC_NOTE_PREFIX = "Música sugerida: ";

export class RsvpService {
  constructor(
    private readonly repository = new WeddingRepository(),
    private readonly emailService = new EmailService(),
    private readonly templates = new WhatsappTemplateRepository(),
    private readonly publish = enqueueWhatsappRsvp
  ) {}

  async submit(request: unknown, idempotencyKey?: string): Promise<RsvpSubmitResult> {
    const parsed = RsvpSubmissionRequestSchema.parse(request);
    const invitation = await this.repository.getInvitationByCode(parsed.invitationCode);

    if (!invitation) {
      throw new AppError("Invitation not found.", 404);
    }

    const counts = deriveRsvpCounts(parsed);
    if (parsed.attendingGuestCount !== counts.attendingGuestCount) {
      throw new AppError("Attending guest count does not match guest responses.", 409);
    }

    const invitationGuestIds = new Set(invitation.guests.map((guest) => guest.guestId));
    if (
      parsed.guestResponses.length !== invitation.guests.length ||
      parsed.guestResponses.some((response) => !invitationGuestIds.has(response.guestId))
    ) {
      throw new AppError("RSVP payload does not match the invitation guests.", 409);
    }

    const status: GuestProfile["rsvpStatus"] = deriveOverallRsvpStatus(parsed);
    const operation = createRsvpOperationIdentity(parsed, idempotencyKey);
    const existing = await this.repository.getRsvpResponse(parsed.invitationCode);
    if (existing && this.isReplayOrConflict(existing, operation)) {
      if (existing.websitePayloadDigest !== operation.websitePayloadDigest) {
        throw new AppError("The provided idempotency key was already used with a different RSVP payload.", 409, "IDEMPOTENCY_CONFLICT");
      }
      return {
        response: this.responseFromStored(existing),
        notificationSent: false
      };
    }

    const updatedAt = new Date().toISOString();
    const rsvpExpectation = {
      expectedWebsiteOperationId: existing?.websiteOperationId,
      expectedLegacyRsvp: Boolean(existing && !existing.websiteOperationId)
    };
    let command;
    try {
      command = await this.reserveWebsiteFollowupIfEligible(
        invitation,
        parsed,
        status,
        operation,
        updatedAt,
        rsvpExpectation
      );
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 409) throw error;
      console.info(JSON.stringify({
        metric: "RSVP_WHATSAPP_FOLLOWUP_SKIPPED",
        invitationCode: parsed.invitationCode,
        outcome: "preparation_failed",
        category: error instanceof AppError && error.statusCode === 422
          ? "invalid_invitation_state"
          : "template_or_storage_unavailable"
      }));
      command = undefined;
    }
    if (!command) {
      await this.writeRsvpOnlyWithRetry(parsed, status, operation, updatedAt, rsvpExpectation);
    } else {
      await this.publishWebsiteCommand(command.commandId, parsed.invitationCode);
    }
    let notificationSent = false;

    try {
      await this.emailService.sendEmail({
        to: getEnv().rsvpNotificationTo,
        subject: `Nova confirmacao de presenca: ${invitation.householdName}`,
        text: buildRsvpNotificationText(invitation, parsed, status, updatedAt, counts),
        html: buildRsvpNotificationHtml(invitation, parsed, status, updatedAt, counts)
      });
      notificationSent = true;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "RSVP_EMAIL_FAILED",
          invitationCode: parsed.invitationCode,
          message: error instanceof Error ? error.message : "Unknown RSVP email error"
        })
      );
    }

    return {
      response: RsvpSubmissionResponseSchema.parse({
        ok: true,
        invitationCode: parsed.invitationCode,
        status,
        updatedAt
      }),
      notificationSent
    };
  }

  private async writeRsvpOnlyWithRetry(
    request: RsvpSubmissionRequest,
    status: GuestProfile["rsvpStatus"],
    operation: RsvpOperationIdentity,
    updatedAt: string,
    expectation: { expectedWebsiteOperationId?: string; expectedLegacyRsvp?: boolean }
  ) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.repository.writeRsvpOnly({ request, status, operation, updatedAt, ...expectation });
        return;
      } catch (error) {
        if ((error as { name?: string }).name !== "ConditionalCheckFailedException" || attempt === 1) throw error;
        const current = await this.repository.getRsvpResponse(request.invitationCode);
        if (current && this.isReplayOrConflict(current, operation)) {
          if (current.websitePayloadDigest !== operation.websitePayloadDigest) {
            throw new AppError("The provided idempotency key was already used with a different RSVP payload.", 409, "IDEMPOTENCY_CONFLICT");
          }
          return;
        }
        expectation.expectedWebsiteOperationId = current?.websiteOperationId;
        expectation.expectedLegacyRsvp = Boolean(current && !current.websiteOperationId);
      }
    }
  }

  private isReplayOrConflict(
    existing: { websiteOperationId?: string; websitePayloadDigest?: string; websiteIdempotencyKeyDigest?: string },
    operation: RsvpOperationIdentity
  ) {
    if (operation.websiteIdempotencyKeyDigest) {
      return existing.websiteIdempotencyKeyDigest === operation.websiteIdempotencyKeyDigest;
    }
    return existing.websiteOperationId === operation.websiteOperationId ||
      existing.websitePayloadDigest === operation.websitePayloadDigest;
  }

  private responseFromStored(existing: { invitationCode: string; status: "pending" | "attending" | "declined"; updatedAt: string }) {
    return RsvpSubmissionResponseSchema.parse({
      ok: true,
      invitationCode: existing.invitationCode,
      status: existing.status,
      updatedAt: existing.updatedAt
    });
  }

  private async reserveWebsiteFollowupIfEligible(
    initialInvitation: Awaited<ReturnType<WeddingRepository["getInvitationByCode"]>>,
    request: RsvpSubmissionRequest,
    status: GuestProfile["rsvpStatus"],
    operation: RsvpOperationIdentity,
    updatedAt: string,
    rsvpExpectation: { expectedWebsiteOperationId?: string; expectedLegacyRsvp?: boolean }
  ) {
    let invitation = initialInvitation;
    const openStatuses: WhatsappFlowStatus[] = ["send_queued", "sending", "message_sent", "response_received"];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!invitation || !invitation.phoneNumber) return null;
      const currentStatus = invitation.whatsappFlowStatus;
      if (!currentStatus || isTerminalFlowStatus(currentStatus) || !openStatuses.includes(currentStatus)) return null;

      const templateId = request.attendingGuestCount > 0
        ? selectWebsiteAttendanceFollowupTemplate(invitation)
        : selectWhatsappDeclinedFollowupTemplate(invitation);
      const definition = await this.templates.getActive(templateId);
      if (!definition) {
        console.info(JSON.stringify({
          metric: "RSVP_WHATSAPP_FOLLOWUP_SKIPPED",
          invitationCode: request.invitationCode,
          outcome: "template_unavailable"
        }));
        return null;
      }
      validateWhatsappTemplateVariables(invitation, definition);

      const commandId = `website-${operation.websiteOperationId}`;
      try {
        await this.repository.reserveWebsiteRsvp({
          request,
          status,
          operation,
          updatedAt,
          ...rsvpExpectation,
          expectedStatus: currentStatus,
          command: {
            commandId,
            invitationCode: request.invitationCode,
            templateId,
            templateVersion: definition.version,
            stage: "followup",
            status: "queued",
            effect: "complete_on_send",
            expectedFlowStatus: "website_followup_pending",
            createdAt: updatedAt
            }
          });
        console.info(JSON.stringify({
          metric: "WHATSAPP_RSVP_RACE",
          invitationCode: request.invitationCode,
          winner: "website",
          outcome: "website_followup_reserved"
        }));
        return { commandId };
      } catch (error) {
        if (!isConditionalTransactionCancellation(error) && (error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
        invitation = await this.repository.getInvitationByCode(request.invitationCode);
        const currentRsvp = await this.repository.getRsvpResponse(request.invitationCode);
        if (currentRsvp && currentRsvp.websiteIdempotencyKeyDigest === operation.websiteIdempotencyKeyDigest &&
            currentRsvp.websitePayloadDigest !== operation.websitePayloadDigest) {
          throw new AppError("The provided idempotency key was already used with a different RSVP payload.", 409, "IDEMPOTENCY_CONFLICT");
        }
        rsvpExpectation.expectedWebsiteOperationId = currentRsvp?.websiteOperationId;
        rsvpExpectation.expectedLegacyRsvp = Boolean(currentRsvp && !currentRsvp.websiteOperationId);
      }
    }
    return null;
  }

  private async publishWebsiteCommand(
    commandId: string,
    invitationCode: string
  ) {
    try {
      const queued = await this.publish(commandId, { requestId: "website-rsvp" });
      await this.repository.updateWhatsappCommand(commandId, {
        status: queued.status,
        enqueuedAt: queued.enqueuedAt,
        updatedAt: queued.enqueuedAt
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unable to enqueue WhatsApp RSVP command.";
      await this.repository.updateWhatsappCommand(commandId, {
        status: "failed",
        failureReason: reason,
        updatedAt: new Date().toISOString()
      }, {
        expression: "#status = :status",
        names: { "#status": "status" },
        values: { ":status": "queued" }
      }).catch(() => undefined);
      await this.repository.updateWhatsappFlow(invitationCode, {
        whatsappFlowStatus: "failed",
        whatsappFailureReason: reason,
        whatsappFlowUpdatedAt: new Date().toISOString()
      }, {
        expression: "#status = :status",
        names: { "#status": "whatsappFlowStatus" },
        values: { ":status": "website_followup_pending" }
      }).catch(() => undefined);
      console.error(JSON.stringify({
        metric: "RSVP_WHATSAPP_QUEUE_FAILED",
        invitationCode,
        commandId,
        error: reason
      }));
    }
  }
}

function buildRsvpNotificationText(
  invitation: Awaited<ReturnType<WeddingRepository["getInvitationByCode"]>>,
  request: RsvpSubmissionRequest,
  status: GuestProfile["rsvpStatus"],
  updatedAt: string,
  counts: ReturnType<typeof deriveRsvpCounts>
) {
  const musicSuggestion = getMusicSuggestionForDisplay(request.note);
  const responsesByGuestId = new Map(request.guestResponses.map((response) => [response.guestId, response]));
  const guestLines = invitation?.guests.map((guest) => {
    const response = responsesByGuestId.get(guest.guestId);
    if (!response || response.status !== "attending") {
      return `- ${guest.guestName}: nao vai comparecer`;
    }

    const ageLabel = response.isChildSixOrYounger
      ? "6 anos ou menos"
      : "7 anos ou mais";
    return `- ${guest.guestName}: vai comparecer (${ageLabel})`;
  }) ?? [];

  return [
    "Nova confirmacao de presenca recebida pelo site.",
    "",
    `Grupo: ${invitation?.householdName ?? request.invitationCode}`,
    `Codigo do convite: ${request.invitationCode}`,
    `Status geral: ${status}`,
    `Pessoas confirmadas: ${counts.attendingGuestCount}`,
    `Pagantes: ${counts.paidAttendingGuestCount}`,
    `Criancas 6 anos ou menos: ${counts.childSixOrYoungerAttendingCount}`,
    `Enviado por: ${request.submittedBy}`,
    `Atualizado em: ${updatedAt}`,
    ...(musicSuggestion ? [`Sugestão musical: ${musicSuggestion}`] : []),
    "",
    "Convidados:",
    ...guestLines
  ].join("\n");
}

function buildRsvpNotificationHtml(
  invitation: Awaited<ReturnType<WeddingRepository["getInvitationByCode"]>>,
  request: RsvpSubmissionRequest,
  status: GuestProfile["rsvpStatus"],
  updatedAt: string,
  counts: ReturnType<typeof deriveRsvpCounts>
) {
  const musicSuggestion = getMusicSuggestionForDisplay(request.note);
  const responsesByGuestId = new Map(request.guestResponses.map((response) => [response.guestId, response]));
  const guestItems =
    invitation?.guests
      .map((guest) => {
        const response = responsesByGuestId.get(guest.guestId);
        const description = !response || response.status !== "attending"
          ? "nao vai comparecer"
          : `vai comparecer (${response.isChildSixOrYounger ? "6 anos ou menos" : "7 anos ou mais"})`;

        return `<li>${escapeHtml(`${guest.guestName}: ${description}`)}</li>`;
      })
      .join("") ?? "";

  return renderEmailDocument(
    '<p style="margin:0 0 12px;">Oi, Brida &amp; Max!</p>' +
      '<p style="margin:0 0 16px;">Nova confirmacao de presenca recebida pelo site.</p>' +
      renderDetailLine("Grupo", invitation?.householdName ?? request.invitationCode) +
      renderDetailLine("Codigo do convite", request.invitationCode) +
      renderDetailLine("Status geral", status) +
      renderDetailLine("Pessoas confirmadas", String(counts.attendingGuestCount)) +
      renderDetailLine("Pagantes", String(counts.paidAttendingGuestCount)) +
      renderDetailLine(
        "Criancas 6 anos ou menos",
        String(counts.childSixOrYoungerAttendingCount)
      ) +
      renderDetailLine("Enviado por", request.submittedBy) +
      renderDetailLine("Atualizado em", updatedAt) +
      (musicSuggestion ? renderDetailLine("Sugestão musical", musicSuggestion) : "") +
      '<p style="margin:16px 0 8px;"><strong>Convidados:</strong></p>' +
      `<ul style="margin:0 0 16px 20px;padding:0;">${guestItems}</ul>` +
      `<p style="margin:0;color:#6b7280;font-size:14px;">Enviado automaticamente por ${escapeHtml(getEnv().siteLabel)}.</p>`
  );
}

function getMusicSuggestionForDisplay(note?: string) {
  if (!note) return undefined;
  return note.startsWith(MUSIC_NOTE_PREFIX) ? note.slice(MUSIC_NOTE_PREFIX.length) : note;
}
