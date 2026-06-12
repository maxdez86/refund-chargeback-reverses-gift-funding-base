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

export function guestKeys(invitationCode: string, guestId: string) {
  return {
    PK: `INVITATION#${invitationCode}`,
    SK: `GUEST#${guestId}`
  };
}

export function rsvpKeys(invitationCode: string) {
  return {
    PK: `INVITATION#${invitationCode}`,
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

export function paymentKeys(paymentId: string) {
  return {
    PK: `PAYMENT#${paymentId}`,
    SK: "PAYMENT"
  };
}

export function paymentReservationKeys(paymentId: string) {
  return {
    PK: `PAYMENT#${paymentId}`,
    SK: "RESERVATION"
  };
}

export function paymentShellKeys(paymentId: string) {
  return {
    PK: `PAYMENT#${paymentId}`,
    SK: "SHELL"
  };
}

export function giftStateKeys(giftId: string) {
  return {
    PK: `GIFT#${giftId}`,
    SK: "STATE"
  };
}

export function giftMetadataKeys(giftId: string) {
  return {
    PK: `GIFT#${giftId}`,
    SK: "METADATA"
  };
}

export function paymentMessageKeys(paymentId: string) {
  return {
    PK: `PAYMENT#${paymentId}`,
    SK: "MESSAGE"
  };
}

export function paymentNotificationKeys(paymentId: string, type: string) {
  return {
    PK: `PAYMENT#${paymentId}`,
    SK: `NOTIFICATION#${type}`
  };
}

export function idempotencyKeys(idempotencyKey: string) {
  return {
    PK: `IDEMPOTENCY#${idempotencyKey}`,
    SK: "PAYMENT"
  };
}

export function asaasPaymentLookupIndex(asaasPaymentId: string) {
  return {
    GSI1PK: `ASAAS#PAYMENT#${asaasPaymentId}`,
    GSI1SK: "PAYMENT"
  };
}

export function asaasCheckoutLookupIndex(asaasCheckoutId: string) {
  return {
    GSI1PK: `ASAAS#CHECKOUT#${asaasCheckoutId}`,
    GSI1SK: "PAYMENT"
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

export function guestMessageFeedKey(createdAt: string, messageId: string) {
  return {
    PK: "GUEST_MESSAGES",
    SK: `MESSAGE#${createdAt}#${messageId}`
  };
}

export function guestMessageLookupKey(messageId: string) {
  return {
    PK: `GUEST_MESSAGE#${messageId}`,
    SK: "LOOKUP"
  };
}
