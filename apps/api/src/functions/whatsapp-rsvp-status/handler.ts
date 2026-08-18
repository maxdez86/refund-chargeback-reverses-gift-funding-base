import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { InvitationCodeSchema, WhatsappRsvpStatusQuerySchema, WhatsappRsvpStatusResponseSchema } from "@brimax/contracts";
import { WhatsappRsvpService } from "../../domain/whatsapp-rsvp-service";
import { jsonResponse } from "../../lib/http";
import { withWhatsappRsvpErrors } from "../../lib/whatsapp-rsvp-errors";
import { wrapLambdaHandler } from "../../lib/sentry";
let service: WhatsappRsvpService | undefined;
function getService() {
  service ??= new WhatsappRsvpService();
  return service;
}
async function onStatus(event: APIGatewayProxyEventV2) {
  const invitationCode = InvitationCodeSchema.parse(event.pathParameters?.invitationCode ?? "");
  const query = WhatsappRsvpStatusQuerySchema.parse(event.queryStringParameters ?? {});
  const result = WhatsappRsvpStatusResponseSchema.parse(await getService().getStatus(invitationCode, query));
  return jsonResponse(200, result);
}
export const handler = wrapLambdaHandler(withWhatsappRsvpErrors(onStatus));
