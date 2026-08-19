import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WhatsappApiError } from "../apps/api/src/services/whatsapp/client.ts";
import { filterWhatsappRsvpHistory, parseWhatsappRsvpArgs, redactWhatsappPhone } from "./lib/whatsapp-rsvp-operations.ts";
import { autoSendWhatsappRsvp, parseWhatsappRsvpAutoSendArgs } from "./lib/whatsapp-rsvp-auto-send.ts";
import {
  buildWhatsappWebhookPayload,
  parseWhatsappSimulatorArgs,
  serializeWhatsappWebhookPayload,
  simulateWhatsappWebhook,
  whatsappWebhookSignature
} from "./lib/whatsapp-webhook-simulator.ts";
import {
  parseManageWhatsappTemplateArgs,
  runManageWhatsappTemplates
} from "./lib/manage-whatsapp-templates.ts";
import { listTemplateManifestEntries } from "../apps/api/src/services/whatsapp/template-manifest.ts";
import {
  formatSendWhatsappTemplateFailure,
  parseSendWhatsappTemplateArgs,
  runSendWhatsappTemplate
} from "./lib/send-whatsapp-template.ts";
import {
  buildInvitationItems,
  importNewInvitations,
  validateNewInvitations
} from "./lib/import-new-invitations.ts";
import {
  formatPhoneBatchSummary,
  parsePhoneBatchCsv,
  parseWhatsappRsvpPhoneBatchArgs,
  runWhatsappRsvpPhoneBatch
} from "./lib/whatsapp-rsvp-phones.ts";

test("template management defaults writes to dry-run", () => {
  const options = parseManageWhatsappTemplateArgs([
    "create",
    "--purpose",
    "wedding_invitation",
    "--version",
    "1",
    "--name",
    "wedding",
    "--language",
    "en"
  ]);
  assert.equal(options.apply, false);
  assert.equal(options.confirmProd, false);
  assert.equal(options.purpose, "wedding_invitation");
  assert.equal(options.version, 1);
});

test("template management recognizes explicit apply", () => {
  const options = parseManageWhatsappTemplateArgs([
    "activate",
    "--purpose",
    "wedding_invitation",
    "--version",
    "2",
    "--apply",
    "--confirm-prod"
  ]);
  assert.equal(options.apply, true);
  assert.equal(options.confirmProd, true);
});

test("seed parsing defaults to all templates and dry-run", () => {
  const options = parseManageWhatsappTemplateArgs(["seed"]);
  assert.equal(options.apply, false);
  assert.equal(options.activate, false);
  assert.equal(options.purpose, undefined);
});

function seedRepository(overrides: {
  stored?: Map<string, unknown>;
  active?: Map<string, unknown>;
  onCreate?: (definition: unknown) => void;
  onActivate?: (purpose: string, version: number) => void;
} = {}) {
  const stored = overrides.stored ?? new Map();
  const active = overrides.active ?? new Map();
  return {
    getVersion: async (purpose: string, version: number) => stored.get(`${purpose}:${version}`) ?? null,
    getActive: async (purpose: string) => active.get(purpose) ?? null,
    createVersion: async (definition: unknown) => {
      overrides.onCreate?.(definition);
      const value = definition as { purpose: string; version: number };
      stored.set(`${value.purpose}:${value.version}`, definition);
      return definition;
    },
    activate: async (purpose: string, version: number) => {
      overrides.onActivate?.(purpose, version);
      const definition = stored.get(`${purpose}:${version}`);
      active.set(purpose, definition);
      return { purpose, version };
    },
    listVersions: async () => []
  };
}

test("seed dry-run returns a safe plan without writes", async () => {
  let writes = 0;
  const result = await runManageWhatsappTemplates(
    parseManageWhatsappTemplateArgs(["seed"]),
    seedRepository({ onCreate: () => writes++ }) as never,
    "dev"
  );
  assert.equal(result.mode, "dry-run");
  assert.equal(result.plan.length, 6);
  assert.equal(writes, 0);
  assert.equal(JSON.stringify(result).includes("components"), false);
});

