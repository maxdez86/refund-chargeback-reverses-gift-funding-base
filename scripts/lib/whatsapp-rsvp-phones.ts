/**
 * Bulk WhatsApp RSVP phone backfill.
 *
 * Batches the single-household `whatsapp:rsvp phone --apply` operation across an
 * `invitationCode,phoneNumber` CSV. This only writes DynamoDB (the invitation's
 * phone plus its WHATSAPP_PHONE lookup row) — it never sends a WhatsApp message.
 *
 * The CSV reader is deliberately minimal: two columns, no embedded commas, no
 * quoted multi-line fields. Invitation codes and phone numbers never contain a
 * comma, so a real parser would be dependency weight for nothing.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { INVITATION_CODE_REGEX } from "../../packages/contracts/src/invitation-code.ts";
import { normalizeWhatsappPhone, WhatsappRsvpService } from "../../apps/api/src/domain/whatsapp-rsvp-service.ts";
import { WeddingRepository } from "../../apps/api/src/services/dynamodb/repositories/wedding-repository.ts";
import { redactWhatsappPhone } from "./whatsapp-rsvp-operations.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HEADER_CODE_PATTERN = /^invitation[-_]?code$/i;

export type PhoneBatchMode = "dry-run" | "apply";
export type PhoneBatchClassification = "new" | "changed" | "unchanged" | "missing";
export type PhoneBatchOutcome = "updated" | "would-update" | "unchanged" | "failed";

export type PhoneBatchRow = { line: number; invitationCode: string; phoneNumber: string };

/** Never carries the raw phone: these are rendered to stdout and to results.jsonl. */
export type PhoneBatchRowError = { line: number; invitationCode?: string; error: string };

export type ParsedPhoneBatch = { rows: PhoneBatchRow[]; errors: PhoneBatchRowError[] };

export type PhoneBatchEntry = {
  line: number;
  invitationCode: string;
  outcome: PhoneBatchOutcome;
  phoneNumber?: string;
  classification?: PhoneBatchClassification;
  updatedAt?: string;
  error?: string;
};

export type PhoneBatchResult = {
  mode: PhoneBatchMode;
  entries: PhoneBatchEntry[];
  updated: number;
  wouldUpdate: number;
  unchanged: number;
  failed: number;
  missing: number;
  changed: number;
  skipped: number;
};

export type PhoneBatchDeps = {
  readStatus: (invitationCode: string) => Promise<{ phoneNumber?: string } | null>;
  updatePhone: (invitationCode: string, phoneNumber: string) => Promise<{ updatedAt: string }>;
};

export type PhoneBatchRunOptions = {
  mode: PhoneBatchMode;
  stage: string;
  confirmProd: boolean;
  limit?: number;
  full?: boolean;
  logger?: Pick<Console, "log">;
};

