import {
  RsvpSubmissionRequestSchema,
  RsvpSubmissionResponseSchema,
  type GuestProfile,
  type RsvpSubmissionRequest
} from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { getEnv } from "../lib/env";
import { deriveOverallRsvpStatus } from "../services/dynamodb/mappers";
import { WeddingRepository } from "../services/dynamodb/repositories/wedding-repository";
import { EmailService } from "../services/email/client";

type RsvpSubmitResult = {
  response: ReturnType<typeof RsvpSubmissionResponseSchema.parse>;
  notificationSent: boolean;
};

export class RsvpService {
  constructor(
    private readonly repository = new WeddingRepository(),
    private readonly emailService = new EmailService()
  ) {}

  async submit(request: RsvpSubmissionRequest): Promise<RsvpSubmitResult> {
    const parsed = RsvpSubmissionRequestSchema.parse(request);
    const invitation = await this.repository.getInvitationByCode(parsed.invitationCode);

    if (!invitation) {
      throw new AppError("Invitation not found.", 404);
    }

    if (invitation.householdId !== parsed.householdId) {
      throw new AppError("Invitation does not match the provided household.", 409);
    }

    const status: GuestProfile["rsvpStatus"] = deriveOverallRsvpStatus(parsed);
    const updatedAt = await this.repository.upsertRsvp(parsed, status);
    let notificationSent = false;

    try {
      await this.emailService.sendEmail({
        to: getEnv().rsvpNotificationTo,
        subject: `Nova confirmacao de presenca: ${invitation.householdName}`,
        text: buildRsvpNotificationText(invitation, parsed, status, updatedAt)
      });
      notificationSent = true;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "RSVP_EMAIL_FAILED",
          invitationCode: parsed.invitationCode,
          householdId: parsed.householdId,
          message: error instanceof Error ? error.message : "Unknown RSVP email error"
        })
      );
    }

    return {
      response: RsvpSubmissionResponseSchema.parse({
        ok: true,
        invitationCode: parsed.invitationCode,
        householdId: parsed.householdId,
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
  updatedAt: string
) {
  const responsesByGuestId = new Map(
    request.guestResponses.map((response) => [response.guestId, response.status])
  );
  const guestLines = invitation?.guests.map((guest) => {
    const response = responsesByGuestId.get(guest.guestId);
    return `- ${guest.guestName}: ${response === "attending" ? "vai comparecer" : "nao vai comparecer"}`;
  }) ?? [];

  return [
    "Nova confirmacao de presenca recebida pelo site.",
    "",
    `Grupo: ${invitation?.householdName ?? request.householdId}`,
    `Codigo do convite: ${request.invitationCode}`,
    `Household ID: ${request.householdId}`,
    `Status geral: ${status}`,
    `Pessoas confirmadas: ${request.attendingGuestCount}`,
    `Enviado por: ${request.submittedBy}`,
    `Atualizado em: ${updatedAt}`,
    "",
    "Convidados:",
    ...guestLines,
    "",
    "Recado:",
    request.note?.trim() ? request.note.trim() : "Nenhum recado enviado."
  ].join("\n");
}