test("seed apply creates all versions without activating", async () => {
  let creates = 0;
  let activations = 0;
  const result = await runManageWhatsappTemplates(
    parseManageWhatsappTemplateArgs(["seed", "--apply"]),
    seedRepository({ onCreate: () => creates++, onActivate: () => activations++ }) as never,
    "dev"
  );
  assert.equal(result.mode, "applied");
  assert.equal(creates, 6);
  assert.equal(activations, 0);
});

test("seed is idempotent and does not create a second invitation version", async () => {
  const stored = new Map<string, unknown>();
  const active = new Map<string, unknown>();
  const entries = listTemplateManifestEntries();
  for (const entry of entries) {
    stored.set(`${entry.definition.purpose}:${entry.definition.version}`, entry.definition);
    active.set(entry.definition.purpose, entry.definition);
  }
  let writes = 0;
  const result = await runManageWhatsappTemplates(
    parseManageWhatsappTemplateArgs(["seed", "--apply"]),
    seedRepository({ stored, active, onCreate: () => writes++ }) as never,
    "dev"
  );
  assert.equal(writes, 0);
  assert.equal(result.plan.every((entry) => entry.status === "already-active"), true);
  assert.equal(stored.has("wedding_invitation:2"), false);
});

test("seed refuses an immutable content conflict before writing", async () => {
  const invitation = listTemplateManifestEntries()[0].definition;
  const stored = new Map([["wedding_invitation:1", { ...invitation, name: "different_name" }]]);
  let writes = 0;
  await assert.rejects(
    () => runManageWhatsappTemplates(
      parseManageWhatsappTemplateArgs(["seed", "--purpose", "wedding_invitation", "--apply"]),
      seedRepository({ stored, onCreate: () => writes++ }) as never,
      "dev"
    ),
    /wedding_invitation version 1 already exists with different content/
  );
  assert.equal(writes, 0);
});

test("seed activation verifies the complete active definition", async () => {
  const stored = new Map<string, unknown>();
  const entries = listTemplateManifestEntries();
  for (const entry of entries) stored.set(`${entry.definition.purpose}:${entry.definition.version}`, entry.definition);
  const repository = seedRepository({ stored, onActivate: () => undefined });
  const result = await runManageWhatsappTemplates(
    parseManageWhatsappTemplateArgs(["seed", "--apply", "--activate"]),
    repository as never,
    "dev"
  );
  assert.equal(result.mode, "applied");
  assert.equal(result.plan.every((entry) => entry.activation === "activate"), true);
});

test("seed never activates a pending Meta approval entry", async () => {
  const entry = listTemplateManifestEntries().find(
    (candidate) => candidate.definition.purpose === "wedding_rsvp_pending_reminder"
  )!;
  let activations = 0;
  await assert.rejects(
    () => runManageWhatsappTemplates(
      parseManageWhatsappTemplateArgs(["seed", "--purpose", entry.definition.purpose, "--apply", "--activate"]),
      seedRepository({ onActivate: () => activations++ }) as never,
      "dev",
      [{ ...entry, approvalStatus: "pending_meta_approval" }]
    ),
    /unapproved WhatsApp templates/
  );
  assert.equal(activations, 0);
});

test("seed verification catches a named template read back as positional", async () => {
  const entry = listTemplateManifestEntries().find(
    (candidate) => candidate.definition.parameterFormat === "named"
  )!;
  let reads = 0;
  const repository = {
    getVersion: async () => entry.definition,
    getActive: async () => {
      reads++;
      return reads === 1 ? null : { ...entry.definition, parameterFormat: "positional" as const };
    },
    createVersion: async () => entry.definition,
    activate: async () => ({ purpose: entry.definition.purpose, version: entry.definition.version }),
    listVersions: async () => []
  };
  await assert.rejects(
    () => runManageWhatsappTemplates(
      parseManageWhatsappTemplateArgs(["seed", "--purpose", entry.definition.purpose, "--apply", "--activate"]),
      repository as never,
      "dev",
      [entry]
    ),
    /verification failed/
  );
});

