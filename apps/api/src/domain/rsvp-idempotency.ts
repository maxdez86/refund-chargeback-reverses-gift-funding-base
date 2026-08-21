import { createHash } from "node:crypto";
import type { RsvpSubmissionRequest } from "@brimax/contracts";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalRequest(request: RsvpSubmissionRequest) {
  return JSON.stringify({
    invitationCode: request.invitationCode,
    submittedBy: request.submittedBy,
    guestResponses: request.guestResponses
      .slice()
      .sort((left, right) => left.guestId.localeCompare(right.guestId))
      .map((response) => ({
        guestId: response.guestId,
        status: response.status,
        isChildSixOrYounger: response.isChildSixOrYounger,
        mealPreference: response.mealPreference,
        note: response.note
      })),
    attendingGuestCount: request.attendingGuestCount,
    note: request.note
  });
}

export function createRsvpOperationIdentity(
  request: RsvpSubmissionRequest,
  idempotencyKey?: string
) {
  const websitePayloadDigest = digest(canonicalRequest(request));
  const websiteIdempotencyKeyDigest = idempotencyKey ? digest(idempotencyKey) : undefined;
  const operationSeed = idempotencyKey
    ? `${request.invitationCode}:key:${websiteIdempotencyKeyDigest}`
    : `${request.invitationCode}:payload:${websitePayloadDigest}`;

  return {
    websiteOperationId: `website-${digest(operationSeed)}`,
    websitePayloadDigest,
    websiteIdempotencyKeyDigest
  };
}
