import { AppError } from "../lib/errors";
import { WeddingRepository } from "../services/dynamodb/repositories/wedding-repository";

function normalizeInvitationCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export class InvitationService {
  constructor(private readonly repository = new WeddingRepository()) {}

  async getInvitation(invitationCode: string) {
    const normalized = normalizeInvitationCode(invitationCode);

    if (!normalized) {
      throw new AppError("Missing invitation code.", 400);
    }

    const invitation = await this.repository.getInvitationByCode(normalized);

    if (!invitation) {
      throw new AppError("Invitation not found.", 404);
    }

    return invitation;
  }
}
