import { randomUUID } from "node:crypto";
import { InvitationCodeSchema, WhatsappRsvpSendResponseSchema, type HouseholdInvitation, type WhatsappCommandEffect, type WhatsappCommandStatus, type WhatsappFlowStatus, type WhatsappRsvpSendMode } from "@brimax/contracts";
import type { WhatsappCommandInput, WhatsappCommandItem } from "../dynamodb/whatsapp-items";
import type { RsvpResponseItem } from "../dynamodb/rsvp-items";
import { AppError } from "../../lib/errors";
import { canTransition, isTerminalFlowStatus } from "../../domain/whatsapp-flow-state";
import { flowStageForTemplate } from "./template-manifest";
import { WhatsappRecipientSchema } from "./schemas";
import type { WhatsappTemplateDefinition } from "./schemas";
import { isConditionalTransactionCancellation } from "../dynamodb/transaction-errors";
import { selectWhatsappRsvpTemplate } from "../../domain/whatsapp-rsvp-template-selection";
import { deriveWhatsappRsvpSendAvailability } from "../../domain/whatsapp-rsvp-send-availability";
import { recordWhatsappCommandEnqueued } from "./command-enqueue";

export type QueueResult = { status: "queued"; enqueuedAt: string; messageId?: string };
export type QueuePublisher = (commandId: string, context: { requestId: string }) => Promise<QueueResult>;

export type RsvpSendRepository = {
  getInvitationByCode(code: string): Promise<HouseholdInvitation | null>;
  getRsvpResponse(invitationCode: string): Promise<RsvpResponseItem | null>;
  getWhatsappCommand(commandId: string): Promise<WhatsappCommandItem | undefined>;
  reserveWhatsappCommand(
    input: WhatsappCommandInput,
    expectedStatus: WhatsappFlowStatus | undefined,
    completedRestart?: { completedAt: string; rsvpUpdatedAt: string | null }
  ): Promise<void>;
  updateWhatsappCommand(commandId: string, values: Partial<Omit<WhatsappCommandInput, "commandId">>, condition?: { expression: string; names?: Record<string, string>; values?: Record<string, unknown> }): Promise<void>;
  updateWhatsappFlow(invitationCode: string, values: { whatsappFlowStatus?: WhatsappFlowStatus; whatsappFailureReason?: string; whatsappFlowUpdatedAt?: string; whatsappFallbackSentAt?: string; whatsappLastOutboundMessageId?: string }, condition?: { expression: string; names?: Record<string, string>; values?: Record<string, unknown> }): Promise<void>;
};

export type RsvpTemplateRepository = {
  getActive(templateId: string): Promise<WhatsappTemplateDefinition | null>;
};

export type RsvpSendOptions = {
  effect?: WhatsappCommandEffect;
  expectedFlowStatus?: WhatsappFlowStatus;
  restartFrom?: "failed" | "undecided" | "completed";
  completedRestart?: { completedAt: string; rsvpUpdatedAt: string | null };
  operatorSendMode?: WhatsappRsvpSendMode;
};

type Dependencies = {
  repository: RsvpSendRepository;
  templates: RsvpTemplateRepository;
  publish: QueuePublisher;
  validateVariables: (invitation: HouseholdInvitation, definition: WhatsappTemplateDefinition) => unknown;
  log?: (entry: Record<string, unknown>) => void;
  now?: () => string;
  createCommandId?: () => string;
};

export class WhatsappRsvpSendService {
  private readonly log: (entry: Record<string, unknown>) => void;
  private readonly now: () => string;
  private readonly createCommandId: () => string;

  constructor(private readonly dependencies: Dependencies) {
    this.log = dependencies.log ?? ((entry) => console.info(JSON.stringify(entry)));
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createCommandId = dependencies.createCommandId ?? randomUUID;
  }