function cell(value: string) {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

export function stripCsvPreamble(text: string) {
  return text.replace(/^\uFEFF/, "");
}

export function parsePhoneBatchCsv(text: string): ParsedPhoneBatch {
  const rows: PhoneBatchRow[] = [];
  const errors: PhoneBatchRowError[] = [];
  const seenCodes = new Map<string, number>();
  let sawDataLine = false;

  stripCsvPreamble(text).split(/\r?\n/).forEach((rawLine, index) => {
    const line = index + 1;
    const content = rawLine.trim();
    if (!content || content.startsWith("#")) return;

    const cells = content.split(",").map(cell);
    if (!sawDataLine && HEADER_CODE_PATTERN.test(cells[0] ?? "")) {
      sawDataLine = true;
      return;
    }
    sawDataLine = true;

    if (cells.length !== 2) {
      errors.push({ line, error: `Expected 2 columns (invitationCode,phoneNumber), found ${cells.length}.` });
      return;
    }

    const [invitationCode, rawPhone] = cells;
    if (!INVITATION_CODE_REGEX.test(invitationCode)) {
      errors.push({ line, invitationCode, error: `Invalid invitation code: ${invitationCode}` });
      return;
    }

    const duplicateOf = seenCodes.get(invitationCode);
    if (duplicateOf !== undefined) {
      errors.push({ line, invitationCode, error: `Duplicate invitation code, already on line ${duplicateOf}.` });
      return;
    }

    let phoneNumber: string;
    try {
      phoneNumber = normalizeWhatsappPhone(rawPhone);
    } catch (error) {
      errors.push({ line, invitationCode, error: error instanceof Error ? error.message : String(error) });
      return;
    }

    seenCodes.set(invitationCode, line);
    rows.push({ line, invitationCode, phoneNumber });
  });

  return { rows, errors };
}

export function parseWhatsappRsvpPhoneBatchArgs(argv: readonly string[]) {
  let csvPath: string | undefined;
  let limit: number | undefined;
  let mode: PhoneBatchMode = "dry-run";
  let confirmProd = false;
  let full = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--csv" || argument === "--limit") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing ${argument}.`);
      if (argument === "--csv") {
        csvPath = value;
      } else {
        limit = Number(value);
        if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer.");
      }
      index += 1;
      continue;
    }
    if (argument === "--apply") { mode = "apply"; continue; }
    if (argument === "dry-run") { mode = "dry-run"; continue; }
    if (argument === "--confirm-prod") { confirmProd = true; continue; }
    if (argument === "--full") { full = true; continue; }
    throw new Error(`Unexpected argument: ${argument}`);
  }

  if (!csvPath) throw new Error("Missing --csv.");
  return { csvPath, mode, confirmProd, limit, full };
}

export function assertPhoneBatchStageGuard(options: Pick<PhoneBatchRunOptions, "mode" | "stage" | "confirmProd">) {
  if (options.mode === "apply" && options.stage === "prod" && !options.confirmProd) {
    throw new Error("Refusing to apply a production phone batch without --confirm-prod.");
  }
}

export function formatPhoneBatchSummary(result: PhoneBatchResult) {
  return `Phone batch summary: mode=${result.mode} updated=${result.updated} wouldUpdate=${result.wouldUpdate}`
    + ` unchanged=${result.unchanged} failed=${result.failed} missing=${result.missing}`
    + ` changed=${result.changed} skipped=${result.skipped}`;
}

function defaultPhoneBatchDeps(): PhoneBatchDeps {
  const repository = new WeddingRepository();
  const service = new WhatsappRsvpService(repository);
  return {
    readStatus: (invitationCode) => repository.getInvitationWhatsappStatus(invitationCode),
    updatePhone: (invitationCode, phoneNumber) => service.updatePhone(invitationCode, phoneNumber)
  };
}

