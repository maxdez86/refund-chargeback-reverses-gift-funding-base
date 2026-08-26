import { randomUUID } from "node:crypto";
import {
  InvitationCodeSchema,
  WhatsappOperatorTextSendResponseSchema,
  WhatsappTextBodySchema,
  type HouseholdInvitation,
  type WhatsappCommandStatus,
  type WhatsappFlowStatus
} from "@brimax/contracts";
import type { WhatsappCommandInput, WhatsappCommandItem } from "../dynamodb/whatsapp-items";
import { AppError } from "../../lib/errors";
import { WhatsappRecipientSchema } from "./schemas";
import { isConditionalTransactionCancellation } from "../dynamodb/transaction-errors";
import { deriveWhatsappFreeTextWindow } from "../../domain/whatsapp-free-text-window";
import { WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID } from "../../domain/whatsapp-text-commands";
import { recordWhatsappCommandEnqueued } from "./command-enqueue";

export type OperatorTextQueueResult = { status: "queued"; enqueuedAt: string; messageId?: string };
export type OperatorTextQueuePublisher = (
  commandId: string,
  context: { requestId: string }
) => Promise<OperatorTextQueueResult>;

export type OperatorTextRepository = {
  getInvitationByCode(code: string): Promise<HouseholdInvitation | null>;
  getWhatsappCommand(commandId: string): Promise<WhatsappCommandItem | undefined>;
  reserveWhatsappCommand(
    input: WhatsappCommandInput,
    expectedStatus: WhatsappFlowStatus | undefined
  ): Promise<void>;
  updateWhatsappCommand(
    commandId: string,
    values: Partial<Omit<WhatsappCommandInput, "commandId">>,
    condition?: { expression: string; names?: Record<string, string>; values?: Record<string, unknown> }
  ): Promise<void>;
};

type Dependencies = {
  repository: OperatorTextRepository;
  publish: OperatorTextQueuePublisher;
  log?: (entry: Record<string, unknown>) => void;
  now?: () => string;
  createCommandId?: () => string;
};

/**
 * Queues an operator-composed free-text WhatsApp message on the existing send outbox.
 *
 * Kept separate from `WhatsappRsvpSendService` because that class is irreducibly template-centric
 * (template lookup, variable validation, flow stage derivation, opener flow transitions). Free
 * text resolves no template and runs with `effect: "preserve"`, which means the reservation never
 * touches the invitation and there is no flow status to compensate on a queue failure — so the
 * shared shape would be mostly branches that never fire.
 */
export class WhatsappOperatorTextService {
  private readonly log: (entry: Record<string, unknown>) => void;
  private readonly now: () => string;
  private readonly createCommandId: () => string;

  constructor(private readonly dependencies: Dependencies) {
    this.log = dependencies.log ?? ((entry) => console.info(JSON.stringify(entry)));
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createCommandId = dependencies.createCommandId ?? randomUUID;
  }