  async queueTemplate(
    invitationCode: string,
    templateId: string,
    idempotencyKey: string | undefined,
    context: { requestId: string },
    options: RsvpSendOptions = {}
  ) {
    InvitationCodeSchema.parse(invitationCode);
    const existing = await this.existingIdempotentCommand(idempotencyKey);
    if (existing) {
      this.assertReplayPayload(existing, invitationCode, templateId, options.operatorSendMode);
      return this.replay(existing, context);
    }
    const invitation = await this.dependencies.repository.getInvitationByCode(invitationCode);
    if (!invitation) throw new AppError("Invitation not found.", 404, "INVITATION_NOT_FOUND");
    return this.queueLoadedTemplate(invitation, templateId, idempotencyKey, context, options);
  }

  async queueAutoTemplate(
    invitationCode: string,
    mode: WhatsappRsvpSendMode,
    idempotencyKey: string | undefined,
    context: { requestId: string }
  ) {
    InvitationCodeSchema.parse(invitationCode);
    const existing = await this.existingIdempotentCommand(idempotencyKey);
    if (existing) {
      this.assertReplayPayload(existing, invitationCode, undefined, mode);
      return this.replay(existing, context);
    }
    let invitation = await this.dependencies.repository.getInvitationByCode(invitationCode);
    if (!invitation) throw new AppError("Invitation not found.", 404, "INVITATION_NOT_FOUND");
    if (invitation.guests.length === 0) {
      throw new AppError("Invitation must contain at least one guest.", 422, "INVALID_INVITATION_STATE");
    }

    let rsvpUpdatedAt: string | null | undefined;
    if (mode === "resend" && invitation.whatsappFlowStatus === "completed") {
      const currentRsvp = await this.dependencies.repository.getRsvpResponse(invitationCode);
      rsvpUpdatedAt = currentRsvp?.updatedAt ?? null;
      invitation = await this.dependencies.repository.getInvitationByCode(invitationCode);
      if (!invitation) throw new AppError("Invitation not found.", 404, "INVITATION_NOT_FOUND");
    }

    const currentStatus = invitation.whatsappFlowStatus ?? "idle";
    const availability = deriveWhatsappRsvpSendAvailability(invitation);
    if (mode === "first" && !availability.firstAllowed) {
      throw new AppError("First WhatsApp send requires an idle flow.", 409, "INVALID_FLOW_TRANSITION");
    }
    if (mode === "resend" && !availability.resendAllowed) {
      throw new AppError("WhatsApp resend requires a failed, undecided, or completed pending flow.", 409, "INVALID_FLOW_TRANSITION");
    }

    const completedRestart = availability.resendReason === "completed_pending"
      ? {
          completedAt: invitation.whatsappFlowCompletedAt!,
          rsvpUpdatedAt: rsvpUpdatedAt ?? null
        }
      : undefined;

    return this.queueLoadedTemplate(
      invitation,
      selectWhatsappRsvpTemplate(invitation),
      idempotencyKey,
      context,
      {
        operatorSendMode: mode,
        ...(mode === "resend" ? { restartFrom: currentStatus as "failed" | "undecided" | "completed" } : {}),
        ...(completedRestart ? { completedRestart } : {})
      }
    );
  }

