import { randomUUID } from "node:crypto";
import { InvitationCodeSchema, WhatsappRsvpCommandStatusResponseSchema, WhatsappRsvpSendResponseSchema, WhatsappPhoneUpdateResponseSchema, WhatsappRsvpStatusResponseSchema } from "@brimax/contracts";
import type { WhatsappFlowStatus, WhatsappWebhookProcessingResult } from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { WeddingRepository } from "../services/dynamodb/repositories/wedding-repository";
import { WhatsappTemplateRepository } from "../services/whatsapp/template-repository";
import { enqueueWhatsappRsvp } from "../services/sqs/whatsapp-rsvp-publisher";
import { WhatsappRecipientSchema } from "../services/whatsapp/schemas";
import { flowStageForTemplate } from "../services/whatsapp/template-manifest";
import { decideWhatsappRsvpBranch } from "./whatsapp-rsvp-branches";
import type { WhatsappWebhookEvent } from "@brimax/contracts";
import { WhatsappCloudApiClient } from "../services/whatsapp/client";
import { canTransition, isTerminalFlowStatus, transitionCondition } from "./whatsapp-flow-state";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { WhatsappRsvpSendService } from "../services/whatsapp/rsvp-send-service";
import { whatsappPhoneDigits, whatsappPhonesMatch } from "./whatsapp-phone-match";

export const WHATSAPP_FALLBACK_TEXT = "Ops! 😅 Como sou um assistente virtual novato, por enquanto só consigo ajudar com as confirmações de presença.\n\nPara qualquer outra dúvida, recadinho ou informação, por favor, envie um e-mail para casamento@brimax.life. A Brida e o Max vão adorar responder você por lá! 🤍";
export const WHATSAPP_FALLBACK_TEMPLATE_ID = "__whatsapp_fallback_text__";

function logWhatsappRsvp(entry: Record<string, unknown>) {
  console.info(JSON.stringify(entry));
}

