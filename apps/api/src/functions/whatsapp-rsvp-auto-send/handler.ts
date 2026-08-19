import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { InvitationCodeSchema, WhatsappIdempotencyKeySchema, WhatsappRsvpSendResponseSchema } from "@brimax/contracts";
import { selectWhatsappRsvpTemplate } from "../../domain/whatsapp-rsvp-template-selection";
import { WhatsappRsvpSendService } from "../../services/whatsapp/rsvp-send-service";
import { WeddingRepository } from "../../services/dynamodb/repositories/wedding-repository";
import { WhatsappTemplateRepository } from "../../services/whatsapp/template-repository";
import { enqueueWhatsappRsvp } from "../../services/sqs/whatsapp-rsvp-publisher";
import { validateWhatsappTemplateVariables } from "../../domain/whatsapp-template-variables";
import { AppError } from "../../lib/errors";
import { headerValue, jsonResponse } from "../../lib/http";
import { withWhatsappRsvpErrors } from "../../lib/whatsapp-rsvp-errors";
import { wrapLambdaHandler } from "../../lib/sentry";

let repository: WeddingRepository | undefined;
let service: WhatsappRsvpSendService | undefined;

function getRepository() {
  repository ??= new WeddingRepository();
  return repository;
}

function getService() {
  service ??= new WhatsappRsvpSendService({
    repository: getRepository(),
    templates: new WhatsappTemplateRepository(),
    publish: enqueueWhatsappRsvp,
    validateVariables: (invitation, definition) => validateWhatsappTemplateVariables(invitation, definition)
  });
  return service;
}

async function onAutoSend(event: APIGatewayProxyEventV2) {
  const invitationCode = InvitationCodeSchema.parse(event.pathParameters?.invitationCode ?? "");
  const rawIdempotencyKey = headerValue(event.headers, "idempotency-key");
  const idempotencyKey = rawIdempotencyKey === undefined
    ? undefined
    : WhatsappIdempotencyKeySchema.parse(rawIdempotencyKey);
  const invitation = await getRepository().getInvitationByCode(invitationCode);
  if (!invitation) {
    throw new AppError("Invitation not found.", 404, "INVITATION_NOT_FOUND");
  }

  const templateId = selectWhatsappRsvpTemplate(invitation);
  const result = await getService().queueTemplate(invitationCode, templateId, idempotencyKey, {
    requestId: event.requestContext.requestId
  });
  return jsonResponse(202, WhatsappRsvpSendResponseSchema.parse(result));
}

export const handler = wrapLambdaHandler(withWhatsappRsvpErrors(onAutoSend));
