import { randomUUID } from "node:crypto";
import { InvitationCodeSchema, WhatsappRsvpSendResponseSchema, type HouseholdInvitation, type WhatsappCommandStatus, type WhatsappFlowStatus } from "@brimax/contracts";
import type { WhatsappCommandInput, WhatsappCommandItem } from "../dynamodb/whatsapp-items";
import { AppError } from "../../lib/errors";
import { canTransition, isTerminalFlowStatus } from "../../domain/whatsapp-flow-state";
import { flowStageForTemplate } from "./template-manifest";
import { WhatsappRecipientSchema } from "./schemas";
import type { WhatsappTemplateDefinition } from "./schemas";

export type QueueResult = { status: "queued"; enqueuedAt: string; messageId?: string };
export type QueuePublisher = (commandId: string, context: { requestId: string }) => Promise<QueueResult>;

export type RsvpSendRepository = {
  getInvitationByCode(code: string): Promise<HouseholdInvitation | null>;
  getWhatsappCommand(commandId: string): Promise<WhatsappCommandItem | undefined>;
  reserveWhatsappCommand(input: WhatsappCommandInput, expectedStatus: WhatsappFlowStatus | undefined): Promise<void>;
  updateWhatsappCommand(commandId: string, values: Partial<Omit<WhatsappCommandInput, "commandId">>, condition?: { expression: string; names?: Record<string, string>; values?: Record<string, unknown> }): Promise<void>;
  updateWhatsappFlow(invitationCode: string, values: { whatsappFlowStatus?: WhatsappFlowStatus; whatsappFailureReason?: string; whatsappFlowUpdatedAt?: string; whatsappFallbackSentAt?: string; whatsappLastOutboundMessageId?: string }, condition?: { expression: string; names?: Record<string, string>; values?: Record<string, unknown> }): Promise<void>;
};

export type RsvpTemplateRepository = {
  getActive(templateId: string): Promise<WhatsappTemplateDefinition | null>;
};

export type RsvpSendOptions = {
  force?: boolean;
  preserveFlowStatus?: boolean;
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
    let commandId: string | undefined;
    try {
      InvitationCodeSchema.parse(invitationCode);
      const invitation = await this.dependencies.repository.getInvitationByCode(invitationCode);
      if (!invitation) throw new AppError("Invitation not found.", 404, "INVITATION_NOT_FOUND");
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
      if (!options.force && !options.preserveFlowStatus &&
        (isTerminalFlowStatus(currentStatus) || !canTransition(currentStatus, "send_queued"))) {
        throw new AppError("WhatsApp flow already has an active or terminal send.", 409, "INVALID_FLOW_TRANSITION");
      }
      this.dependencies.validateVariables(invitation, definition);

      commandId = idempotencyKey
        ? `idempotency-${idempotencyKey}`
        : this.createCommandId();
      const now = this.now();
      try {
        await this.dependencies.repository.reserveWhatsappCommand({
          commandId,
          invitationCode,
          templateId,
          templateVersion: definition.version,
          stage,
          status: "queued",
          preserveFlowStatus: options.preserveFlowStatus,
          createdAt: now
        }, options.preserveFlowStatus ? undefined : currentStatus);
      } catch (error) {
        if ((error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
        const existing = await this.dependencies.repository.getWhatsappCommand(commandId);
        if (!existing) throw error;
        if (existing.invitationCode !== invitationCode || existing.templateId !== templateId) {
          throw new AppError("The provided idempotency key was already used with a different payload.", 409, "IDEMPOTENCY_CONFLICT");
        }
        if (["queued", "queue_unavailable"].includes(existing.status)) {
          const queued = await this.enqueue(commandId, context);
          await this.dependencies.repository.updateWhatsappCommand(commandId, { status: queued.status, enqueuedAt: queued.enqueuedAt, updatedAt: queued.enqueuedAt });
          return this.finish({ commandId, invitationCode, templateId, templateVersion: existing.templateVersion ?? definition.version, status: queued.status, replayed: true }, context);
        }
        return this.finish({ commandId, invitationCode, templateId, templateVersion: existing.templateVersion ?? definition.version, status: existing.status, replayed: true }, context);
      }

      const queued = await this.enqueue(commandId, context);
      await this.dependencies.repository.updateWhatsappCommand(commandId, { status: queued.status, enqueuedAt: queued.enqueuedAt, updatedAt: queued.enqueuedAt });
      return this.finish({ commandId, invitationCode, templateId, templateVersion: definition.version, status: queued.status, replayed: false }, context);
    } catch (error) {
      if (commandId && error instanceof AppError && error.statusCode === 503 && ["QUEUE_FAILURE", "QUEUE_UNAVAILABLE"].includes(error.code ?? "")) {
        await this.dependencies.repository.updateWhatsappCommand(commandId, { status: "failed", failureReason: error.message, updatedAt: this.now() }, {
          expression: "#c0 = :c0", names: { "#c0": "status" }, values: { ":c0": "queued" }
        }).catch(() => undefined);
        await this.dependencies.repository.updateWhatsappFlow(invitationCode, {
          whatsappFlowStatus: "failed",
          whatsappFailureReason: error.message,
          whatsappFlowUpdatedAt: this.now()
        }, {
          expression: "#c0 = :c0", names: { "#c0": "whatsappFlowStatus" }, values: { ":c0": "send_queued" }
        }).catch(() => undefined);
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

  private finish(input: { commandId: string; invitationCode: string; templateId: string; templateVersion: number; status: WhatsappCommandStatus; replayed: boolean }, context: { requestId: string }) {
    this.log({ metric: "WHATSAPP_RSVP_SEND", requestId: context.requestId, commandId: input.commandId, invitationCode: input.invitationCode, templateId: input.templateId, outcome: input.replayed ? "replayed" : "queued" });
    return WhatsappRsvpSendResponseSchema.parse(input);
  }
}
