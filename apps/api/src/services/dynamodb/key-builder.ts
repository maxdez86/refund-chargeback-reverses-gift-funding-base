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

// Sparse GSI entry kept on a reservation only while it is open; ISO timestamps
// sort chronologically, so a range query on GSI1SK finds the stale ones.
export function reservationOpenIndex(expiresAt: string) {
  return {
    GSI1PK: "RESERVATION#OPEN",
    GSI1SK: expiresAt
  };
}

export function conversationKeys(phoneNumber: string) {
  return {
    PK: `PHONE#${phoneNumber}`,
    SK: "CONVERSATION#CURRENT"
  };
}

export function whatsappTemplateVersionKeys(purpose: string, version: number) {
  return {
    PK: `WHATSAPP_TEMPLATE#${purpose}`,
    SK: `VERSION#${String(version).padStart(6, "0")}`
  };
}

export function whatsappTemplateActiveKeys(purpose: string) {
  return {
    PK: `WHATSAPP_TEMPLATE#${purpose}`,
    SK: "ACTIVE"
  };
}

export function whatsappTemplateActivationKeys(purpose: string, activatedAt: string, activationId: string) {
  return {
    PK: `WHATSAPP_TEMPLATE#${purpose}`,
    SK: `ACTIVATION#${activatedAt}#${activationId}`
  };
}

export function phoneLookupIndex(phoneNumber: string) {
  return {
    GSI1PK: `PHONE#${phoneNumber}`,
    GSI1SK: "PROFILE"
  };
}

export function whatsappMessageKeys(messageId: string) {
  return { PK: `WHATSAPP_MESSAGE#${messageId}`, SK: "MESSAGE" };
}

export function whatsappInvitationPhoneLookupKeys(phoneNumber: string, invitationCode: string) {
  return { PK: `WHATSAPP_PHONE#${phoneNumber}`, SK: `INVITATION#${invitationCode}` };
}

export function whatsappCommandKeys(commandId: string) {
  return { PK: `WHATSAPP_COMMAND#${commandId}`, SK: "COMMAND" };
}

// Messages and commands live in their own partitions for point lookup by provider ID, so the
// conversation timeline is an overloaded GSI1 entry instead. The ISO timestamp sits ahead of
// the record kind so both kinds interleave chronologically under one begins_with query.
const WHATSAPP_CONVERSATION_PREFIX = "WHATSAPP#";

export function whatsappConversationIndexPrefix(invitationCode: string) {
  return {
    GSI1PK: `INVITATION#${invitationCode}`,
    GSI1SK: WHATSAPP_CONVERSATION_PREFIX
  };
}

export function whatsappConversationMessageIndex(
  invitationCode: string,
  createdAt: string,
  messageId: string
) {
  return {
    GSI1PK: `INVITATION#${invitationCode}`,
    GSI1SK: `${WHATSAPP_CONVERSATION_PREFIX}${createdAt}#MESSAGE#${messageId}`
  };
}

export function whatsappUnassignedMessageIndex(createdAt: string, messageId: string) {
  return {
    GSI1PK: whatsappUnassignedMessageIndexPrefix().GSI1PK,
    GSI1SK: `${WHATSAPP_CONVERSATION_PREFIX}${createdAt}#MESSAGE#${messageId}`
  };
}

export function whatsappUnassignedMessageIndexPrefix() {
  return {
    GSI1PK: "WHATSAPP#UNASSIGNED",
    GSI1SK: WHATSAPP_CONVERSATION_PREFIX
  };
}

export function whatsappConversationCommandIndex(
  invitationCode: string,
  createdAt: string,
  commandId: string
) {
  return {
    GSI1PK: `INVITATION#${invitationCode}`,
    GSI1SK: `${WHATSAPP_CONVERSATION_PREFIX}${createdAt}#COMMAND#${commandId}`
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
