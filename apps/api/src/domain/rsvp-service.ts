import {
  RsvpSubmissionRequestSchema,
  RsvpSubmissionResponseSchema,
  type GuestProfile,
  type RsvpSubmissionRequest
} from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { getEnv } from "../lib/env";
import { deriveOverallRsvpStatus, deriveRsvpCounts } from "../services/dynamodb/mappers";
import { WeddingRepository } from "../services/dynamodb/repositories/wedding-repository";
import { EmailService } from "../services/email/client";
import { canTransition, isTerminalFlowStatus, transitionCondition } from "./whatsapp-flow-state";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
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
    private readonly emailService = new EmailService()
  ) {}

  async submit(request: unknown): Promise<RsvpSubmitResult> {
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
    const updatedAt = await this.repository.upsertRsvp(parsed, status);
    const currentWhatsappStatus = invitation.whatsappFlowStatus;
    if (
      currentWhatsappStatus &&
      currentWhatsappStatus !== "idle" &&
      !isTerminalFlowStatus(currentWhatsappStatus) &&
      canTransition(currentWhatsappStatus, "website_update_required") &&
      "updateWhatsappFlow" in this.repository
    ) {
      try {
        await this.repository.updateWhatsappFlow(parsed.invitationCode, {
          whatsappFlowStatus: "website_update_required",
          whatsappFlowCompletedAt: updatedAt,
          whatsappFlowUpdatedAt: updatedAt
        }, transitionCondition(currentWhatsappStatus));
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) throw error;
      }
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