  private async queueLoadedTemplate(
    invitation: HouseholdInvitation,
    templateId: string,
    idempotencyKey: string | undefined,
    context: { requestId: string },
    options: RsvpSendOptions = {}
  ) {
    const invitationCode = invitation.invitationCode;
    let commandId: string | undefined;
    try {
      const definition = await this.dependencies.templates.getActive(templateId);
      if (!definition) throw new AppError("No active WhatsApp template exists.", 404, "TEMPLATE_NOT_FOUND");
      if (!invitation.phoneNumber || !WhatsappRecipientSchema.safeParse(invitation.phoneNumber).success) {
        throw new AppError("Invitation has no valid WhatsApp phone number.", 422, "INVALID_INVITATION_STATE");
      }
      const stage = flowStageForTemplate(templateId);
      if (!stage) {
        throw new AppError("The selected template is not part of the WhatsApp RSVP flow.", 422, "INVALID_INVITATION_STATE");
      }

      const currentStatus = invitation.whatsappFlowStatus ?? "idle";
      const effect = options.effect ?? "opener";
      if (effect === "complete_on_send" && !options.expectedFlowStatus) {
        throw new AppError("Complete-on-send commands require an expected flow status.", 422, "INVALID_FLOW_TRANSITION");
      }
      const allowedRestart = options.restartFrom !== undefined && currentStatus === options.restartFrom;
      if (!allowedRestart && effect === "opener" &&
        (isTerminalFlowStatus(currentStatus) || !canTransition(currentStatus, "send_queued"))) {
        throw new AppError("WhatsApp flow already has an active or terminal send.", 409, "INVALID_FLOW_TRANSITION");
      }
      this.dependencies.validateVariables(invitation, definition);

      commandId = idempotencyKey
        ? `idempotency-${idempotencyKey}`
        : this.createCommandId();
      const now = this.now();
      try {
        const command = {
          commandId,
          invitationCode,
          templateId,
          templateVersion: definition.version,
          stage,
          status: "queued",
          effect,
          expectedFlowStatus: effect === "opener" ? "send_queued" : options.expectedFlowStatus,
          operatorSendMode: options.operatorSendMode,
          createdAt: now
        } satisfies WhatsappCommandInput;
        if (options.completedRestart) {
          await this.dependencies.repository.reserveWhatsappCommand(
            command,
            effect === "opener" ? currentStatus : undefined,
            options.completedRestart
          );
        } else {
          await this.dependencies.repository.reserveWhatsappCommand(
            command,
            effect === "opener" ? currentStatus : undefined
          );
        }
      } catch (error) {
        if (!isConditionalTransactionCancellation(error) && (error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
        const existing = await this.dependencies.repository.getWhatsappCommand(commandId);
        if (!existing) {
          throw new AppError(
            "Invitation state changed before the WhatsApp command could be reserved.",
            409,
            "INVALID_FLOW_TRANSITION"
          );
        }
        this.assertReplayPayload(existing, invitationCode, templateId, options.operatorSendMode);
        return this.replay(existing, context, definition.version, false);
      }

      const queued = await this.enqueue(commandId, context);
      await recordWhatsappCommandEnqueued(this.dependencies.repository, commandId, queued);
      return this.finish({ commandId, invitationCode, templateId, templateVersion: definition.version, status: queued.status, replayed: false }, context);
    } catch (error) {
      if (commandId && error instanceof AppError && error.statusCode === 503 && ["QUEUE_FAILURE", "QUEUE_UNAVAILABLE"].includes(error.code ?? "")) {
        await this.dependencies.repository.updateWhatsappCommand(commandId, { status: "failed", failureReason: error.message, updatedAt: this.now() }, {
          expression: "#c0 = :c0", names: { "#c0": "status" }, values: { ":c0": "queued" }
        }).catch(() => undefined);
        if (options.effect !== "preserve") {
          await this.dependencies.repository.updateWhatsappFlow(invitationCode, {
            whatsappFlowStatus: "failed",
            whatsappFailureReason: error.message,
            whatsappFlowUpdatedAt: this.now()
          }, {
            expression: "#c0 = :c0", names: { "#c0": "whatsappFlowStatus" }, values: { ":c0": options.effect === "complete_on_send" ? options.expectedFlowStatus : "send_queued" }
          }).catch(() => undefined);
        }
      }
      this.log({ metric: "WHATSAPP_RSVP_SEND_FAILURE", requestId: context.requestId, commandId, invitationCode, templateId, errorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR" });
      this.log({ metric: "WHATSAPP_RSVP_SEND", requestId: context.requestId, commandId, invitationCode, templateId, outcome: "failure", errorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR" });
      throw error;
    }
  }

  private async enqueue(commandId: string, context: { requestId: string }) {
    try {
      return await this.dependencies.publish(commandId, context);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 503) throw error;
      throw new AppError("Unable to enqueue WhatsApp RSVP command.", 503, "QUEUE_FAILURE");
    }
  }

  private async existingIdempotentCommand(idempotencyKey: string | undefined) {
    if (!idempotencyKey) return undefined;
    return this.dependencies.repository.getWhatsappCommand(`idempotency-${idempotencyKey}`);
  }

  private assertReplayPayload(
    existing: WhatsappCommandItem,
    invitationCode: string,
    templateId: string | undefined,
    requestedMode: WhatsappRsvpSendMode | undefined
  ) {
    const existingMode = existing.operatorSendMode ?? "first";
    if (existing.invitationCode !== invitationCode ||
      (templateId !== undefined && existing.templateId !== templateId) ||
      (requestedMode ? existingMode !== requestedMode : existing.operatorSendMode !== undefined)) {
      throw new AppError("The provided idempotency key was already used with a different payload.", 409, "IDEMPOTENCY_CONFLICT");
    }
  }

  private async replay(
    existing: WhatsappCommandItem,
    context: { requestId: string },
    fallbackTemplateVersion = 1,
    handleQueueFailure = true
  ) {
    try {
      let status = existing.status;
      if (status === "queued" || status === "queue_unavailable") {
        const queued = await this.enqueue(existing.commandId, context);
        status = queued.status;
        await recordWhatsappCommandEnqueued(this.dependencies.repository, existing.commandId, queued);
      }
      return this.finish({
        commandId: existing.commandId,
        invitationCode: existing.invitationCode,
        templateId: existing.templateId,
        templateVersion: existing.templateVersion ?? fallbackTemplateVersion,
        status,
        replayed: true
      }, context);
    } catch (error) {
      if (!handleQueueFailure || !(error instanceof AppError) || error.statusCode !== 503) throw error;
      const now = this.now();
      await this.dependencies.repository.updateWhatsappCommand(existing.commandId, {
        status: "failed",
        failureReason: error.message,
        updatedAt: now
      }, {
        expression: "#c0 = :c0",
        names: { "#c0": "status" },
        values: { ":c0": existing.status }
      }).catch(() => undefined);
      const effect = existing.effect ?? "opener";
      if (effect !== "preserve") {
        await this.dependencies.repository.updateWhatsappFlow(existing.invitationCode, {
          whatsappFlowStatus: "failed",
          whatsappFailureReason: error.message,
          whatsappFlowUpdatedAt: now
        }, {
          expression: "#c0 = :c0",
          names: { "#c0": "whatsappFlowStatus" },
          values: { ":c0": effect === "complete_on_send" ? existing.expectedFlowStatus : "send_queued" }
        }).catch(() => undefined);
      }
      this.log({ metric: "WHATSAPP_RSVP_SEND_FAILURE", requestId: context.requestId, commandId: existing.commandId, invitationCode: existing.invitationCode, templateId: existing.templateId, errorCode: error.code });
      this.log({ metric: "WHATSAPP_RSVP_SEND", requestId: context.requestId, commandId: existing.commandId, invitationCode: existing.invitationCode, templateId: existing.templateId, outcome: "failure", errorCode: error.code });
      throw error;
    }
  }

  private finish(input: { commandId: string; invitationCode: string; templateId: string; templateVersion: number; status: WhatsappCommandStatus; replayed: boolean }, context: { requestId: string }) {
    this.log({ metric: "WHATSAPP_RSVP_SEND", requestId: context.requestId, commandId: input.commandId, invitationCode: input.invitationCode, templateId: input.templateId, outcome: input.replayed ? "replayed" : "queued" });
    return WhatsappRsvpSendResponseSchema.parse(input);
  }
}
