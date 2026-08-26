import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { InvitationCodeSchema, WhatsappIdempotencyKeySchema, WhatsappRsvpAutoSendRequestSchema, WhatsappRsvpSendResponseSchema } from "@brimax/contracts";
import { WhatsappRsvpSendService } from "../../services/whatsapp/rsvp-send-service";
import { WeddingRepository } from "../../services/dynamodb/repositories/wedding-repository";
import { WhatsappTemplateRepository } from "../../services/whatsapp/template-repository";
import { enqueueWhatsappRsvp } from "../../services/sqs/whatsapp-rsvp-publisher";
import { validateWhatsappTemplateVariables } from "../../domain/whatsapp-template-variables";
import { headerValue, jsonResponse } from "../../lib/http";
import { withWhatsappRsvpErrors } from "../../lib/whatsapp-rsvp-errors";
import { wrapLambdaHandler } from "../../lib/sentry";

let service: WhatsappRsvpSendService | undefined;

function getService() {
  service ??= new WhatsappRsvpSendService({
    repository: new WeddingRepository(),
    templates: new WhatsappTemplateRepository(),
    publish: enqueueWhatsappRsvp,
    validateVariables: (invitation, definition) => validateWhatsappTemplateVariables(invitation, definition)
  });
  return service;
}

async function onAutoSend(event: APIGatewayProxyEventV2) {
  const invitationCode = InvitationCodeSchema.parse(event.pathParameters?.invitationCode ?? "");
  const body = WhatsappRsvpAutoSendRequestSchema.parse(event.body ? JSON.parse(event.body) : {});
  const rawIdempotencyKey = headerValue(event.headers, "idempotency-key");
  const idempotencyKey = rawIdempotencyKey === undefined
    ? undefined
    : WhatsappIdempotencyKeySchema.parse(rawIdempotencyKey);
  const result = await getService().queueAutoTemplate(invitationCode, body.mode, idempotencyKey, {
    requestId: event.requestContext.requestId
  });
  return jsonResponse(202, WhatsappRsvpSendResponseSchema.parse(result));
}

export const handler = wrapLambdaHandler(withWhatsappRsvpErrors(onAutoSend));
