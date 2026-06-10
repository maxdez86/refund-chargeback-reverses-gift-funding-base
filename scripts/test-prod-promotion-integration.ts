import { mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { GetGiftsResponseSchema } from "../packages/contracts/src/gifts.ts";
import { type GuestSummary } from "../packages/contracts/src/guest.ts";
import {
  CreateGuestMessageResponseSchema,
  DeleteGuestMessageResponseSchema,
  ListGuestMessagesResponseSchema
} from "../packages/contracts/src/messages.ts";
import {
  CreatePaymentMessageResponseSchema,
  CreatePaymentResponseSchema,
  GetPaymentResponseSchema
} from "../packages/contracts/src/payments.ts";
import {
  InvitationLookupResponseSchema,
  RsvpSubmissionResponseSchema
} from "../packages/contracts/src/rsvp.ts";
import {
  createDocumentClient,
  fetchStoredPayment,
  PROD_PROMOTION_PAYMENT_METHOD,
  PROD_PROMOTION_TURNSTILE_DUMMY_TOKEN,
  requiredEnv,
  resolveApiBaseUrl,
  resolveIntegrationGift,
  resolveIntegrationGiftQuantity,
  resolveIntegrationInvitationCode,
  resolveStage,
  resolveWeddingTableName
} from "./lib/prod-promotion-support.ts";

type RequestLog = {
  phase: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    body: unknown;
  };
};

type PhaseResult = {
  name: string;
  startedAt: string;
  completedAt: string;
  details: Record<string, unknown>;
};

type Context = {
  apiBaseUrl: string;
  artifactDir: string;
  asaasWebhookToken: string;
  giftId: string;
  giftQuantity: number;
  invitationCode: string;
  logFile: string;
  runMarker: string;
  stage: string;
  turnstileToken: string;
  webhookTimeoutMs: number;
  webhookPollIntervalMs: number;
};

type RuntimeState = {
  createdGuestMessageId?: string;
  createdPaymentId?: string;
  initialGiftPartsFunded?: number;
  lookupProof?: string;
  invitationGuests?: GuestSummary[];
};

function nowIso() {
  return new Date().toISOString();
}

function redactHeaders(headers: HeadersInit | undefined) {
  const result: Record<string, string> = {};
  if (!headers || Array.isArray(headers)) {
    return result;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (
      key.toLowerCase() === "asaas-access-token" ||
      key.toLowerCase() === "x-turnstile-token" ||
      key.toLowerCase() === "x-rsvp-lookup-proof"
    ) {
      result[key] = "[redacted]";
      continue;
    }

    result[key] = value;
  }

  return result;
}

async function safeJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function logExchange(context: Context, entry: RequestLog) {
  await appendFile(context.logFile, `${JSON.stringify(entry)}\n`, "utf8");
}

async function requestJson(
  context: Context,
  phase: string,
  url: string,
  init: RequestInit = {}
) {
  const response = await fetch(url, init);
  const body = await safeJson(response);

  await logExchange(context, {
    phase,
    request: {
      method: init.method ?? "GET",
      url,
      headers: redactHeaders(init.headers),
      body: init.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined
    },
    response: {
      status: response.status,
      body
    }
  });

  return {
    body,
    response
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(actual: number, expected: number, phase: string, body: unknown) {
  if (actual !== expected) {
    throw new Error(`${phase} expected HTTP ${expected}, received ${actual}: ${JSON.stringify(body)}`);
  }
}

function parseWithSchema<T>(
  label: string,
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: { message: string } } },
  input: unknown
) {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  const failed = parsed as { success: false; error: { message: string } };
  throw new Error(`${label} schema validation failed: ${failed.error.message}`);
}