test("seed production guard runs before repository reads", async () => {
  let reads = 0;
  const repository = seedRepository();
  repository.getVersion = async () => {
    reads++;
    return null;
  };
  await assert.rejects(
    () => runManageWhatsappTemplates(parseManageWhatsappTemplateArgs(["seed", "--apply"]), repository as never, "prod"),
    /--confirm-prod/
  );
  assert.equal(reads, 0);
});

test("template management refuses unconfirmed production writes", async () => {
  const { runManageWhatsappTemplates } = await import("./lib/manage-whatsapp-templates.ts");
  const repository = { createVersion: async () => assert.fail("must not write") };
  await assert.rejects(
    () =>
      runManageWhatsappTemplates(
        {
          command: "create",
          apply: true,
          confirmProd: false,
          purpose: "wedding_invitation",
          version: 1,
          name: "wedding",
          language: "en"
        },
        repository as never,
        "prod"
      ),
    /--confirm-prod/
  );
});

test("send parsing requires dev and explicit confirmation", () => {
  const args = ["--purpose", "wedding_invitation", "--recipient", "5511999999999"];
  assert.throws(() => parseSendWhatsappTemplateArgs(args, "dev"), /--confirm-send/);
  assert.throws(() => parseSendWhatsappTemplateArgs([...args, "--confirm-send"], "prod"), /dev stage/);
  assert.equal(parseSendWhatsappTemplateArgs([...args, "--confirm-send"], "dev").confirmSend, true);
});

test("send execution guard prevents calls without confirmation", async () => {
  const service = { send: async () => assert.fail("must not send") };
  await assert.rejects(
    () =>
      runSendWhatsappTemplate(
        {
          confirmSend: false,
          purpose: "wedding_invitation",
          recipient: "5511999999999",
          stage: "dev"
        },
        service as never
      ),
    /dev-stage confirmation/
  );
});

test("safe send result excludes recipient and provider WhatsApp id", async () => {
  const service = {
    send: async () => ({
      messageId: "wamid.safe",
      recipientWaId: "5511999999999",
      templatePurpose: "wedding_invitation",
      templateVersion: 1
    })
  };
  const result = await runSendWhatsappTemplate(
    {
      confirmSend: true,
      purpose: "wedding_invitation",
      recipient: "5511999999999",
      stage: "dev"
    },
    service as never
  );
  assert.deepEqual(result, {
    stage: "dev",
    templatePurpose: "wedding_invitation",
    templateVersion: 1,
    messageId: "wamid.safe",
    providerTraceId: undefined
  });
  assert.equal(JSON.stringify(result).includes("5511999999999"), false);
});

test("unknown send outcomes require reconciliation without exposing raw details", () => {
  for (const category of ["timeout", "network", "ambiguous_delivery"] as const) {
    const error = new WhatsappApiError(
      "WhatsApp delivery outcome is unknown.",
      category,
      undefined,
      false
    );
    const output = formatSendWhatsappTemplateFailure(error);
    assert.match(output, /Do not resend/);
    assert.match(output, /manually reconciled/);
    assert.equal(output.includes("5511999999999"), false);
  }

  assert.equal(
    formatSendWhatsappTemplateFailure(new Error("secret raw exception for 5511999999999")),
    "WhatsApp template send failed."
  );
});

test("RSVP argument parsing keeps flags independent and supports list", () => {
  const status = parseWhatsappRsvpArgs(["status", "--invitation-code", "SW0000"]);
  assert.equal(status.command, "status");
  assert.equal(status.apply, false);
  assert.equal(status.confirmSend, false);
  assert.equal(status.full, false);

  const list = parseWhatsappRsvpArgs([
    "list", "--invitation-code", "SW0000", "--status", "reconciliation_required", "--full"
  ]);
  assert.equal(list.status, "reconciliation_required");
  assert.equal(list.full, true);
  assert.throws(() => parseWhatsappRsvpArgs(["phone", "--invitation-code", "--apply"]), /Missing --invitation-code/);
  assert.throws(() => parseWhatsappRsvpArgs(["send", "--invitation-code", "SW0000"]), /Missing --template-id/);
  assert.throws(() => parseWhatsappRsvpArgs(["unknown", "--invitation-code", "SW0000"]), /Expected phone, send, status, or list/);
  assert.throws(() => parseWhatsappRsvpArgs(["list", "--invitation-code", "SW0000", "--status", "sent"]), /--status must be/);
});

