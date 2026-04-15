import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { WeddingRepository } from "../../services/dynamodb/repositories/wedding-repository";
import { jsonResponse } from "../../lib/http";

const repository = new WeddingRepository();

export async function handler(event: APIGatewayProxyEventV2) {
  const parsedBody = JSON.parse(event.body ?? "{}");
  const eventId = String(parsedBody.id ?? event.requestContext.requestId);
  const accepted = await repository.recordWebhookEventIfNew("whatsapp", eventId);

  return jsonResponse(200, {
    ok: true,
    duplicate: !accepted,
    eventId
  });
}