async function appendSummaryLine(line: string) {
  if (!process.env.GITHUB_STEP_SUMMARY) {
    return;
  }

  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${line}\n`, "utf8");
}

async function runPhase(
  phaseName: string,
  results: PhaseResult[],
  fn: () => Promise<Record<string, unknown>>
) {
  const startedAt = nowIso();
  await appendSummaryLine(`- starting \`${phaseName}\``);
  const details = await fn();
  const completedAt = nowIso();
  results.push({
    name: phaseName,
    startedAt,
    completedAt,
    details
  });
  await appendSummaryLine(`- passed \`${phaseName}\``);
}

async function pollForPaymentTerminalState(context: Context, paymentId: string) {
  const deadline = Date.now() + context.webhookTimeoutMs;
  const statuses: string[] = [];

  while (Date.now() < deadline) {
    const { body, response } = await requestJson(
      context,
      "payment-webhook-poll",
      `${context.apiBaseUrl}/payments/${encodeURIComponent(paymentId)}`
    );

    assertStatus(response.status, 200, "payment-webhook-poll", body);
    const parsed = parseWithSchema("payment-webhook-poll", GetPaymentResponseSchema, body);
    statuses.push(parsed.payment.status);

    if (parsed.payment.status === "CONFIRMED" || parsed.payment.status === "RECEIVED") {
      return {
        payment: parsed.payment,
        statuses
      };
    }

    await new Promise((resolve) => setTimeout(resolve, context.webhookPollIntervalMs));
  }

  throw new Error(`Timed out waiting for payment ${paymentId} to reach CONFIRMED or RECEIVED.`);
}