test("RSVP auto-send parsing requires confirmation and rejects template selection", () => {
  assert.deepEqual(
    parseWhatsappRsvpAutoSendArgs(["--invitation-code", "SW2748", "--confirm-send"]),
    { invitationCode: "SW2748", confirmSend: true }
  );
  assert.throws(() => parseWhatsappRsvpAutoSendArgs(["--invitation-code", "SW2748"]), /confirm-send/);
  assert.throws(() => parseWhatsappRsvpAutoSendArgs(["--invitation-code", "SW2748", "--template-id", "foo"]), /Only/);
});

test("RSVP auto-send calls the endpoint without a template id and parses its response", async () => {
  let request: RequestInit | undefined;
  const result = await autoSendWhatsappRsvp("SW2748", {
    apiBaseUrl: "https://api.dev.example",
    authorization: "Bearer test-token",
    fetchImpl: async (url, init) => {
      request = init;
      assert.equal(String(url), "https://api.dev.example/admin/whatsapp/invitations/SW2748/send-rsvp");
      return new Response(JSON.stringify({
        commandId: "cmd-1", invitationCode: "SW2748", templateId: "wedding_rsvp_pending_reminder",
        templateVersion: 1, status: "queued", replayed: false
      }), { status: 202 });
    }
  });
  assert.equal(result.templateId, "wedding_rsvp_pending_reminder");
  assert.equal(request?.method, "POST");
  assert.equal((request?.headers as Record<string, string>)["idempotency-key"], "auto-rsvp-SW2748");
  assert.equal((request?.headers as Record<string, string>).authorization, "Bearer test-token");
});

test("new invitation imports preserve an optional validated phone number", () => {
  const invitation = {
    invitationCode: "SW2748",
    householdName: "Household",
    phoneNumber: "5511963656517",
    guests: [{ guestName: "Ana", slot: 1 }]
  };
  validateNewInvitations([invitation]);
  assert.equal(buildInvitationItems(invitation)[0].phoneNumber, invitation.phoneNumber);
  assert.throws(
    () => validateNewInvitations([{ ...invitation, phoneNumber: "not-a-phone" }]),
    /Invalid phone number/
  );
  assert.equal(buildInvitationItems({ ...invitation, phoneNumber: undefined })[0].phoneNumber, undefined);
});

test("new invitation import reports missing phones in its summary", async () => {
  const logs: string[] = [];
  const result = await importNewInvitations(
    { send: async () => ({}) } as never,
    [{ invitationCode: "SW2748", householdName: "Household", guests: [{ guestName: "Ana", slot: 1 }] }],
    "table",
    { mode: "dry-run", logger: { log: (line: string) => logs.push(line) } }
  );
  assert.deepEqual(result, { inserted: 0, wouldInsert: 1, skipped: 0 });
  assert.equal(logs.at(-1), "Import summary: inserted=0 wouldInsert=1 skipped=0 missingPhone=1");
});

test("status redaction keeps only the final four digits", () => {
  assert.equal(redactWhatsappPhone("5511900000000"), "*********0000");
  assert.equal(redactWhatsappPhone(undefined), undefined);
});

