import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import { parseWhatsappWebhook } from "../apps/api/src/services/whatsapp/webhook-parser.ts";
import { invitationKeys, webhookKeys, whatsappCommandKeys, whatsappMessageKeys } from "../apps/api/src/services/dynamodb/key-builder.ts";
import { buildWhatsappStatusWebhookPayload, buildWhatsappTextWebhookPayload, buildWhatsappWebhookPayload, serializeWhatsappWebhookPayload, whatsappWebhookSignature } from "./lib/whatsapp-webhook-simulator.ts";
import { createDocumentClient, requiredEnv, resolveApiBaseUrl, resolveStage, resolveWeddingTableName, resolveWhatsappIntegrationInvitationCode } from "./lib/prod-promotion-support.ts";

const PHONE = "5511900000000";
const TIMEOUT_MS = Number.parseInt(process.env.PROD_PROMOTION_WEBHOOK_TIMEOUT_MS ?? "90000", 10);
const POLL_MS = Number.parseInt(process.env.PROD_PROMOTION_WEBHOOK_POLL_INTERVAL_MS ?? "2000", 10);

type Result = { name: string; details: Record<string, unknown> };
const exchangeLog: Array<Record<string, unknown>> = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function invitationCode() {
  return resolveWhatsappIntegrationInvitationCode();
}

function outboundId(code: string, suffix: string) {
  return `wamid.synthetic-${suffix}-${code}`;
}

function eventIdFor(payload: unknown) {
  const parsed = parseWhatsappWebhook(payload);
  assert(parsed.outcome === "accepted" && parsed.events.length === 1, "Expected one parser-valid WhatsApp event.");
  return parsed.events[0].eventId;
}

async function getItem(client: ReturnType<typeof createDocumentClient>, table: string, key: Record<string, string>) {
  const result = await client.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }));
  return result.Item as Record<string, unknown> | undefined;
}

async function poll<T>(read: () => Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function pollProcessedMarker(client: ReturnType<typeof createDocumentClient>, table: string, eventId: string, label = "webhook marker") {
  return poll(async () => {
    const item = await getItem(client, table, webhookKeys("whatsapp", eventId));
    return item?.processingStatus === "processed" ? item : undefined;
  }, `${label} (${eventId}) to reach processed status`);
}

async function pollInboundMessage(client: ReturnType<typeof createDocumentClient>, table: string, messageId: string, correlationStatus: string, label = "inbound message") {
  return poll(async () => {
    const item = await getItem(client, table, whatsappMessageKeys(messageId));
    return item?.correlationStatus === correlationStatus ? item : undefined;
  }, `${label} (${messageId}) to be stored with correlationStatus=${correlationStatus}`);
}

async function pollMessageStatus(client: ReturnType<typeof createDocumentClient>, table: string, messageId: string, expectedStatus: string, label = "message status") {
  return poll(async () => {
    const item = await getItem(client, table, whatsappMessageKeys(messageId));
    return item?.status === expectedStatus ? item : undefined;
  }, `${label} (${messageId}) to reach status=${expectedStatus}`);
}

async function postWebhook(api: string, secret: string, payload: unknown, signatureSecret = secret) {
  const raw = serializeWhatsappWebhookPayload(payload);
  const response = await fetch(`${api}/webhooks/whatsapp`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": whatsappWebhookSignature(raw, signatureSecret) },
    body: raw
  });
  const body = await response.text();
  exchangeLog.push({ phase: "whatsapp-webhook", method: "POST", url: `${api}/webhooks/whatsapp`, status: response.status });
  return { status: response.status, body };
}

async function seedOutbound(client: ReturnType<typeof createDocumentClient>, table: string, code: string, messageId: string) {
  const createdAt = new Date().toISOString();
  await client.send(new PutCommand({
    TableName: table,
    Item: {
      ...whatsappMessageKeys(messageId),
      GSI1PK: `INVITATION#${code}`,
      GSI1SK: `WHATSAPP#${createdAt}#MESSAGE#${messageId}`,
      entityType: "WhatsappMessage",
      messageId,
      invitationCode: code,
      direction: "outbound",
      messageType: "template",
      correlationStatus: "matched",
      status: "sent",
      createdAt,
      persistedAt: createdAt,
      timestampSource: "processing",
      templateId: "wedding_rsvp_reconfirmation",
      stage: "reconfirmation",
      recipientPhone: PHONE
    }
  }));
  return createdAt;
}

