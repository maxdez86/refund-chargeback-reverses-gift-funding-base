import { AdminNextInvitationCodeResponseSchema } from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { WeddingRepository } from "../services/dynamodb/repositories/wedding-repository";
import { findNextAvailableInvitationCode } from "./invitation-code-suggestion";

export class AdminInvitationCodeService {
  constructor(private readonly repository = new WeddingRepository()) {}

  async getNextCode() {
    const invitationCode = findNextAvailableInvitationCode(await this.repository.listInvitationCodes());
    if (!invitationCode) throw new AppError("No invitation codes are available.", 503);

    return AdminNextInvitationCodeResponseSchema.parse({ ok: true, invitationCode });
  }
}