export async function runWhatsappRsvpPhoneBatch(
  parsed: ParsedPhoneBatch,
  options: PhoneBatchRunOptions,
  deps?: PhoneBatchDeps
): Promise<PhoneBatchResult> {
  assertPhoneBatchStageGuard(options);

  const logger = options.logger ?? console;
  const resolved = deps ?? defaultPhoneBatchDeps();
  const show = (phoneNumber: string) => (options.full ? phoneNumber : redactWhatsappPhone(phoneNumber) ?? "****");

  const entries: PhoneBatchEntry[] = parsed.errors.map((error) => ({
    line: error.line,
    invitationCode: error.invitationCode ?? "",
    outcome: "failed" as const,
    error: error.error
  }));
  for (const error of parsed.errors) {
    logger.log(`failed line ${error.line}: ${error.error}`);
  }

  const selected = options.limit === undefined ? parsed.rows : parsed.rows.slice(0, options.limit);
  const counts = {
    updated: 0,
    wouldUpdate: 0,
    unchanged: 0,
    failed: parsed.errors.length,
    missing: 0,
    changed: 0,
    skipped: parsed.rows.length - selected.length
  };

  for (const row of selected) {
    const base = { line: row.line, invitationCode: row.invitationCode, phoneNumber: redactWhatsappPhone(row.phoneNumber) };
    try {
      const status = await resolved.readStatus(row.invitationCode);
      if (!status) {
        counts.missing += 1;
        counts.failed += 1;
        entries.push({ ...base, outcome: "failed", classification: "missing", error: "Invitation not found." });
        logger.log(`failed ${row.invitationCode} (line ${row.line}): invitation not found`);
        continue;
      }

      if (status.phoneNumber === row.phoneNumber) {
        counts.unchanged += 1;
        entries.push({ ...base, outcome: "unchanged", classification: "unchanged" });
        logger.log(`unchanged ${row.invitationCode} (line ${row.line}): ${show(row.phoneNumber)}`);
        continue;
      }

      const classification: PhoneBatchClassification = status.phoneNumber ? "changed" : "new";
      if (status.phoneNumber) {
        counts.changed += 1;
        // updatePhone adds the new WHATSAPP_PHONE#<phone> lookup row but never removes the old
        // one, so the previous number keeps resolving to this invitation for inbound routing.
        logger.log(
          `warning ${row.invitationCode} (line ${row.line}): replacing ${show(status.phoneNumber)}`
          + ` with ${show(row.phoneNumber)}; the previous number keeps resolving to this invitation`
          + " until its WHATSAPP_PHONE lookup row is removed"
        );
      }

      if (options.mode === "dry-run") {
        counts.wouldUpdate += 1;
        entries.push({ ...base, outcome: "would-update", classification });
        logger.log(`would update ${row.invitationCode} (line ${row.line}): ${show(row.phoneNumber)} (${classification})`);
        continue;
      }

      const { updatedAt } = await resolved.updatePhone(row.invitationCode, row.phoneNumber);
      counts.updated += 1;
      entries.push({ ...base, outcome: "updated", classification, updatedAt });
      logger.log(`updated ${row.invitationCode} (line ${row.line}): ${show(row.phoneNumber)} (${classification})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      counts.failed += 1;
      entries.push({ ...base, outcome: "failed", error: message });
      logger.log(`failed ${row.invitationCode} (line ${row.line}): ${message}`);
    }
  }

  entries.sort((left, right) => left.line - right.line);
  return { mode: options.mode, entries, ...counts };
}

function createPhoneBatchArtifactDir(stage: string) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const directory = path.join(REPO_ROOT, ".tmp", "whatsapp-rsvp-phones", `${timestamp}-${stage}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

async function main() {
  const args = parseWhatsappRsvpPhoneBatchArgs(process.argv.slice(2));
  const stage = process.env.STAGE?.trim() || "prod";
  const csvPath = path.resolve(args.csvPath);
  const text = readFileSync(csvPath, "utf8");
  const parsed = parsePhoneBatchCsv(text);
  if (parsed.rows.length === 0 && parsed.errors.length === 0) {
    throw new Error(`No data rows found in ${args.csvPath}.`);
  }

  assertPhoneBatchStageGuard({ ...args, stage });

  const outputDir = createPhoneBatchArtifactDir(stage);
  console.log(`Mode: ${args.mode}`);
  console.log(`Stage: ${stage}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Rows: ${parsed.rows.length} parseable, ${parsed.errors.length} rejected`);
  console.log(`Artifacts: ${outputDir}`);

  const result = await runWhatsappRsvpPhoneBatch(parsed, { ...args, stage });
  const summary = formatPhoneBatchSummary(result);
  console.log(summary);

  writeFileSync(path.join(outputDir, "results.jsonl"), `${result.entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  writeFileSync(path.join(outputDir, "summary.txt"), `${summary}\n`);

  const failures = result.entries.filter((entry) => entry.outcome === "failed");
  if (failures.length === 0) return;

  // failures.csv is the only artifact holding raw phone numbers, so it can be re-fed
  // straight back into --csv. It stays inside the gitignored .tmp/ tree.
  const sourceLines = stripCsvPreamble(text).split(/\r?\n/);
  writeFileSync(
    path.join(outputDir, "failures.csv"),
    `${["invitationCode,phoneNumber", ...failures.map((entry) => sourceLines[entry.line - 1] ?? "")].join("\n")}\n`
  );
  console.log(`Rerun the failures with --csv ${path.join(outputDir, "failures.csv")}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
