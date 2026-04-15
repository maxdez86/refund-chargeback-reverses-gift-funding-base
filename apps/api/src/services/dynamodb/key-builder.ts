export function invitationKeys(invitationCode: string) {
  return {
    PK: `INVITATION#${invitationCode}`,
    SK: "INVITATION"
  };
}

export function householdKeys(householdId: string) {
  return {
    PK: `HOUSEHOLD#${householdId}`,
    SK: "METADATA"
  };
}

export function guestKeys(householdId: string, guestId: string) {
  return {
    PK: `HOUSEHOLD#${householdId}`,
    SK: `GUEST#${guestId}`
  };
}

export function rsvpKeys(householdId: string) {
  return {
    PK: `HOUSEHOLD#${householdId}`,
    SK: "RSVP#CURRENT"
  };
}

export function contributionKeys(contributionId: string) {
  return {
    PK: `CONTRIBUTION#${contributionId}`,
    SK: "CONTRIBUTION"
  };
}

export function webhookKeys(provider: string, eventId: string) {
  return {
    PK: `WEBHOOK#${provider}`,
    SK: `EVENT#${eventId}`
  };
}

export function conversationKeys(phoneNumber: string) {
  return {
    PK: `PHONE#${phoneNumber}`,
    SK: "CONVERSATION#CURRENT"
  };
}

export function phoneLookupIndex(phoneNumber: string) {
  return {
    GSI1PK: `PHONE#${phoneNumber}`,
    GSI1SK: "PROFILE"
  };
}
