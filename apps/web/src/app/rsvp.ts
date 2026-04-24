import { INVITATION_GROUPS, type InvitationGroup } from "./data";

export type RsvpResolution =
  | { state: "idle" }
  | { state: "resolved"; groupId: string }
  | { state: "ambiguous"; groupIds: string[] }
  | { state: "not-found" };

export type RsvpConfirmationPayload = {
  invitationGroupId: string;
  searchedName: string;
  confirmations: Array<{ name: string; attending: boolean }>;
  submittedAt: string;
};

type IndexedInvitationGroup = InvitationGroup & {
  normalizedGuests: string[];
};

const indexedInvitationGroups: IndexedInvitationGroup[] = INVITATION_GROUPS.map((group) => ({
  ...group,
  normalizedGuests: group.guests.map((guest) => normalizeLookupValue(guest))
}));

export const invitationGroupsById = new Map(indexedInvitationGroups.map((group) => [group.id, group]));

const guestNameIndex = new Map(
  indexedInvitationGroups.flatMap((group) => group.normalizedGuests.map((guest) => [guest, group.id]))
);

export function normalizeLookupValue(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function groupPreview(group: InvitationGroup): string {
  return group.guests.slice(0, 3).join(", ");
}

export function resetSelections(group: InvitationGroup): Record<string, boolean> {
  return Object.fromEntries(group.guests.map((guest) => [guest, true]));
}

export function levenshteinDistance(source: string, target: string): number {
  if (!source.length) return target.length;
  if (!target.length) return source.length;

  const previous = Array.from({ length: target.length + 1 }, (_, index) => index);

  for (let row = 1; row <= source.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;

    for (let column = 1; column <= target.length; column += 1) {
      const upper = previous[column];
      const cost = source[row - 1] === target[column - 1] ? 0 : 1;
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + cost);
      diagonal = upper;
    }
  }

  return previous[target.length];
}

export function scoreGuestMatch(query: string, guest: string): number {
  if (!query || !guest) return 0;
  if (query === guest) return 1;

  const queryTokens = query.split(" ");
  const guestTokens = guest.split(" ");
  let score = 0;

  const hasTokenPrefixMatch =
    queryTokens.length >= 1 &&
    queryTokens.every(
      (token) => token.length >= 2 && guestTokens.some((guestToken) => guestToken.startsWith(token))
    );

  if (hasTokenPrefixMatch) {
    score = Math.max(score, queryTokens.length >= 2 ? 0.9 : 0.82);
  }

  if (query.length >= 3 && guest.includes(query)) {
    score = Math.max(score, query.length >= 4 ? 0.84 : 0.8);
  }

  if (guest.length >= 3 && query.includes(guest)) {
    score = Math.max(score, 0.8);
  }

  const distanceThreshold = query.length <= 4 ? 1 : 2;
  const fullDistance = levenshteinDistance(query, guest);

  if (fullDistance <= distanceThreshold) {
    score = Math.max(score, 0.94 - fullDistance * 0.04);
  }

  if (queryTokens.length === 1) {
    guestTokens.forEach((guestToken) => {
      const tokenDistance = levenshteinDistance(query, guestToken);
      const tokenThreshold = query.length <= 4 ? 1 : 2;

      if (tokenDistance <= tokenThreshold) {
        score = Math.max(score, 0.9 - tokenDistance * 0.05);
      }
    });
  }

  return score;
}

export function fuzzyGroupCandidates(query: string): Array<{ groupId: string; score: number }> {
  return indexedInvitationGroups
    .map((group) => ({
      groupId: group.id,
      score: group.normalizedGuests.reduce(
        (highestScore, guest) => Math.max(highestScore, scoreGuestMatch(query, guest)),
        0
      )
    }))
    .filter((candidate) => candidate.score >= 0.8)
    .sort((left, right) => right.score - left.score);
}

export function resolveInvitationGroup(searchTerm: string): RsvpResolution {
  const normalizedSearch = normalizeLookupValue(searchTerm);

  if (!normalizedSearch) {
    return { state: "idle" };
  }

  const exactGroupId = guestNameIndex.get(normalizedSearch);

  if (exactGroupId) {
    return { state: "resolved", groupId: exactGroupId };
  }

  const candidates = fuzzyGroupCandidates(normalizedSearch);

  if (!candidates.length) {
    return { state: "not-found" };
  }

  const [bestCandidate, secondCandidate] = candidates;
  const hasClearWinner = !secondCandidate || bestCandidate.score - secondCandidate.score >= 0.08;

  if (hasClearWinner && bestCandidate.score >= 0.88) {
    return { state: "resolved", groupId: bestCandidate.groupId };
  }

  return {
    state: "ambiguous",
    groupIds: candidates
      .filter((candidate) => bestCandidate.score - candidate.score <= 0.08)
      .slice(0, 4)
      .map((candidate) => candidate.groupId)
  };
}

export function buildConfirmationPayload(
  group: InvitationGroup,
  searchedName: string,
  selections: Record<string, boolean>
): RsvpConfirmationPayload {
  return {
    invitationGroupId: group.id,
    searchedName,
    confirmations: group.guests.map((guest) => ({
      name: guest,
      attending: Boolean(selections[guest])
    })),
    submittedAt: new Date().toISOString()
  };
}