test("list maps flow statuses to durable command history", () => {
  const history = [
    { kind: "command" as const, id: "queued", status: "queued" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { kind: "command" as const, id: "failed", status: "failed" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { kind: "command" as const, id: "reconcile", status: "sent" as const, reconciliationStatus: "required" as const, createdAt: "2026-01-01T00:00:00.000Z" },
    { kind: "message" as const, id: "message", status: "received" as const, createdAt: "2026-01-01T00:00:00.000Z" }
  ];
  assert.deepEqual(filterWhatsappRsvpHistory(history, "send_queued", "send_queued").map((entry) => entry.id), ["queued"]);
  assert.deepEqual(filterWhatsappRsvpHistory(history, "failed", "failed").map((entry) => entry.id), ["failed"]);
  assert.deepEqual(filterWhatsappRsvpHistory(history, "reconciliation_required", "reconciliation_required").map((entry) => entry.id), ["reconcile"]);
});

test("simulator produces signed, parser-valid payloads for every branch", () => {
  for (const branch of ["a1", "b1", "b2", "b3", "fallback"] as const) {
    const result = simulateWhatsappWebhook(branch, "SW0000", "fixed-fake-secret");
    assert.equal(result.parsed.outcome, "accepted");
    if (result.parsed.outcome !== "accepted") throw new Error("Expected accepted payload.");
    assert.equal(result.parsed.events.length, 1);
    assert.equal(result.parsed.events[0].type, branch === "fallback" ? "text" : "button_reply");
  }
});

test("simulator B2 is a template quick reply resolved from the manifest", () => {
  const payload = buildWhatsappWebhookPayload("b2", "SW0000");
  const body = serializeWhatsappWebhookPayload(payload);
  assert.equal(whatsappWebhookSignature(body, "fixed-fake-secret"), "sha256=b940b2e85e113e5c69799371dba569dbf47722d2bfefd9e4a733ffbb2758f15d");
  const result = simulateWhatsappWebhook("b2", "SW0000", "fixed-fake-secret");
  assert.equal(result.parsed.outcome, "accepted");
  if (result.parsed.outcome !== "accepted") throw new Error("Expected accepted payload.");
  assert.deepEqual(
    {
      type: result.parsed.events[0].type,
      buttonId: result.parsed.events[0].type === "button_reply" ? result.parsed.events[0].buttonId : undefined,
      sourceVariant: result.parsed.events[0].type === "button_reply" ? result.parsed.events[0].sourceVariant : undefined,
      senderWaId: result.parsed.events[0].senderWaId,
      replyContextMessageId: result.parsed.events[0].replyContextMessageId
    },
    expectEvent("rsvp_b2_decline")
  );
});

test("simulator duplicate reuses the message id and parser reports the duplicate", () => {
  const result = simulateWhatsappWebhook("duplicate", "SW0000", "fixed-fake-secret");
  assert.equal(result.parsed.outcome, "accepted");
  if (result.parsed.outcome !== "accepted") throw new Error("Expected accepted payload.");
  assert.equal(result.parsed.events.length, 2);
  assert.equal(result.parsed.events[0].eventId, result.parsed.events[1].eventId);
  assert.equal(result.parsed.duplicateEventIds.length, 1);
});

test("simulator rejects A2 and keeps button ids in the manifest", () => {
  assert.throws(() => parseWhatsappSimulatorArgs(["--branch", "a2"]), /website RSVP path/);
  const source = readFileSync(new URL("./lib/whatsapp-webhook-simulator.ts", import.meta.url), "utf8");
  assert.equal(source.includes("rsvp_"), false);
});

function expectEvent(buttonId: string) {
  return {
    type: "button_reply",
    buttonId,
    sourceVariant: "template_quick_reply",
    senderWaId: "5511900000000",
    replyContextMessageId: "wamid.synthetic-outbound-SW0000"
  };
}

const PHONE_BATCH_CSV = [
  "invitationCode,phoneNumber",
  "SW2748,+55 11 91436-2818",
  "",
  "# a comment",
  '"QR3579","5511922223333"'
].join("\r\n");

function phoneBatchDeps(stored: Record<string, string | undefined>) {
  const calls = { reads: 0, writes: 0 };
  const deps = {
    readStatus: async (invitationCode: string) => {
      calls.reads += 1;
      if (!(invitationCode in stored)) return null;
      return { phoneNumber: stored[invitationCode] };
    },
    updatePhone: async (invitationCode: string, phoneNumber: string) => {
      calls.writes += 1;
      stored[invitationCode] = phoneNumber;
      return { updatedAt: "2026-08-18T00:00:00.000Z" };
    }
  };
  return { calls, deps };
}

function phoneBatchLogger() {
  const lines: string[] = [];
  return { lines, logger: { log: (line: string) => lines.push(line) } };
}

test("phone batch CSV tolerates a header, BOM, CRLF, comments, blanks, and quoted cells", () => {
  const parsed = parsePhoneBatchCsv(`\uFEFF${PHONE_BATCH_CSV}\r\n`);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows, [
    { line: 2, invitationCode: "SW2748", phoneNumber: "5511914362818" },
    { line: 5, invitationCode: "QR3579", phoneNumber: "5511922223333" }
  ]);
});

test("phone batch rejects bad rows individually and keeps the good ones", () => {
  const parsed = parsePhoneBatchCsv(
    [
      "SW2748,5511914362818",
      "sw2222,5511922223333",
      "SW0148,5511933334444",
      "QR3579",
      "QR4444,12",
      "SW2748,5511955556666"
    ].join("\n")
  );
  assert.deepEqual(parsed.rows, [{ line: 1, invitationCode: "SW2748", phoneNumber: "5511914362818" }]);
  assert.deepEqual(parsed.errors.map((error) => error.line), [2, 3, 4, 5, 6]);
  assert.match(parsed.errors[0].error, /Invalid invitation code/);
  assert.match(parsed.errors[2].error, /Expected 2 columns/);
  assert.match(parsed.errors[3].error, /Invalid WhatsApp phone number/);
  assert.match(parsed.errors[4].error, /Duplicate invitation code, already on line 1/);
});

test("phone batch dry-run classifies every row without writing", async () => {
  const { calls, deps } = phoneBatchDeps({ SW2748: undefined, QR3579: "5511999998888" });
  const parsed = parsePhoneBatchCsv(PHONE_BATCH_CSV);
  const result = await runWhatsappRsvpPhoneBatch(parsed, { mode: "dry-run", stage: "dev", confirmProd: false, logger: phoneBatchLogger().logger }, deps);

  assert.equal(calls.writes, 0);
  assert.equal(result.wouldUpdate, 2);
  assert.deepEqual(result.entries.map((entry) => entry.classification), ["new", "changed"]);
  assert.equal(result.changed, 1);
  assert.equal(result.failed, 0);
});

test("phone batch warns that a replaced number keeps resolving to the invitation", async () => {
  const { deps } = phoneBatchDeps({ SW2748: "5511999998888" });
  const { lines, logger } = phoneBatchLogger();
  await runWhatsappRsvpPhoneBatch(
    parsePhoneBatchCsv("SW2748,5511914362818"),
    { mode: "apply", stage: "dev", confirmProd: false, logger },
    deps
  );
  assert.equal(lines.some((line) => line.includes("keeps resolving to this invitation")), true);
});

test("phone batch skips an unchanged number instead of rewriting it", async () => {
  const { calls, deps } = phoneBatchDeps({ SW2748: "5511914362818" });
  const result = await runWhatsappRsvpPhoneBatch(
    parsePhoneBatchCsv("SW2748,+5511914362818"),
    { mode: "apply", stage: "dev", confirmProd: false, logger: phoneBatchLogger().logger },
    deps
  );
  assert.equal(calls.writes, 0);
  assert.equal(result.unchanged, 1);
});

test("phone batch continues past a failing row and reports a missing invitation", async () => {
  const { calls, deps } = phoneBatchDeps({ SW2748: undefined, QR3579: undefined });
  deps.updatePhone = async (invitationCode: string) => {
    calls.writes += 1;
    if (invitationCode === "SW2748") throw new Error("Throttled.");
    return { updatedAt: "2026-08-18T00:00:00.000Z" };
  };
  const parsed = parsePhoneBatchCsv(
    ["SW2748,5511914362818", "ZZ9999,5511933334444", "QR3579,5511922223333"].join("\n")
  );
  const result = await runWhatsappRsvpPhoneBatch(
    parsed,
    { mode: "apply", stage: "dev", confirmProd: false, logger: phoneBatchLogger().logger },
    deps
  );

  assert.equal(result.updated, 1);
  assert.equal(result.failed, 2);
  assert.equal(result.missing, 1);
  assert.deepEqual(result.entries.map((entry) => entry.outcome), ["failed", "failed", "updated"]);
  assert.equal(result.entries[1].error, "Invitation not found.");
});

test("phone batch production guard runs before any repository read", async () => {
  const { calls, deps } = phoneBatchDeps({ SW2748: undefined });
  await assert.rejects(
    runWhatsappRsvpPhoneBatch(
      parsePhoneBatchCsv("SW2748,5511914362818"),
      { mode: "apply", stage: "prod", confirmProd: false, logger: phoneBatchLogger().logger },
      deps
    ),
    /--confirm-prod/
  );
  assert.equal(calls.reads, 0);
  assert.equal(calls.writes, 0);
});

test("phone batch limit stops after the requested rows", async () => {
  const { calls, deps } = phoneBatchDeps({ SW2748: undefined, QR3579: undefined });
  const result = await runWhatsappRsvpPhoneBatch(
    parsePhoneBatchCsv(PHONE_BATCH_CSV),
    { mode: "apply", stage: "dev", confirmProd: false, limit: 1, logger: phoneBatchLogger().logger },
    deps
  );
  assert.equal(calls.writes, 1);
  assert.equal(result.skipped, 1);
});

test("phone batch never exposes a full phone number in its result or logs", async () => {
  const { deps } = phoneBatchDeps({ SW2748: undefined, QR3579: "5511999998888" });
  const { lines, logger } = phoneBatchLogger();
  const result = await runWhatsappRsvpPhoneBatch(
    parsePhoneBatchCsv(PHONE_BATCH_CSV),
    { mode: "apply", stage: "dev", confirmProd: false, logger },
    deps
  );
  const serialized = JSON.stringify(result);
  for (const secret of ["5511914362818", "5511922223333", "5511999998888"]) {
    assert.equal(serialized.includes(secret), false);
    assert.equal(lines.some((line) => line.includes(secret)), false);
  }
  assert.equal(result.entries[0].phoneNumber, "*********2818");
});

test("phone batch argument parsing defaults to dry-run and requires a csv", () => {
  const options = parseWhatsappRsvpPhoneBatchArgs(["--csv", "list.csv"]);
  assert.equal(options.mode, "dry-run");
  assert.equal(options.confirmProd, false);
  assert.equal(options.full, false);
  assert.equal(options.limit, undefined);

  const applied = parseWhatsappRsvpPhoneBatchArgs(["--csv", "list.csv", "--apply", "--confirm-prod", "--limit", "5"]);
  assert.equal(applied.mode, "apply");
  assert.equal(applied.confirmProd, true);
  assert.equal(applied.limit, 5);

  assert.throws(() => parseWhatsappRsvpPhoneBatchArgs([]), /Missing --csv/);
  assert.throws(() => parseWhatsappRsvpPhoneBatchArgs(["--csv", "--apply"]), /Missing --csv/);
  assert.throws(() => parseWhatsappRsvpPhoneBatchArgs(["--csv", "list.csv", "--limit", "0"]), /positive integer/);
  assert.throws(() => parseWhatsappRsvpPhoneBatchArgs(["--csv", "list.csv", "--send"]), /Unexpected argument/);
});

test("phone batch summary reports every outcome bucket", () => {
  assert.equal(
    formatPhoneBatchSummary({
      mode: "apply", entries: [], updated: 41, wouldUpdate: 0,
      unchanged: 6, failed: 2, missing: 2, changed: 3, skipped: 0
    }),
    "Phone batch summary: mode=apply updated=41 wouldUpdate=0 unchanged=6 failed=2 missing=2 changed=3 skipped=0"
  );
});
