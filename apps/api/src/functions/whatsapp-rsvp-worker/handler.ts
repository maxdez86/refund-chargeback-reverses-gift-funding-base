import type { SQSRecord, SQSEvent } from "aws-lambda";
import type { WhatsappFlowStatus } from "@brimax/contracts";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { z } from "zod";
import { deriveTemplateParameters } from "../../domain/whatsapp-template-variables";
import { WHATSAPP_FALLBACK_TEMPLATE_ID, WHATSAPP_FALLBACK_TEXT } from "../../domain/whatsapp-rsvp-service";
import { classifyWhatsappSendError } from "../../domain/whatsapp-send-outcome";
import { transitionCondition } from "../../domain/whatsapp-flow-state";
import { AppError } from "../../lib/errors";
import { wrapLambdaHandler } from "../../lib/sentry";
import {
  WeddingRepository,
  WHATSAPP_QUEUE_VISIBILITY_TIMEOUT_MS,
  WHATSAPP_RECLAIM_MARGIN_MS,
  WHATSAPP_WORKER_MAX_ATTEMPTS
} from "../../services/dynamodb/repositories/wedding-repository";
import { WhatsappTemplateRepository } from "../../services/whatsapp/template-repository";
import { WhatsappTemplateMessageService } from "../../services/whatsapp/template-message-service";
import { WhatsappCloudApiClient } from "../../services/whatsapp/client";

const WhatsappWorkerMessageSchema = z.object({ commandId: z.string().min(1).max(512) }).strict();
const MAX_RECEIVE_COUNT = 10_000;

type WorkerRepository = Pick<WeddingRepository, "getWhatsappCommand" | "getInvitationByCode" | "claimWhatsappCommand" | "updateWhatsappCommand" | "updateWhatsappFlow" | "finalizeAcceptedWhatsappSend">;
type WorkerTemplates = Pick<WhatsappTemplateRepository, "getVersion">;
type WorkerSender = Pick<WhatsappTemplateMessageService, "send">;
type TextSender = Pick<WhatsappCloudApiClient, "sendText">;

export type WhatsappRsvpWorkerDependencies = {
  repository: WorkerRepository;
  templates: WorkerTemplates;
  sender: WorkerSender;
  textSender?: TextSender;
  now?: () => string;
  log?: (entry: Record<string, unknown>) => void;
};

function defaultDependencies(): WhatsappRsvpWorkerDependencies {
  return {
    repository: new WeddingRepository(),
    templates: new WhatsappTemplateRepository(),
    sender: new WhatsappTemplateMessageService(),
    textSender: new WhatsappCloudApiClient()
  };
}

function receiveCount(record: SQSRecord) {
  const value = Number(record.attributes?.ApproximateReceiveCount ?? 1);
  return Number.isInteger(value) && value > 0 && value <= MAX_RECEIVE_COUNT ? value : 1;
}

function conditionForSending() {
  return { expression: "#c0 = :c0", names: { "#c0": "status" }, values: { ":c0": "sending" } };
}

function conditionForStaleBudget(reclaimBefore: string) {
  return {
    expression: "#c0 = :c0 AND #c1 < :c1 AND #c2 >= :c2",
    names: { "#c0": "status", "#c1": "startedAt", "#c2": "retryCount" },
    values: { ":c0": "sending", ":c1": reclaimBefore, ":c2": WHATSAPP_WORKER_MAX_ATTEMPTS }
  };
}

function stale(startedAt: string | undefined, threshold: string) {
  return typeof startedAt === "string" && startedAt < threshold;
}

