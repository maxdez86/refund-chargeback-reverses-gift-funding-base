import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { WhatsappCommandIdSchema, WhatsappRsvpCommandStatusResponseSchema } from "@brimax/contracts";
import { WhatsappRsvpService } from "../../domain/whatsapp-rsvp-service";
import { jsonResponse } from "../../lib/http";
import { withWhatsappRsvpErrors } from "../../lib/whatsapp-rsvp-errors";
import { wrapLambdaHandler } from "../../lib/sentry";

let service: WhatsappRsvpService | undefined;
function getService() {
  service ??= new WhatsappRsvpService();
  return service;
}

async function onCommandStatus(event: APIGatewayProxyEventV2) {
  const commandId = WhatsappCommandIdSchema.parse(event.pathParameters?.commandId ?? "");
  const result = WhatsappRsvpCommandStatusResponseSchema.parse(await getService().getCommandStatus(commandId));
  return jsonResponse(200, result);
}

export const handler = wrapLambdaHandler(withWhatsappRsvpErrors(onCommandStatus, "WHATSAPP_RSVP_COMMAND_STATUS_FAILED"));
