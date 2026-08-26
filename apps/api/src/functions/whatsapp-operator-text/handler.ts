import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  InvitationCodeSchema,
  WhatsappIdempotencyKeySchema,
  WhatsappOperatorTextSendRequestSchema,
  WhatsappOperatorTextSendResponseSchema
} from "@brimax/contracts";
import { WhatsappOperatorTextService } from "../../services/whatsapp/operator-text-service";
import { WeddingRepository } from "../../services/dynamodb/repositories/wedding-repository";
import { enqueueWhatsappRsvp } from "../../services/sqs/whatsapp-rsvp-publisher";
import { headerValue, jsonResponse } from "../../lib/http";
import { withWhatsappRsvpErrors } from "../../lib/whatsapp-rsvp-errors";
import { wrapLambdaHandler } from "../../lib/sentry";

let service: WhatsappOperatorTextService | undefined;

function getService() {
  service ??= new WhatsappOperatorTextService({
    repository: new WeddingRepository(),
    publish: enqueueWhatsappRsvp
  });
  return service;
}

async function onOperatorText(event: APIGatewayProxyEventV2) {
  const invitationCode = InvitationCodeSchema.parse(event.pathParameters?.invitationCode ?? "");
  const body = WhatsappOperatorTextSendRequestSchema.parse(JSON.parse(event.body ?? "{}"));
  const rawIdempotencyKey = headerValue(event.headers, "idempotency-key");
  const idempotencyKey = rawIdempotencyKey === undefined
    ? undefined
    : WhatsappIdempotencyKeySchema.parse(rawIdempotencyKey);
  const result = await getService().queueText(invitationCode, body.body, idempotencyKey, {
    requestId: event.requestContext.requestId
  });
  return jsonResponse(202, WhatsappOperatorTextSendResponseSchema.parse(result));
}

export const handler = wrapLambdaHandler(withWhatsappRsvpErrors(onOperatorText));