async function main() {
  const startedAt = nowIso();
  const stage = resolveStage();
  const apiBaseUrl = resolveApiBaseUrl();
  const artifactDir = process.env.PROD_PROMOTION_ARTIFACT_DIR?.trim()
    ? path.resolve(process.env.PROD_PROMOTION_ARTIFACT_DIR)
    : path.resolve(".tmp/prod-promotion-validation", `${Date.now()}`);
  const logFile = path.join(artifactDir, "http-log.jsonl");
  const summaryFile = path.join(artifactDir, "summary.json");
  const runMarker = process.env.GITHUB_RUN_ID?.trim()
    ? `gha-${process.env.GITHUB_RUN_ID}`
    : `local-${Date.now()}`;
  const context: Context = {
    apiBaseUrl,
    artifactDir,
    asaasWebhookToken: requiredEnv("ASAAS_WEBHOOK_TOKEN"),
    giftId: resolveIntegrationGift().id,
    giftQuantity: resolveIntegrationGiftQuantity(),
    invitationCode: resolveIntegrationInvitationCode(),
    logFile,
    runMarker,
    stage,
    turnstileToken: process.env.TURNSTILE_DUMMY_TOKEN?.trim() || PROD_PROMOTION_TURNSTILE_DUMMY_TOKEN,
    webhookTimeoutMs: Number.parseInt(process.env.PROD_PROMOTION_WEBHOOK_TIMEOUT_MS ?? "90000", 10),
    webhookPollIntervalMs: Number.parseInt(process.env.PROD_PROMOTION_WEBHOOK_POLL_INTERVAL_MS ?? "5000", 10)
  };
  const state: RuntimeState = {};
  const results: PhaseResult[] = [];

  await mkdir(context.artifactDir, { recursive: true });
  await writeFile(context.logFile, "", "utf8");
  await appendSummaryLine("## Prod promotion integration");
  await appendSummaryLine("");
  await appendSummaryLine(`- stage: ${context.stage}`);
  await appendSummaryLine(`- api: ${context.apiBaseUrl}`);
  await appendSummaryLine(`- invitation: ${context.invitationCode}`);
  await appendSummaryLine(`- gift: ${context.giftId}`);
  await appendSummaryLine(`- run marker: ${context.runMarker}`);

  await runPhase("environment-health", results, async () => {
    const { body: giftsBody, response: giftsResponse } = await requestJson(
      context,
      "environment-health",
      `${context.apiBaseUrl}/gifts`
    );
    assertStatus(giftsResponse.status, 200, "environment-health gifts", giftsBody);
    const gifts = parseWithSchema("environment-health gifts", GetGiftsResponseSchema, giftsBody);
    const selectedGift = gifts.gifts.find((gift) => gift.id === context.giftId);
    assert(selectedGift, `Expected gift ${context.giftId} to exist in dev.`);
    state.initialGiftPartsFunded = selectedGift.partsFunded;

    const { body: messagesBody, response: messagesResponse } = await requestJson(
      context,
      "environment-health",
      `${context.apiBaseUrl}/guest-messages`
    );
    assertStatus(messagesResponse.status, 200, "environment-health guest-messages", messagesBody);
    const messages = parseWithSchema(
      "environment-health guest-messages",
      ListGuestMessagesResponseSchema,
      messagesBody
    );

    return {
      giftId: selectedGift.id,
      initialGiftPartsFunded: selectedGift.partsFunded,
      guestMessagesCount: messages.messages.length
    };
  });

  await runPhase("invitation-lookup", results, async () => {
    const { body, response } = await requestJson(
      context,
      "invitation-lookup",
      `${context.apiBaseUrl}/invitation/${encodeURIComponent(context.invitationCode)}`,
      {
        headers: {
          "x-turnstile-token": context.turnstileToken
        }
      }
    );
    assertStatus(response.status, 200, "invitation-lookup", body);
    const parsed = parseWithSchema("invitation-lookup", InvitationLookupResponseSchema, body);
    assert(parsed.invitation.invitationCode === context.invitationCode, "Invitation code mismatch.");
    assert(parsed.lookupProof.length > 10, "Lookup proof was not returned.");
    state.lookupProof = parsed.lookupProof;
    state.invitationGuests = parsed.invitation.guests;

    return {
      householdName: parsed.invitation.householdName,
      guestCount: parsed.invitation.guests.length
    };
  });

  await runPhase("rsvp-submit", results, async () => {
    assert(state.lookupProof, "Lookup proof is required before RSVP submission.");
    assert(state.invitationGuests && state.invitationGuests.length > 0, "Invitation guests are required.");

    const guestResponses = state.invitationGuests.map((guest, index) => ({
      guestId: guest.guestId,
      status: index === 0 ? "attending" : "declined",
      isChildSixOrYounger: Boolean(guest.isChildSixOrYounger)
    }));
    const requestBody = {
      invitationCode: context.invitationCode,
      submittedBy: state.invitationGuests[0].guestName,
      guestResponses,
      attendingGuestCount: 1,
      note: `prod-promotion ${context.runMarker}`
    };

    const { body, response } = await requestJson(context, "rsvp-submit", `${context.apiBaseUrl}/rsvp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `prod-promotion-rsvp-${context.runMarker}`,
        "x-rsvp-lookup-proof": state.lookupProof
      },
      body: JSON.stringify(requestBody)
    });
    assertStatus(response.status, 200, "rsvp-submit", body);
    const parsed = parseWithSchema("rsvp-submit", RsvpSubmissionResponseSchema, body);

    const lookupAfter = await requestJson(
      context,
      "rsvp-submit",
      `${context.apiBaseUrl}/invitation/${encodeURIComponent(context.invitationCode)}`,
      {
        headers: {
          "x-turnstile-token": context.turnstileToken
        }
      }
    );
    assertStatus(lookupAfter.response.status, 200, "rsvp-submit follow-up lookup", lookupAfter.body);
    const parsedLookup = parseWithSchema(
      "rsvp-submit follow-up lookup",
      InvitationLookupResponseSchema,
      lookupAfter.body
    );
    assert(
      parsedLookup.invitation.guests[0]?.rsvpStatus === "attending",
      "Expected first guest RSVP status to be attending after submit."
    );

    return {
      invitationCode: parsed.invitationCode,
      status: parsed.status
    };
  });

  await runPhase("guest-message-create-list", results, async () => {
    const messageBody = `prod-promotion integration ${context.runMarker}`;
    const { body, response } = await requestJson(
      context,
      "guest-message-create-list",
      `${context.apiBaseUrl}/guest-messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-turnstile-token": context.turnstileToken
        },
        body: JSON.stringify({
          authorName: "CI Prod Promotion",
          message: messageBody
        })
      }
    );
    assertStatus(response.status, 200, "guest-message-create-list create", body);
    const created = parseWithSchema(
      "guest-message-create-list create",
      CreateGuestMessageResponseSchema,
      body
    );
    state.createdGuestMessageId = created.message.messageId;

    const listResult = await requestJson(
      context,
      "guest-message-create-list",
      `${context.apiBaseUrl}/guest-messages`
    );
    assertStatus(listResult.response.status, 200, "guest-message-create-list list", listResult.body);
    const list = parseWithSchema(
      "guest-message-create-list list",
      ListGuestMessagesResponseSchema,
      listResult.body
    );
    const matching = list.messages.find((message) => message.messageId === created.message.messageId);
    assert(matching, "Created guest message was not returned by GET /guest-messages.");
    assert(matching.authorName === "CI Prod Promotion", "Guest message author mismatch.");

    return {
      messageId: created.message.messageId
    };
  });

  await runPhase("guest-message-delete", results, async () => {
    assert(state.createdGuestMessageId, "Guest message ID is required before delete.");
    const { body, response } = await requestJson(
      context,
      "guest-message-delete",
      `${context.apiBaseUrl}/admin/guest-messages/${encodeURIComponent(state.createdGuestMessageId)}`,
      {
        method: "DELETE"
      }
    );
    assertStatus(response.status, 200, "guest-message-delete", body);
    const deleted = parseWithSchema("guest-message-delete", DeleteGuestMessageResponseSchema, body);

    const listResult = await requestJson(
      context,
      "guest-message-delete",
      `${context.apiBaseUrl}/guest-messages`
    );
    assertStatus(listResult.response.status, 200, "guest-message-delete list", listResult.body);
    const list = parseWithSchema("guest-message-delete list", ListGuestMessagesResponseSchema, listResult.body);
    assert(
      !list.messages.some((message) => message.messageId === deleted.messageId),
      "Deleted guest message still appears in list."
    );

    return {
      messageId: deleted.messageId
    };
  });

  await runPhase("payment-create-fetch", results, async () => {
    const requestBody = {
      giftId: context.giftId,
      quantity: context.giftQuantity,
      paymentMethod: PROD_PROMOTION_PAYMENT_METHOD
    };
    const idempotencyKey = `prod-promotion-payment-${context.runMarker}`;
    const { body, response } = await requestJson(context, "payment-create-fetch", `${context.apiBaseUrl}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify(requestBody)
    });
    assertStatus(response.status, 201, "payment-create-fetch create", body);
    const created = parseWithSchema("payment-create-fetch create", CreatePaymentResponseSchema, body);
    assert(created.payment.status === "CREATED", "Expected new payment status to be CREATED.");
    state.createdPaymentId = created.payment.paymentId;

    const fetchedResult = await requestJson(
      context,
      "payment-create-fetch",
      `${context.apiBaseUrl}/payments/${encodeURIComponent(created.payment.paymentId)}`
    );
    assertStatus(fetchedResult.response.status, 200, "payment-create-fetch get", fetchedResult.body);
    const fetched = parseWithSchema(
      "payment-create-fetch get",
      GetPaymentResponseSchema,
      fetchedResult.body
    );
    assert(fetched.payment.paymentId === created.payment.paymentId, "Payment ID mismatch between create and get.");
    assert(fetched.payment.gift.id === context.giftId, "Gift mismatch in fetched payment.");

    return {
      paymentId: created.payment.paymentId,
      status: created.payment.status
    };
  });

  await runPhase("payment-idempotency", results, async () => {
    const sameKey = `prod-promotion-idempotency-${context.runMarker}`;
    const sameBody = {
      giftId: context.giftId,
      quantity: context.giftQuantity,
      paymentMethod: PROD_PROMOTION_PAYMENT_METHOD
    };

    const first = await requestJson(context, "payment-idempotency", `${context.apiBaseUrl}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": sameKey
      },
      body: JSON.stringify(sameBody)
    });
    const second = await requestJson(context, "payment-idempotency", `${context.apiBaseUrl}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": sameKey
      },
      body: JSON.stringify(sameBody)
    });
    assertStatus(first.response.status, 201, "payment-idempotency first", first.body);
    assertStatus(second.response.status, 201, "payment-idempotency second", second.body);
    const firstParsed = parseWithSchema("payment-idempotency first", CreatePaymentResponseSchema, first.body);
    const secondParsed = parseWithSchema("payment-idempotency second", CreatePaymentResponseSchema, second.body);
    assert(
      firstParsed.payment.paymentId === secondParsed.payment.paymentId,
      "Idempotent replay did not return the same payment."
    );

    const conflict = await requestJson(context, "payment-idempotency", `${context.apiBaseUrl}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": sameKey
      },
      body: JSON.stringify({
        giftId: context.giftId,
        quantity: context.giftQuantity,
        paymentMethod: "HOSTED"
      })
    });
    assertStatus(conflict.response.status, 409, "payment-idempotency conflict", conflict.body);

    return {
      replayPaymentId: firstParsed.payment.paymentId
    };
  });

  await runPhase("payment-webhook", results, async () => {
    assert(state.createdPaymentId, "Payment ID required before webhook phase.");
    const documentClient = createDocumentClient();
    const tableName = await resolveWeddingTableName();
    const stored = await fetchStoredPayment(documentClient, tableName, state.createdPaymentId);
    const today = nowIso().slice(0, 10);
    const webhookPayload = {
      event: "PAYMENT_RECEIVED",
      payment: {
        id: stored.asaasPaymentId,
        checkoutSession: stored.asaasCheckoutId,
        externalReference: state.createdPaymentId,
        status: "RECEIVED",
        confirmedDate: today,
        clientPaymentDate: today
      }
    };

    const accepted = await requestJson(context, "payment-webhook", `${context.apiBaseUrl}/webhooks/asaas`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "asaas-access-token": context.asaasWebhookToken
      },
      body: JSON.stringify(webhookPayload)
    });
    assertStatus(accepted.response.status, 200, "payment-webhook accepted", accepted.body);
    assert((accepted.body as { duplicate?: unknown }).duplicate === false, "First webhook should not be duplicate.");

    const polled = await pollForPaymentTerminalState(context, state.createdPaymentId);

    const duplicate = await requestJson(context, "payment-webhook", `${context.apiBaseUrl}/webhooks/asaas`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "asaas-access-token": context.asaasWebhookToken
      },
      body: JSON.stringify(webhookPayload)
    });
    assertStatus(duplicate.response.status, 200, "payment-webhook duplicate", duplicate.body);
    assert((duplicate.body as { duplicate?: unknown }).duplicate === true, "Second webhook should be duplicate.");

    const forbidden = await requestJson(context, "payment-webhook", `${context.apiBaseUrl}/webhooks/asaas`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "asaas-access-token": "invalid-token"
      },
      body: JSON.stringify(webhookPayload)
    });
    assertStatus(forbidden.response.status, 403, "payment-webhook invalid token", forbidden.body);

    const giftsAfter = await requestJson(context, "payment-webhook", `${context.apiBaseUrl}/gifts`);
    assertStatus(giftsAfter.response.status, 200, "payment-webhook gifts after", giftsAfter.body);
    const parsedGifts = parseWithSchema("payment-webhook gifts after", GetGiftsResponseSchema, giftsAfter.body);
    const selectedGift = parsedGifts.gifts.find((gift) => gift.id === context.giftId);
    assert(selectedGift, `Gift ${context.giftId} missing after webhook.`);
    assert(
      typeof state.initialGiftPartsFunded === "number" &&
        selectedGift.partsFunded >= state.initialGiftPartsFunded + context.giftQuantity,
      "Gift funding did not increase after webhook processing."
    );

    return {
      paymentId: state.createdPaymentId,
      terminalStatus: polled.payment.status,
      observedStatuses: polled.statuses,
      giftPartsFunded: selectedGift.partsFunded
    };
  });

  await runPhase("payment-message", results, async () => {
    assert(state.createdPaymentId, "Payment ID required before payment-message phase.");
    const { body, response } = await requestJson(
      context,
      "payment-message",
      `${context.apiBaseUrl}/payments/${encodeURIComponent(state.createdPaymentId)}/message`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `prod-promotion-payment-message-${context.runMarker}`
        },
        body: JSON.stringify({
          body: `Mensagem de integração ${context.runMarker}`
        })
      }
    );
    assertStatus(response.status, 200, "payment-message", body);
    const parsed = parseWithSchema("payment-message", CreatePaymentMessageResponseSchema, body);
    assert(parsed.message.paymentId === state.createdPaymentId, "Payment message paymentId mismatch.");

    return {
      paymentId: parsed.message.paymentId,
      submittedAt: parsed.message.submittedAt
    };
  });

  await runPhase("negative-paths", results, async () => {
    const invalidGift = await requestJson(context, "negative-paths", `${context.apiBaseUrl}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `prod-promotion-invalid-gift-${context.runMarker}`
      },
      body: JSON.stringify({
        giftId: "g-does-not-exist",
        quantity: 1,
        paymentMethod: PROD_PROMOTION_PAYMENT_METHOD
      })
    });
    assertStatus(invalidGift.response.status, 400, "negative-paths invalid gift", invalidGift.body);

    const missingTurnstile = await requestJson(
      context,
      "negative-paths",
      `${context.apiBaseUrl}/invitation/${encodeURIComponent(context.invitationCode)}`
    );
    assertStatus(missingTurnstile.response.status, 403, "negative-paths missing turnstile", missingTurnstile.body);

    const invalidInvitation = await requestJson(
      context,
      "negative-paths",
      `${context.apiBaseUrl}/invitation/ZZ9999`,
      {
        headers: {
          "x-turnstile-token": context.turnstileToken
        }
      }
    );
    assertStatus(invalidInvitation.response.status, 404, "negative-paths invalid invitation", invalidInvitation.body);

    const missingLookupProof = await requestJson(context, "negative-paths", `${context.apiBaseUrl}/rsvp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `prod-promotion-missing-proof-${context.runMarker}`
      },
      body: JSON.stringify({
        invitationCode: context.invitationCode,
        submittedBy: "CI Prod Promotion",
        guestResponses: [
          {
            guestId: "missing-proof-guest",
            status: "attending",
            isChildSixOrYounger: false
          }
        ],
        attendingGuestCount: 1
      })
    });
    assertStatus(missingLookupProof.response.status, 403, "negative-paths missing lookup proof", missingLookupProof.body);

    const missingPayment = await requestJson(
      context,
      "negative-paths",
      `${context.apiBaseUrl}/payments/not-a-real-payment`
    );
    assertStatus(missingPayment.response.status, 404, "negative-paths missing payment", missingPayment.body);

    return {
      checks: 5
    };
  });

  const finishedAt = nowIso();
  await writeFile(
    summaryFile,
    JSON.stringify(
      {
        ok: true,
        startedAt,
        finishedAt,
        apiBaseUrl: context.apiBaseUrl,
        invitationCode: context.invitationCode,
        giftId: context.giftId,
        results
      },
      null,
      2
    ),
    "utf8"
  );
}

main().catch(async (error) => {
  const artifactDir = process.env.PROD_PROMOTION_ARTIFACT_DIR?.trim()
    ? path.resolve(process.env.PROD_PROMOTION_ARTIFACT_DIR)
    : path.resolve(".tmp/prod-promotion-validation", `${Date.now()}`);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, "summary.json"),
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    ),
    "utf8"
  );
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
