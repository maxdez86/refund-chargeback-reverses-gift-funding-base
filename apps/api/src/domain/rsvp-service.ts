import {
  RsvpSubmissionRequestSchema,
  RsvpSubmissionResponseSchema,
  type GuestProfile,
  type RsvpSubmissionRequest
} from "@brimax/contracts";
import { deriveOverallRsvpStatus } from "../services/dynamodb/mappers";
import { WeddingRepository } from "../services/dynamodb/repositories/wedding-repository";

export class RsvpService {
  constructor(private readonly repository = new WeddingRepository()) {}

  async submit(request: RsvpSubmissionRequest) {
    const parsed = RsvpSubmissionRequestSchema.parse(request);
    const status: GuestProfile["rsvpStatus"] = deriveOverallRsvpStatus(parsed);
    const updatedAt = await this.repository.upsertRsvp(parsed, status);

    return RsvpSubmissionResponseSchema.parse({
      ok: true,
      invitationCode: parsed.invitationCode,
      householdId: parsed.householdId,
      status,
      updatedAt
    });
  }
}
