import { AppError } from "../lib/errors";
import { WeddingRepository } from "../services/dynamodb/repositories/wedding-repository";

export class InvitationService {
  constructor(private readonly repository = new WeddingRepository()) {}

  async getInvitation(invitationCode: string) {
    const guestProfile = await this.repository.getGuestProfileByInvitationCode(invitationCode);

    if (!guestProfile) {
      throw new AppError("Invitation not found.", 404);
    }

    return guestProfile;
  }
}
