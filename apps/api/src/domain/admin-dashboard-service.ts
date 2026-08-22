import { AdminDashboardResponseSchema, type GuestMessage } from "@brimax/contracts";
import { WeddingRepository } from "../services/dynamodb/repositories/wedding-repository";
import { GiftService } from "./gift-service";
import { GuestMessageService } from "./guest-message-service";

export class AdminDashboardService {
  constructor(
    private readonly repository = new WeddingRepository(),
    private readonly giftService = new GiftService(),
    private readonly guestMessageService = new GuestMessageService(repository)
  ) {}

  async getDashboard() {
    const [invitations, giftResponse, guestMessages] = await Promise.all([
      this.repository.listAdminDashboardInvitations(),
      this.giftService.getGifts(),
      this.listAllGuestMessages()
    ]);

    return AdminDashboardResponseSchema.parse({
      ok: true,
      invitations,
      gifts: giftResponse.gifts,
      guestMessages
    });
  }

  private async listAllGuestMessages() {
    const messages: GuestMessage[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    do {
      const page = await this.guestMessageService.list(cursor);
      if (page.nextCursor && seenCursors.has(page.nextCursor)) {
        throw new Error("Guest-message pagination returned a repeated cursor.");
      }
      messages.push(...page.messages);
      cursor = page.nextCursor;
      if (cursor) seenCursors.add(cursor);
    } while (cursor);

    return messages;
  }
}
