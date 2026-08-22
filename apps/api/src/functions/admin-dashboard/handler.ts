import { AdminDashboardResponseSchema } from "@brimax/contracts";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { AdminDashboardService } from "../../domain/admin-dashboard-service";
import { corsHeaders, jsonResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";

let service: AdminDashboardService | undefined;

function getService() {
  service ??= new AdminDashboardService();
  return service;
}

async function onAdminDashboard(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  try {
    const response = AdminDashboardResponseSchema.parse(await getService().getDashboard());
    return jsonResponse(200, response, cors);
  } catch (error) {
    reportHandledError(error, {
      context: { requestId: event.requestContext.requestId },
      metric: "ADMIN_DASHBOARD_LOOKUP_FAILED",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected administrator dashboard error." }, cors);
  }
}

export const handler = wrapLambdaHandler(onAdminDashboard);
