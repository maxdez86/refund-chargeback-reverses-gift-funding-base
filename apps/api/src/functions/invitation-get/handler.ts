import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { InvitationService } from "../../domain/invitation-service";
import { AppError } from "../../lib/errors";
import { jsonResponse } from "../../lib/http";

const service = new InvitationService();

export async function handler(event: APIGatewayProxyEventV2) {
  try {
    const invitationCode = event.pathParameters?.code;

    if (!invitationCode) {
      throw new AppError("Missing invitation code.", 400);
    }

    const guestProfile = await service.getInvitation(invitationCode);

    return jsonResponse(200, guestProfile);
  } catch (error) {
    if (error instanceof AppError) {
      return jsonResponse(error.statusCode, { message: error.message });
    }

    return jsonResponse(500, { message: "Unexpected invitation lookup error." });
  }
}
