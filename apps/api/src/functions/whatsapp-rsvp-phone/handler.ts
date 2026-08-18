import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { InvitationCodeSchema, WhatsappPhoneUpdateRequestSchema, WhatsappPhoneUpdateResponseSchema } from "@brimax/contracts";
import { WhatsappRsvpService } from "../../domain/whatsapp-rsvp-service";
import { jsonResponse } from "../../lib/http";
import { withWhatsappRsvpErrors } from "../../lib/whatsapp-rsvp-errors";
import { wrapLambdaHandler } from "../../lib/sentry";
let service: WhatsappRsvpService | undefined;
function getService() {
  service ??= new WhatsappRsvpService();
  return service;
}
async function onPhone(event: APIGatewayProxyEventV2) {
  const invitationCode = InvitationCodeSchema.parse(event.pathParameters?.invitationCode ?? "");
  const body = WhatsappPhoneUpdateRequestSchema.parse(JSON.parse(event.body ?? "{}"));
  const result = WhatsappPhoneUpdateResponseSchema.parse(await getService().updatePhone(invitationCode, body.phoneNumber));
  return jsonResponse(200, result);
}
export const handler = wrapLambdaHandler(withWhatsappRsvpErrors(onPhone));