async function cleanup(client: ReturnType<typeof createDocumentClient>, table: string, eventIds: string[], messageIds: string[]) {
  for (const eventId of eventIds) await client.send(new DeleteCommand({ TableName: table, Key: webhookKeys("whatsapp", eventId) }));
  for (const eventId of eventIds) {
    const commandId = `branch-${createHash("sha256").update(eventId).digest("hex")}`;
    await client.send(new DeleteCommand({ TableName: table, Key: whatsappCommandKeys(commandId) }));
  }
  for (const messageId of messageIds) await client.send(new DeleteCommand({ TableName: table, Key: whatsappMessageKeys(messageId) }));
  const partition = await client.send(new QueryCommand({
    TableName: table,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": invitationKeys(invitationCode()).PK },
    ProjectionExpression: "PK, SK"
  }));
  for (const item of partition.Items ?? []) {
    if (typeof item.PK === "string" && typeof item.SK === "string") {
      await client.send(new DeleteCommand({ TableName: table, Key: { PK: item.PK, SK: item.SK } }));
    }
  }
}

async function main() {
  const api = resolveApiBaseUrl();
  const secret = requiredEnv("WHATSAPP_APP_SECRET");
  const table = await resolveWeddingTableName();
  const client = createDocumentClient();
  const code = invitationCode();
  const eventIds: string[] = [];
  const messageIds: string[] = [outboundId(code, "outbound")];
  const results: Result[] = [];
  const marker = process.env.PROD_PROMOTION_WHATSAPP_RUN_MARKER?.trim() || `local-${Date.now()}`;
  const artifactDir = process.env.PROD_PROMOTION_WHATSAPP_ARTIFACT_DIR?.trim();

  try {
    const invalidPayload = buildWhatsappWebhookPayload("fallback", code);
    const invalidEventId = eventIdFor(invalidPayload);
    const invalid = await postWebhook(api, secret, invalidPayload, "wrong-secret");
    assert(invalid.status === 403, `invalid-signature expected 403, received ${invalid.status}`);
    assert(!(await getItem(client, table, webhookKeys("whatsapp", invalidEventId))), "Invalid signature created a webhook marker.");
    results.push({ name: "invalid-signature", details: { status: invalid.status } });

    const unknownText = buildWhatsappTextWebhookPayload(`wamid.synthetic-text-${code}`);
    const unknownTextEventId = eventIdFor(unknownText);
    const unknownTextMessageId = `wamid.synthetic-text-${code}`;
    messageIds.push(unknownTextMessageId);
    eventIds.push(unknownTextEventId);
    const accepted = await postWebhook(api, secret, unknownText);
    assert(accepted.status === 200, `unknown-sender expected 200, received ${accepted.status}`);
    const markerItem = await pollProcessedMarker(client, table, unknownTextEventId, "unknown-sender webhook marker");
    const inbound = await pollInboundMessage(client, table, unknownTextMessageId, "unmatched_sender", "unknown-sender message");
    results.push({ name: "unknown-sender-text", details: { status: accepted.status, processingStatus: markerItem.processingStatus, correlationStatus: inbound.correlationStatus } });

    const duplicateMessageId = `wamid.synthetic-duplicate-${code}`;
    const duplicate = buildWhatsappTextWebhookPayload(duplicateMessageId, "5511999997777", true);
    const duplicateParsed = parseWhatsappWebhook(duplicate);
    assert(duplicateParsed.outcome === "accepted", "Duplicate simulator payload was not accepted by parser.");
    const duplicateEventId = duplicateParsed.events[0].eventId;
    messageIds.push(duplicateMessageId);
    eventIds.push(duplicateEventId);
    const duplicateResponse = await postWebhook(api, secret, duplicate);
    assert(duplicateResponse.status === 200, `duplicate expected 200, received ${duplicateResponse.status}`);
    const duplicateMarker = await pollProcessedMarker(client, table, duplicateEventId, "duplicate webhook marker");
    const duplicateMessage = await pollInboundMessage(client, table, duplicateMessageId, "unmatched_sender", "duplicate inbound message");
    results.push({ name: "duplicate-delivery", details: { status: duplicateResponse.status, duplicateEvents: duplicateParsed.duplicateEventIds.length, processingStatus: duplicateMarker.processingStatus, correlationStatus: duplicateMessage.correlationStatus } });

    const statusMessageId = outboundId(code, "status");
    messageIds.push(statusMessageId);
    await seedOutbound(client, table, code, statusMessageId);
    const statusPayload = buildWhatsappStatusWebhookPayload("delivered", statusMessageId);
    const statusEventId = eventIdFor(statusPayload);
    eventIds.push(statusEventId);
    const statusResponse = await postWebhook(api, secret, statusPayload);
    assert(statusResponse.status === 200, `status expected 200, received ${statusResponse.status}`);
    const statusMarker = await pollProcessedMarker(client, table, statusEventId, "status webhook marker");
    const statusMessage = await pollMessageStatus(client, table, statusMessageId, "delivered", "status message");
    results.push({ name: "status-webhook", details: { status: statusResponse.status, messageStatus: statusMessage.status, processingStatus: statusMarker.processingStatus } });

    const unknownInvitation = "ZZ2345";
    const unknownOutboundMessageId = outboundId(unknownInvitation, "outbound");
    messageIds.push(unknownOutboundMessageId);
    await seedOutbound(client, table, unknownInvitation, unknownOutboundMessageId);
    const unknownPayload = buildWhatsappWebhookPayload("b2", unknownInvitation);
    const unknownEventId = eventIdFor(unknownPayload);
    eventIds.push(unknownEventId);
    const unknownResponse = await postWebhook(api, secret, unknownPayload);
    assert(unknownResponse.status === 200, `unknown invitation expected 200, received ${unknownResponse.status}`);
    const unknownMarker = await pollProcessedMarker(client, table, unknownEventId, "unknown-invitation marker");
    const unknownInboundId = `wamid.synthetic-b2-${unknownInvitation}`;
    messageIds.push(unknownInboundId);
    const unknownInbound = await pollInboundMessage(client, table, unknownInboundId, "unknown_invitation", "unknown-invitation message");
    results.push({ name: "unknown-invitation", details: { status: unknownResponse.status, correlationStatus: unknownInbound.correlationStatus, processingStatus: unknownMarker.processingStatus } });

    const currentInvitation = await getItem(client, table, invitationKeys(code));
    if (currentInvitation) {
      await client.send(new PutCommand({
        TableName: table,
        Item: {
          ...currentInvitation,
          whatsappFlowStatus: "completed",
          whatsappFlowStage: "reconfirmation",
          whatsappFlowUpdatedAt: new Date().toISOString()
        }
      }));
    }
    const terminalOutboundMessageId = outboundId(code, "outbound");
    messageIds.push(terminalOutboundMessageId);
    await seedOutbound(client, table, code, terminalOutboundMessageId);
    const terminalPayload = buildWhatsappWebhookPayload("b2", code);
    const terminalInboundId = `wamid.synthetic-b2-${code}`;
    messageIds.push(terminalInboundId);
    const terminalEventId = eventIdFor(terminalPayload);
    eventIds.push(terminalEventId);
    const terminalResponse = await postWebhook(api, secret, terminalPayload);
    assert(terminalResponse.status === 200, `terminal reply expected 200, received ${terminalResponse.status}`);
    const terminalMarker = await pollProcessedMarker(client, table, terminalEventId, "terminal reply marker");
    results.push({ name: "terminal-button-reply", details: { status: terminalResponse.status, rejectionReason: terminalMarker.rejectionReason, processingStatus: terminalMarker.processingStatus } });

    if (artifactDir) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { resolve } = await import("node:path");
      const directory = resolve(artifactDir);
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "summary.json"), JSON.stringify({ ok: true, stage: resolveStage(), apiBaseUrl: api, invitationCode: code, runMarker: marker, results }, null, 2));
      await writeFile(resolve(directory, "http-log.jsonl"), exchangeLog.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    }
  } finally {
    await cleanup(client, table, eventIds, messageIds);
  }
}

main().catch(async (error) => {
  const directory = process.env.PROD_PROMOTION_WHATSAPP_ARTIFACT_DIR?.trim();
  if (directory) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    await mkdir(resolve(directory), { recursive: true });
    await writeFile(resolve(directory, "summary.json"), JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    await writeFile(resolve(directory, "http-log.jsonl"), exchangeLog.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