async function reconcile(
  repository: WorkerRepository,
  invitationCode: string,
  commandId: string,
  reason: string,
  now: string,
  log: (entry: Record<string, unknown>) => void,
  condition = conditionForSending(),
  effect: "opener" | "preserve" | "complete_on_send" = "opener",
  expectedFlowStatus?: WhatsappFlowStatus
) {
  try {
    await repository.updateWhatsappCommand(commandId, {
      status: "reconciliation_required", reconciliationStatus: "required", failureReason: reason, updatedAt: now
    }, condition);
    if (effect !== "preserve" && expectedFlowStatus) {
      await repository.updateWhatsappFlow(invitationCode, {
        whatsappFlowStatus: "reconciliation_required", whatsappFailureReason: reason, whatsappFlowUpdatedAt: now
      }, transitionCondition(expectedFlowStatus));
    }
    log({ metric: "WHATSAPP_RSVP_WORKER_RECONCILIATION_REQUIRED", commandId, invitationCode, outcome: "reconciliation_required" });
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

async function failPermanently(
  repository: WorkerRepository,
  invitationCode: string,
  commandId: string,
  reason: string,
  category: string | undefined,
  providerCode: number | undefined,
  now: string,
  effect: "opener" | "preserve" | "complete_on_send" = "opener",
  expectedFlowStatus?: WhatsappFlowStatus
) {
  await repository.updateWhatsappCommand(commandId, {
    status: "failed", reconciliationStatus: "none", failureReason: reason,
    providerErrorCategory: category, providerErrorCode: providerCode, updatedAt: now
  }, conditionForSending());
  if (effect !== "preserve" && expectedFlowStatus) {
    await repository.updateWhatsappFlow(invitationCode, {
      whatsappFlowStatus: "failed", whatsappFailureReason: reason, whatsappFlowUpdatedAt: now
    }, transitionCondition(expectedFlowStatus));
  }
}

async function processRecord(record: SQSRecord, dependencies: WhatsappRsvpWorkerDependencies): Promise<boolean> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const log = dependencies.log ?? ((entry) => console.info(JSON.stringify(entry)));
  let commandId: string;
  try {
    commandId = WhatsappWorkerMessageSchema.parse(JSON.parse(record.body)).commandId;
  } catch (error) {
    log({ metric: "WHATSAPP_RSVP_WORKER_MESSAGE_INVALID", messageId: record.messageId, outcome: "permanent", error: error instanceof Error ? error.message : String(error) });
    return false;
  }

  const command = await dependencies.repository.getWhatsappCommand(commandId);
  if (!command || ["sent", "failed", "reconciliation_required"].includes(command.status)) {
    log({ metric: "WHATSAPP_RSVP_WORKER_SKIPPED", commandId, outcome: "skipped" });
    return false;
  }
  const legacyCommand = command as typeof command & { preserveFlowStatus?: boolean };
  const effect = command.effect ?? (legacyCommand.preserveFlowStatus === true ? "preserve" : "opener");
  // Opener commands record their owned starting state. Once claimed, the
  // worker transitions that state to `sending`; all provider failure and
  // finalization paths therefore use `sending` as their owned status.
  const expectedFlowStatus = effect === "opener"
    ? "sending"
    : command.expectedFlowStatus;

  const attemptAt = now();
  // A redelivered message is normally visible again at the queue visibility
  // timeout. The margin makes the reclaim threshold slightly earlier than
  // that boundary so scheduling jitter cannot acknowledge a stale message
  // without reclaiming it.
  const reclaimBefore = new Date(Date.parse(attemptAt) - WHATSAPP_QUEUE_VISIBILITY_TIMEOUT_MS + WHATSAPP_RECLAIM_MARGIN_MS).toISOString();
  const currentReceiveCount = receiveCount(record);
  const claimed = await dependencies.repository.claimWhatsappCommand(commandId, { now: attemptAt, receiveCount: currentReceiveCount, reclaimBefore });

  if (!claimed) {
    if (command.status === "sending" && command.retryCount >= WHATSAPP_WORKER_MAX_ATTEMPTS && stale(command.startedAt, reclaimBefore)) {
      const staleInvitation = await dependencies.repository.getInvitationByCode(String(command.invitationCode));
      if (staleInvitation) {
        await reconcile(dependencies.repository, staleInvitation.invitationCode, commandId, "WhatsApp worker retry budget exhausted while command was sending.", attemptAt, log, conditionForStaleBudget(reclaimBefore));
      } else {
        log({ metric: "WHATSAPP_RSVP_WORKER_RECONCILIATION_REQUIRED", commandId, invitationCode: command.invitationCode, outcome: "reconciliation_required" });
      }
    }
    return false;
  }

  let invitation;
  try {
    invitation = await dependencies.repository.getInvitationByCode(String(command.invitationCode));
  } catch (error) {
    if (error instanceof AppError && error.statusCode >= 500) {
      await dependencies.repository.updateWhatsappCommand(commandId, {
        status: "failed", reconciliationStatus: "none",
        failureReason: error.message, updatedAt: attemptAt
      }, conditionForSending());
      log({ metric: "WHATSAPP_RSVP_WORKER_OUTCOME", commandId, outcome: "failed", category: "stored_record_invalid" });
      return false;
    }
    throw error;
  }

  if (!invitation) {
    await failPermanently(dependencies.repository, String(command.invitationCode), commandId, "WhatsApp command invitation no longer exists.", undefined, undefined, attemptAt, effect, expectedFlowStatus);
    return false;
  }

  let definition;
  try {
    definition = command.templateId === WHATSAPP_FALLBACK_TEMPLATE_ID
      ? undefined
      : await dependencies.templates.getVersion(String(command.templateId), Number(command.templateVersion));
  } catch (error) {
    if (error instanceof AppError && error.statusCode >= 500) {
      await failPermanently(dependencies.repository, invitation.invitationCode, commandId, error.message, "invalid_request", undefined, attemptAt, effect, expectedFlowStatus);
      log({ metric: "WHATSAPP_RSVP_WORKER_OUTCOME", commandId, invitationCode: invitation.invitationCode, templateId: command.templateId, outcome: "failed", category: "stored_template_invalid" });
      return false;
    }
    throw error;
  }

  if (effect === "opener") {
    const openerExpectedStatus = "send_queued";
    const openerClaimable = invitation.whatsappFlowStatus === openerExpectedStatus ||
      invitation.whatsappFlowStatus === "sending";
    if (!openerClaimable) {
      await reconcile(
        dependencies.repository,
        invitation.invitationCode,
        commandId,
        "WhatsApp opener command no longer owns an opener-eligible flow.",
        attemptAt,
        log,
        undefined,
        "preserve"
      );
      return false;
    }
    try {
      await dependencies.repository.updateWhatsappFlow(invitation.invitationCode, {
        whatsappFlowStatus: "sending", whatsappFlowUpdatedAt: attemptAt
      }, transitionCondition(invitation.whatsappFlowStatus));
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        await reconcile(dependencies.repository, invitation.invitationCode, commandId, "WhatsApp flow changed while the worker claimed the command.", attemptAt, log, undefined, effect, expectedFlowStatus);
        return false;
      }
      throw error;
    }
  }
  if (effect === "complete_on_send" && invitation.whatsappFlowStatus !== expectedFlowStatus) {
    await reconcile(
      dependencies.repository,
      invitation.invitationCode,
      commandId,
      "WhatsApp flow no longer matches the command's expected intermediate status.",
      attemptAt,
      log,
      undefined,
      "preserve"
    );
    return false;
  }

  const handleFailure = async (error: unknown) => {
    const classification = classifyWhatsappSendError(error);
    const reason = error instanceof Error ? error.message : String(error);
    if (classification.outcome === "retryable") {
      await dependencies.repository.updateWhatsappCommand(commandId, {
        failureReason: reason, providerErrorCategory: classification.category,
        providerErrorCode: classification.providerCode, updatedAt: attemptAt
      }, conditionForSending());
      log({ metric: "WHATSAPP_RSVP_WORKER_OUTCOME", commandId, invitationCode: invitation.invitationCode, templateId: command.templateId, retryCount: command.retryCount + 1, receiveCount: currentReceiveCount, outcome: "retryable", category: classification.category });
      return true;
    }
    if (classification.outcome === "ambiguous") {
      await reconcile(dependencies.repository, invitation.invitationCode, commandId, reason, attemptAt, log, undefined, effect, expectedFlowStatus);
      return false;
    }
    await failPermanently(dependencies.repository, invitation.invitationCode, commandId, reason, classification.category, classification.providerCode, attemptAt, effect, expectedFlowStatus);
    log({ metric: "WHATSAPP_RSVP_WORKER_OUTCOME", commandId, invitationCode: invitation.invitationCode, templateId: command.templateId, retryCount: command.retryCount + 1, receiveCount: currentReceiveCount, outcome: "failed", category: classification.category });
    return false;
  };

  if (!invitation.phoneNumber) return handleFailure(new Error("WhatsApp command invitation has no phone number."));
  if (!definition && command.templateId !== WHATSAPP_FALLBACK_TEMPLATE_ID) return handleFailure(new Error("WhatsApp command template is no longer active."));

  let result: { messageId: string };
  try {
    if (command.templateId === WHATSAPP_FALLBACK_TEMPLATE_ID) {
      if (!dependencies.textSender) throw new Error("WhatsApp text sender is not configured.");
      result = await dependencies.textSender.sendText({ to: invitation.phoneNumber, text: { body: WHATSAPP_FALLBACK_TEXT } }, { requestId: commandId });
    } else {
      const parameters = deriveTemplateParameters(invitation, definition!);
      result = await dependencies.sender.send(
        { purpose: String(command.templateId), to: invitation.phoneNumber, parameters },
        { requestId: commandId },
        definition!
      );
    }
  } catch (error) {
    return handleFailure(error);
  }

  try {
    const finalization = await dependencies.repository.finalizeAcceptedWhatsappSend({
      commandId,
      invitationCode: invitation.invitationCode,
      effect,
      expectedFlowStatus,
      now: attemptAt,
      fallback: command.templateId === WHATSAPP_FALLBACK_TEMPLATE_ID,
      message: {
      messageId: result.messageId, invitationCode: invitation.invitationCode, direction: "outbound", status: "sent",
      commandId, templateId: command.templateId, templateVersion: command.templateVersion, stage: command.stage, body: command.templateId === WHATSAPP_FALLBACK_TEMPLATE_ID ? WHATSAPP_FALLBACK_TEXT : undefined, createdAt: attemptAt
      }
    });
    if (finalization.outcome === "reconciliation_required") {
      await reconcile(
        dependencies.repository,
        invitation.invitationCode,
        commandId,
        finalization.reason,
        attemptAt,
        log,
        undefined,
        effect,
        expectedFlowStatus
      );
      log({ metric: "WHATSAPP_RSVP_WORKER_FINALIZATION_AMBIGUOUS", commandId, invitationCode: invitation.invitationCode, templateId: command.templateId, effect, outcome: "reconciliation_required" });
      return false;
    }
    log({ metric: "WHATSAPP_RSVP_WORKER_OUTCOME", commandId, invitationCode: invitation.invitationCode, templateId: command.templateId, effect, wamid: result.messageId, retryCount: command.retryCount + 1, receiveCount: currentReceiveCount, outcome: finalization.outcome === "replayed" ? "finalization_replayed" : "sent" });
    return false;
  } catch (error) {
    await reconcile(
      dependencies.repository,
      invitation.invitationCode,
      commandId,
      `WhatsApp provider accepted the message but local persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      attemptAt,
      log,
      undefined,
      effect,
      expectedFlowStatus
    );
    return false;
  }
}

export function createWhatsappRsvpWorker(dependencies: WhatsappRsvpWorkerDependencies) {
  return async (event: SQSEvent) => {
    const batchItemFailures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      if (await processRecord(record, dependencies)) batchItemFailures.push({ itemIdentifier: record.messageId });
    }
    return { batchItemFailures };
  };
}

export const handler = wrapLambdaHandler(async (event: SQSEvent) =>
  createWhatsappRsvpWorker(defaultDependencies())(event)
);
