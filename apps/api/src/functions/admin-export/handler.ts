import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getEnv } from "../../lib/env";
import { jsonResponse } from "../../lib/http";
import { WeddingRepository } from "../../services/dynamodb/repositories/wedding-repository";

const repository = new WeddingRepository();

export async function handler(event: APIGatewayProxyEventV2) {
  const adminToken = event.headers["x-admin-token"];

  if (!adminToken || adminToken !== getEnv().adminExportToken) {
    return jsonResponse(403, { message: "Forbidden." });
  }

  const rows = await repository.exportGuests();

  return jsonResponse(200, {
    ok: true,
    rows
  });
}