  async queueText(
    invitationCode: string,
    rawBody: string,
    idempotencyKey: string | undefined,
    context: { requestId: string }
  ) {
    InvitationCodeSchema.parse(invitationCode);
    // Trim only. Interior newlines are the operator's formatting and are preserved verbatim.
    const body = WhatsappTextBodySchema.parse(rawBody.trim());

    const existing = idempotencyKey
      ? await this.dependencies.repository.getWhatsappCommand(`idempotency-${idempotencyKey}`)
      : undefined;
    if (existing) {
      this.assertReplayPayload(existing, invitationCode, body);
      return this.replay(existing, context);
    }

    let commandId: string | undefined;
    try {
      const invitation = await this.dependencies.repository.getInvitationByCode(invitationCode);
      if (!invitation) throw new AppError("Invitation not found.", 404, "INVITATION_NOT_FOUND");
      if (!invitation.phoneNumber || !WhatsappRecipientSchema.safeParse(invitation.phoneNumber).success) {
        throw new AppError("Invitation has no valid WhatsApp phone number.", 422, "INVALID_INVITATION_STATE");
      }

      // Pre-check, not a guarantee: the window can lapse between here and the worker's send, in
      // which case Meta's own rejection is classified by the worker's normal failure path.
      const window = deriveWhatsappFreeTextWindow(invitation, new Date(this.now()));
      if (!window.open) {
        throw new AppError(
          "The 24-hour WhatsApp free-text window is closed for this invitation.",
          409,
          "FREE_TEXT_WINDOW_CLOSED"
        );
      }

      commandId = idempotencyKey ? `idempotency-${idempotencyKey}` : this.createCommandId();
      const now = this.now();
      try {
        await this.dependencies.repository.reserveWhatsappCommand({
          commandId,
          invitationCode,
          templateId: WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID,
          body,
          status: "queued",
          // Never advances the RSVP flow, never counts as the opener, and never satisfies the
          // first/resend send-availability gate. Passing no expected status means the reservation
          // transaction contains only the command Put — the invitation is not written at all.
          effect: "preserve",
          createdAt: now
        }, undefined);
      } catch (error) {
        if (!isConditionalTransactionCancellation(error) &&
          (error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
        const reserved = await this.dependencies.repository.getWhatsappCommand(commandId);
        if (!reserved) {
          throw new AppError("The WhatsApp text command could not be reserved.", 409, "INVALID_FLOW_TRANSITION");
        }
        this.assertReplayPayload(reserved, invitationCode, body);
        return this.replay(reserved, context, false);
      }

      const queued = await this.enqueue(commandId, context);
      await recordWhatsappCommandEnqueued(this.dependencies.repository, commandId, queued);
      return this.finish({ commandId, invitationCode, status: queued.status, replayed: false }, context);
    } catch (error) {
      if (commandId && error instanceof AppError && error.statusCode === 503 &&
        ["QUEUE_FAILURE", "QUEUE_UNAVAILABLE"].includes(error.code ?? "")) {
        // Only the command is compensated. `effect: "preserve"` must never write a failed flow
        // status onto the invitation — the RSVP journey is not this command's to move.
        await this.dependencies.repository.updateWhatsappCommand(commandId, {
          status: "failed",
          failureReason: error.message,
          updatedAt: this.now()
        }, {
          expression: "#c0 = :c0", names: { "#c0": "status" }, values: { ":c0": "queued" }
        }).catch(() => undefined);
      }
      this.log({
        metric: "WHATSAPP_OPERATOR_TEXT_SEND",
        requestId: context.requestId,
        commandId,
        invitationCode,
        outcome: "failure",
        errorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR"
      });
      throw error;
    }
  }

  private async enqueue(commandId: string, context: { requestId: string }) {
    try {
      return await this.dependencies.publish(commandId, context);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 503) throw error;
      throw new AppError("Unable to enqueue WhatsApp text command.", 503, "QUEUE_FAILURE");
    }
  }

  private assertReplayPayload(existing: WhatsappCommandItem, invitationCode: string, body: string) {
    if (existing.invitationCode !== invitationCode ||
      existing.templateId !== WHATSAPP_OPERATOR_TEXT_TEMPLATE_ID ||
      existing.body !== body) {
      throw new AppError(
        "The provided idempotency key was already used with a different payload.",
        409,
        "IDEMPOTENCY_CONFLICT"
      );
    }
  }

  private async replay(
    existing: WhatsappCommandItem,
    context: { requestId: string },
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
        status,
        replayed: true
      }, context);
    } catch (error) {
      if (!handleQueueFailure || !(error instanceof AppError) || error.statusCode !== 503) throw error;
      await this.dependencies.repository.updateWhatsappCommand(existing.commandId, {
        status: "failed",
        failureReason: error.message,
        updatedAt: this.now()
      }, {
        expression: "#c0 = :c0", names: { "#c0": "status" }, values: { ":c0": existing.status }
      }).catch(() => undefined);
      this.log({
        metric: "WHATSAPP_OPERATOR_TEXT_SEND",
        requestId: context.requestId,
        commandId: existing.commandId,
        invitationCode: existing.invitationCode,
        outcome: "failure",
        errorCode: error.code
      });
      throw error;
    }
  }

  /** The body is deliberately absent from every log line — message content never leaves the table. */
  private finish(
    input: { commandId: string; invitationCode: string; status: WhatsappCommandStatus; replayed: boolean },
    context: { requestId: string }
  ) {
    this.log({
      metric: "WHATSAPP_OPERATOR_TEXT_SEND",
      requestId: context.requestId,
      commandId: input.commandId,
      invitationCode: input.invitationCode,
      outcome: input.replayed ? "replayed" : "queued"
    });
    return WhatsappOperatorTextSendResponseSchema.parse(input);
  }
}