// Keep this boundary generic: valid 8–15 digit E.164-shaped values are accepted,
// including local-looking numbers without a country-specific prefix.
export function normalizeWhatsappPhone(value: string) {
  const digits = value.replace(/[\s()+.-]/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new AppError("Invalid WhatsApp phone number.", 400);
  return digits;
}

export class WhatsappRsvpService {
  constructor(
    private readonly repository = new WeddingRepository(),
    private readonly templates = new WhatsappTemplateRepository(),
    private readonly client = new WhatsappCloudApiClient(),
    private readonly sendService?: WhatsappRsvpSendService
  ) {}

  private async enqueueCommand(commandId: string) {
    try {
      const result = await enqueueWhatsappRsvp(commandId, { requestId: "legacy-whatsapp-rsvp" });
      return result.status;
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : "Unable to enqueue WhatsApp RSVP command.",
        503,
        "QUEUE_FAILURE"
      );
    }
  }

  async updatePhone(invitationCode: string, phoneNumber: string) {
    InvitationCodeSchema.parse(invitationCode);
    const normalized = normalizeWhatsappPhone(phoneNumber);
    const updatedAt = await this.repository.updateInvitationWhatsappPhone(invitationCode, normalized);
    if ("putWhatsappInvitationPhoneLookup" in this.repository) {
      await this.repository.putWhatsappInvitationPhoneLookup(normalized, invitationCode);
    }
    return WhatsappPhoneUpdateResponseSchema.parse({ invitationCode, phoneNumber: normalized, updatedAt });
  }

  async getStatus(invitationCode: string, options: { limit?: number; cursor?: string } = {}) {
    InvitationCodeSchema.parse(invitationCode);
    const status = await this.repository.getInvitationWhatsappStatus(invitationCode);
    if (!status) throw new AppError("Invitation not found.", 404, "INVITATION_NOT_FOUND");
    const conversation = await this.repository.listWhatsappConversation(invitationCode, options);
    const history = conversation.entries.map((entry) => {
      if (entry.entityType === "WhatsappCommand") {
        return {
          kind: "command" as const,
          id: entry.commandId,
          status: entry.status,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          commandId: entry.commandId,
          templateId: entry.templateId,
          templateVersion: entry.templateVersion,
          stage: entry.stage,
          providerMessageId: entry.providerMessageId,
          retryCount: entry.retryCount,
          reconciliationStatus: entry.reconciliationStatus,
          providerErrorCategory: entry.providerErrorCategory,
          failureReason: entry.failureReason
        };
      }
      return {
        kind: "message" as const,
        id: entry.messageId,
        direction: entry.direction,
        status: entry.status,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        statusUpdatedAt: entry.statusUpdatedAt,
        commandId: entry.commandId,
        templateId: entry.templateId,
        templateVersion: entry.templateVersion,
        stage: entry.stage,
        providerMessageId: entry.direction === "outbound" ? entry.messageId : undefined,
        providerErrorCategory: entry.providerErrorCategory
      };
    });
    return WhatsappRsvpStatusResponseSchema.parse({
      ...status,
      history,
      nextCursor: conversation.nextCursor
    });
  }

  async getCommandStatus(commandId: string) {
    const command = await this.repository.getWhatsappCommand(commandId);
    if (!command) throw new AppError("WhatsApp command not found.", 404, "COMMAND_NOT_FOUND");
    return WhatsappRsvpCommandStatusResponseSchema.parse({
      commandId: command.commandId,
      invitationCode: command.invitationCode,
      templateId: command.templateId,
      templateVersion: command.templateVersion,
      status: command.status,
      retryCount: command.retryCount,
      reconciliationStatus: command.reconciliationStatus,
      providerMessageId: command.providerMessageId,
      providerErrorCategory: command.providerErrorCategory,
      failureReason: command.failureReason,
      createdAt: command.createdAt,
      updatedAt: command.updatedAt,
      enqueuedAt: command.enqueuedAt,
      startedAt: command.startedAt,
      lastAttemptAt: command.lastAttemptAt,
      sentAt: command.sentAt
    });
  }

  async queueFallbackText(invitationCode: string, _sourceMessageId: string) {
    const invitation = await this.repository.getInvitationByCode(invitationCode);
    if (!invitation?.phoneNumber) throw new AppError("Invitation has no WhatsApp phone number.", 422);
    if (invitation.whatsappFallbackSentAt) return `idempotency-fallback-${invitationCode}`;
    const commandId = `idempotency-fallback-${invitationCode}`;
    try {
      await this.repository.createWhatsappCommand({
        commandId, invitationCode, templateId: WHATSAPP_FALLBACK_TEMPLATE_ID,
        status: "queued", stage: "fallback", preserveFlowStatus: true, createdAt: new Date().toISOString()
      });
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    }
    await this.enqueueCommand(commandId);
    return commandId;
  }

  async queueTemplate(
    invitationCode: string,
    templateId: string,
    idempotencyKey?: string,
    options: { preserveFlowStatus?: boolean } = {}
  ) {
    if (this.sendService) {
      return this.sendService.queueTemplate(
        invitationCode,
        templateId,
        idempotencyKey,
        { requestId: "whatsapp-webhook" },
        options
      );
    }
    InvitationCodeSchema.parse(invitationCode);
    const invitation = await this.repository.getInvitationByCode(invitationCode);
    if (!invitation) throw new AppError("Invitation not found.", 404, "INVITATION_NOT_FOUND");
    const definition = await this.templates.getActive(templateId);
    if (!definition) throw new AppError("No active WhatsApp template exists.", 404, "TEMPLATE_NOT_FOUND");
    if (!invitation.phoneNumber || !WhatsappRecipientSchema.safeParse(invitation.phoneNumber).success) {
      throw new AppError("Invitation has no valid WhatsApp phone number.", 422, "INVALID_INVITATION_STATE");
    }
    const commandId = idempotencyKey
      ? `idempotency-${invitationCode}-${idempotencyKey}`
      : randomUUID();
    const now = new Date().toISOString();
    const currentStatus = invitation.whatsappFlowStatus ?? "idle";
    if (!options.preserveFlowStatus && isTerminalFlowStatus(currentStatus)) {
      throw new AppError("WhatsApp flow is terminal; reset it before sending again.", 409, "INVALID_FLOW_TRANSITION");
    }
    if (!options.preserveFlowStatus && !canTransition(currentStatus, "send_queued")) {
      throw new AppError("WhatsApp flow already has an active send.", 409, "INVALID_FLOW_TRANSITION");
    }
    try {
      await this.repository.createWhatsappCommand({
        commandId, invitationCode, templateId, templateVersion: definition.version,
        stage: flowStageForTemplate(templateId), status: "queued", preserveFlowStatus: options.preserveFlowStatus, createdAt: now
      });
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        const existing = await this.repository.getWhatsappCommand(commandId);
        if (existing && (existing.invitationCode !== invitationCode || existing.templateId !== templateId)) {
          throw new AppError("The provided idempotency key was already used with a different payload.", 409, "IDEMPOTENCY_CONFLICT");
        }
        if (existing?.status === "queued") {
          const queueStatus = await this.enqueueCommand(commandId);
          return WhatsappRsvpSendResponseSchema.parse({
            commandId, invitationCode, templateId, templateVersion: existing?.templateVersion ?? definition.version,
            status: existing?.status ?? queueStatus, replayed: true
          });
        }
        return WhatsappRsvpSendResponseSchema.parse({
          commandId, invitationCode, templateId, templateVersion: existing?.templateVersion ?? definition.version,
          status: existing?.status ?? "queued", replayed: true
        });
      }
      throw error;
    }
    if (!options.preserveFlowStatus) {
      try {
        await this.repository.updateWhatsappFlow(invitationCode, {
          whatsappFlowStatus: "send_queued" satisfies WhatsappFlowStatus,
          whatsappFlowStage: flowStageForTemplate(templateId), whatsappFlowUpdatedAt: now
        }, transitionCondition(currentStatus));
      } catch (error) {
        await this.repository.updateWhatsappCommand(commandId, {
          status: "failed",
          failureReason: "Flow state changed before the command could become active.",
          updatedAt: new Date().toISOString()
        }, {
          expression: "#c0 = :c0",
          names: { "#c0": "status" },
          values: { ":c0": "queued" }
        });
        throw error;
      }
    }
    const queueStatus = await this.enqueueCommand(commandId);
    return WhatsappRsvpSendResponseSchema.parse({ commandId, invitationCode, templateId, templateVersion: definition.version, status: queueStatus, replayed: false });
  }

  async handleWebhookEvent(event: WhatsappWebhookEvent, requestId: string): Promise<WhatsappWebhookProcessingResult> {
    switch (event.type) {
    case "status_sent":
    case "status_delivered":
    case "status_read":
    case "status_failed": {
      if (!(await this.repository.recordWebhookEventIfNew("whatsapp", event.eventId, 30 * 86_400, { eventType: event.type, providerMessageId: event.messageId }))) {
        const existing = await this.repository.getWebhookEvent("whatsapp", event.eventId);
        if (existing?.processingStatus === "processed") {
          logWhatsappRsvp({ metric: "WHATSAPP_RSVP_INBOUND_CORRELATION", requestId, eventId: event.eventId, messageId: event.messageId, outcome: "duplicate" });
          return { outcome: "duplicate" };
        }
      }
      if (typeof event.messageId !== "string") {
        await this.repository.markWebhookEventProcessed("whatsapp", event.eventId, { status: "processed" });
        return { outcome: "ignored", reason: "missing_message" };
      }
      const applied = await this.repository.updateWhatsappMessage(event.messageId, { status: event.status, statusUpdatedAt: new Date().toISOString(), providerErrorCode: event.errors[0]?.code, providerErrorTitle: event.errors[0]?.title, providerErrorCategory: event.type === "status_failed" ? "provider" : undefined });
      if (applied.applied && event.type === "status_failed") {
        const message = await this.repository.getWhatsappMessage(event.messageId);
        const invitation = message ? await this.repository.getInvitationByCode(message.invitationCode) : null;
        const currentStatus = invitation?.whatsappFlowStatus;
        if (invitation && currentStatus && canTransition(currentStatus, "failed")) {
          await this.repository.updateWhatsappFlow(invitation.invitationCode, {
            whatsappFlowStatus: "failed",
            whatsappFailureReason: "WhatsApp provider reported delivery failure.",
            whatsappFlowUpdatedAt: new Date().toISOString()
          }, transitionCondition(currentStatus));
        }
      }
      await this.repository.markWebhookEventProcessed("whatsapp", event.eventId, { status: "processed" });
      if (!applied.applied) {
        logWhatsappRsvp({ metric: "WHATSAPP_RSVP_INBOUND_CORRELATION", requestId, eventId: event.eventId, messageId: event.messageId, outcome: "unmapped" });
        return { outcome: "ignored", reason: "unknown_message" };
      }
      logWhatsappRsvp({ metric: "WHATSAPP_RSVP_INBOUND_CORRELATION", requestId, eventId: event.eventId, messageId: event.messageId, outcome: "matched" });
      return { outcome: "processed" };
    }
    case "button_reply":
    case "list_reply":
    case "text":
    case "audio":
    case "image":
    case "video":
    case "document":
    case "sticker":
    case "location":
    case "contacts":
    case "reaction":
    case "unsupported_message": {
      const replyContextMessageId = event.replyContextMessageId;
      const senderWaId = event.senderWaId;
      const incoming = event;
      if (!(await this.repository.recordWebhookEventIfNew("whatsapp", incoming.eventId, 30 * 86_400, { eventType: incoming.type, providerMessageId: incoming.messageId }))) {
        const existing = await this.repository.getWebhookEvent("whatsapp", incoming.eventId);
        if (existing?.processingStatus === "processed") {
          logWhatsappRsvp({ metric: "WHATSAPP_RSVP_INBOUND_CORRELATION", requestId, eventId: incoming.eventId, messageId: incoming.messageId, outcome: "duplicate" });
          return { outcome: "duplicate" };
        }
      }
      const outbound = replyContextMessageId ? await this.repository.getWhatsappMessage(replyContextMessageId) : undefined;
      let invitation = outbound ? await this.repository.getInvitationByCode(String(outbound.invitationCode)) : null;
      let invitationCode = outbound ? String(outbound.invitationCode) : undefined;
      if (!outbound && senderWaId && "getInvitationsByWhatsappPhone" in this.repository) {
        // Several invitations may legitimately share one number, so the ambiguity check below stays.
        const codes = new Set(await this.repository.getInvitationsByWhatsappPhone(whatsappPhoneDigits(senderWaId)));
        if (codes.size === 1) {
          invitationCode = [...codes][0];
          invitation = await this.repository.getInvitationByCode(invitationCode);
        }
        if (codes.size > 1) {
          logWhatsappRsvp({ metric: "WHATSAPP_RSVP_INBOUND_CORRELATION", requestId, eventId: incoming.eventId, messageId: incoming.messageId, outcome: "ambiguous" });
          await this.repository.markWebhookEventProcessed("whatsapp", incoming.eventId, { status: "processed", failureReason: "ambiguous_sender_phone" });
          return { outcome: "ignored", reason: "unknown_message" };
        }
      }
      if (!outbound) {
        if (invitation && senderWaId && !whatsappPhonesMatch(senderWaId, invitation.phoneNumber)) {
          await this.repository.markWebhookEventProcessed("whatsapp", incoming.eventId, { status: "processed" });
          return { outcome: "ignored", reason: "wrong_sender" };
        }
        if (!invitation || !invitationCode) {
          logWhatsappRsvp({ metric: "WHATSAPP_RSVP_INBOUND_CORRELATION", requestId, eventId: incoming.eventId, messageId: incoming.messageId, outcome: "unmapped" });
          await this.repository.markWebhookEventProcessed("whatsapp", incoming.eventId, { status: "processed" });
          return { outcome: "ignored", reason: "unknown_message" };
        }
      }
      invitationCode = invitationCode ?? String(outbound?.invitationCode);
      invitation = invitation ?? await this.repository.getInvitationByCode(invitationCode);
      if (!invitation) {
        logWhatsappRsvp({ metric: "WHATSAPP_RSVP_INBOUND_CORRELATION", requestId, eventId: incoming.eventId, messageId: incoming.messageId, outcome: "unknown_invitation" });
        await this.repository.markWebhookEventProcessed("whatsapp", incoming.eventId, { status: "processed" });
        return { outcome: "ignored", reason: "unknown_invitation" };
      }
      if (!invitation.phoneNumber || (senderWaId && !whatsappPhonesMatch(senderWaId, invitation.phoneNumber))) {
        logWhatsappRsvp({ metric: "WHATSAPP_RSVP_INBOUND_CORRELATION", requestId, eventId: incoming.eventId, messageId: incoming.messageId, outcome: "wrong_sender", invitationCode });
        await this.repository.markWebhookEventProcessed("whatsapp", incoming.eventId, { status: "processed" });
        return { outcome: "ignored", reason: "wrong_sender" };
      }
      const currentStatus = invitation.whatsappFlowStatus ?? "idle";
      const now = new Date().toISOString();
      await this.repository.putWhatsappMessage({ messageId: incoming.messageId, invitationCode, direction: "inbound", status: "received", senderPhone: senderWaId, replyContextMessageId, buttonId: incoming.type === "button_reply" ? incoming.buttonId : undefined, body: incoming.type === "text" ? incoming.body : undefined, createdAt: now });
      const buttonId = incoming.type === "button_reply" ? incoming.buttonId : undefined;
      const decision = decideWhatsappRsvpBranch(invitation, buttonId, currentStatus);
      logWhatsappRsvp({
        metric: "WHATSAPP_RSVP_BRANCH",
        requestId,
        eventId: incoming.eventId,
        messageId: incoming.messageId,
        invitationCode,
        outcome: decision.kind,
        branch: decision.kind === "branch" ? decision.action : decision.kind
      });
      if (decision.kind === "rejected") {
        if (decision.reason === "consistency_conflict") {
          try {
            await this.repository.updateWhatsappFlow(invitationCode, {
              whatsappFlowStatus: "reconciliation_required",
              whatsappLastInboundMessageId: incoming.messageId,
              whatsappFailureReason: "WhatsApp reply conflicts with the website RSVP state.",
              whatsappFlowUpdatedAt: now
            }, transitionCondition(currentStatus));
          } catch (error) {
            if (!(error instanceof ConditionalCheckFailedException)) throw error;
          }
        }
        await this.repository.markWebhookEventProcessed("whatsapp", incoming.eventId, {
          status: "processed", rejectionReason: decision.reason
        });
        return { outcome: "rejected", reason: decision.reason };
      }
      if (decision.kind === "fallback") {
        await this.queueFallbackText(invitationCode, incoming.eventId);
        logWhatsappRsvp({ metric: "WHATSAPP_RSVP_BRANCH", requestId, eventId: incoming.eventId, messageId: incoming.messageId, invitationCode, outcome: "fallback_queued" });
      } else {
        const values = {
          whatsappFlowStatus: decision.status,
          whatsappLastInboundMessageId: incoming.messageId,
          whatsappFlowUpdatedAt: now,
          whatsappFlowCompletedAt: now,
          ...(decision.action === "attend_all" ? {
            whatsappAttendance: invitation.guests.map((guest) => ({ guestId: guest.guestId, status: "attending" as const, recordedAt: now }))
          } : {})
        };
        try {
          await this.repository.updateWhatsappFlow(invitationCode, values, transitionCondition(currentStatus));
        } catch (error) {
          if (error instanceof ConditionalCheckFailedException) {
            await this.repository.markWebhookEventProcessed("whatsapp", incoming.eventId, { status: "processed", rejectionReason: "stale_flow" });
            return { outcome: "rejected", reason: "stale_flow" };
          }
          throw error;
        }
        if (decision.templateId) {
          await this.queueTemplate(invitationCode, decision.templateId, `branch-${invitationCode}-${decision.action}`, { preserveFlowStatus: true });
        }
      }
      await this.repository.markWebhookEventProcessed("whatsapp", incoming.eventId, { status: "processed" });
      logWhatsappRsvp({ metric: "WHATSAPP_RSVP_INBOUND_CORRELATION", requestId, eventId: incoming.eventId, messageId: incoming.messageId, invitationCode, outcome: "matched" });
      return { outcome: "processed" };
    }
    case "unknown_event": {
      await this.repository.recordWebhookEventIfNew("whatsapp", event.eventId, 30 * 86_400, { eventType: event.type });
      await this.repository.markWebhookEventProcessed("whatsapp", event.eventId, { status: "processed" });
      return { outcome: "ignored", reason: "unknown_event" };
    }
    case "invalid_payload": {
      await this.repository.recordWebhookEventIfNew("whatsapp", event.eventId, 30 * 86_400, { eventType: event.type });
      await this.repository.markWebhookEventProcessed("whatsapp", event.eventId, { status: "processed" });
      return { outcome: "ignored", reason: "invalid_payload" };
    }
    }
    throw new Error("Unhandled WhatsApp webhook event type.");
  }
}
