/**
 * Synthetic template ids for outbox commands that deliver a plain WhatsApp text rather than an
 * approved template. They are deliberately not valid template purposes (`^[a-z][a-z0-9_]{1,63}$`),
 * so a sentinel can never collide with a real template and the worker can branch on it safely.
 *
 * The two differ in more than provenance:
 *  - The fallback text is fixed, sent at most once per invitation, and stamps
 *    `whatsappFallbackSentAt` so the auto-reply never repeats.
 *  - Operator text carries its body on the command and must NOT stamp that flag — doing so would
 *    permanently suppress the automatic fallback for the invitation.
 */
export const WHATSAPP_FALLBACK_TEXT = "Ops! 😅 Como sou um assistente virtual novato, por enquanto só consigo ajudar com as confirmações de presença.\n\nPara qualquer outra dúvida, recadinho ou informação, por favor, envie um e-mail para casamento@brimax.life. A Brida e o Max vão adorar responder você por lá! 🤍";
export const WHATSAPP_FALLBACK_TEMPLATE_ID = "__whatsapp_fallback_text__";
export const WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID = "__whatsapp_operator_text__";

/** True when the command delivers plain text instead of resolving an approved template version. */
export function isWhatsappTextCommandTemplateId(templateId: string): boolean {
  return templateId === WHATSAPP_FALLBACK_TEMPLATE_ID ||
    templateId === WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID;
}
