import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Exports the live Meta definition of every RSVP template to a local JSON file so the manifest in
 * `apps/api/src/services/whatsapp/template-manifest.ts` can be diffed against what Meta actually
 * holds. Read-only: it never creates, edits, or deletes a template.
 *
 * The export deliberately keeps templates that are not APPROVED. An edit to an approved template
 * flips it to PENDING under the same id, and a brand new template starts as PENDING, so filtering
 * by status would hide exactly the versions this export exists to inspect.
 */

/** WhatsApp Business Account that owns the wedding templates. */
export const WHATSAPP_TEMPLATE_EXPORT_WABA_ID = "1967870250592348";

/**
 * Pinned to the version this export was written against. The runtime client uses a newer version
 * (`WHATSAPP_GRAPH_API_VERSION`); bump this with `--api-version` rather than assuming they match.
 */
export const WHATSAPP_TEMPLATE_EXPORT_API_VERSION = "v20.0";

export const WHATSAPP_TEMPLATE_EXPORT_FILE = "wedding_templates_export.json";

const GRAPH_API_HOST = "graph.facebook.com";

/** The six group templates and their six single-guest counterparts. */
export const WHATSAPP_TEMPLATE_EXPORT_NAMES = [
  "wedding_rsvp_reconfirmation",
  "wedding_rsvp_attending_followup",
  "wedding_rsvp_pending_reminder_group",
  "wedding_rsvp_attending_followup_website",
  "wedding_rsvp_declined_followup",
  "wedding_rsvp_undecided_followup",
  "wedding_rsvp_reconfirmation_single",
  "wedding_rsvp_attending_followup_single",
  "wedding_rsvp_pending_reminder_single",
  "wedding_rsvp_attending_followup_website_single",
  "wedding_rsvp_undecided_followup_single",
  "wedding_rsvp_declined_followup_single"
] as const;

export type GraphTemplate = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  [key: string]: unknown;
};

export type ExportWhatsappTemplatesOptions = {
  apiVersion: string;
  wabaId: string;
  names: string[];
  outputFile: string;
  delayMs: number;
  maxAttempts: number;
  maxPages: number;
};

export type WhatsappTemplateExportEntry = {
  name: string;
  requestUrl: string;
  matchCount: number;
  statuses: string[];
  languages: string[];
  /** Most recently created exact-name match, whatever its approval status. */
  latest: GraphTemplate | null;
  /** Every exact-name match, newest first. */
  versions: GraphTemplate[];
  /** Names Meta returned for this query that are not an exact match (the filter is a prefix match). */
  otherNameMatches: string[];
};

export type WhatsappTemplateExportFailure = {
  name: string;
  message: string;
  status?: number;
  code?: number;
};

export type WhatsappTemplateExport = {
  exportedAt: string;
  apiVersion: string;
  wabaId: string;
  requested: number;
  succeeded: number;
  failed: number;
  /** Requested names Meta answered for, but holds no template under. */
  missing: string[];
  templates: Record<string, WhatsappTemplateExportEntry>;
  errors: WhatsappTemplateExportFailure[];
};

export class WhatsappTemplateExportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number
  ) {
    super(message);
    this.name = "WhatsappTemplateExportError";
  }
}

export type ExportWhatsappTemplatesDependencies = {
  fetch?: typeof globalThis.fetch;
  getAccessToken?: () => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (message: string) => void;
};

function optionValue(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

function optionValues(argv: readonly string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
    values.push(value);
  }
  return values;
}

function positiveInteger(raw: string | undefined, name: string, fallback: number) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

export function parseExportWhatsappTemplatesArgs(argv: readonly string[]): ExportWhatsappTemplatesOptions {
  const names = optionValues(argv, "--name");
  const apiVersion = optionValue(argv, "--api-version") ?? WHATSAPP_TEMPLATE_EXPORT_API_VERSION;
  if (!/^v\d+\.\d+$/.test(apiVersion)) throw new Error("--api-version must look like v20.0.");
  const wabaId = optionValue(argv, "--waba-id") ?? WHATSAPP_TEMPLATE_EXPORT_WABA_ID;
  if (!/^\d+$/.test(wabaId)) throw new Error("--waba-id must be numeric.");
  const maxAttempts = positiveInteger(optionValue(argv, "--attempts"), "--attempts", 3);
  if (maxAttempts < 1) throw new Error("--attempts must be at least 1.");
  const maxPages = positiveInteger(optionValue(argv, "--max-pages"), "--max-pages", 5);
  if (maxPages < 1) throw new Error("--max-pages must be at least 1.");
  return {
    apiVersion,
    wabaId,
    names: names.length > 0 ? names : [...WHATSAPP_TEMPLATE_EXPORT_NAMES],
    outputFile: optionValue(argv, "--out") ?? WHATSAPP_TEMPLATE_EXPORT_FILE,
    delayMs: positiveInteger(optionValue(argv, "--delay-ms"), "--delay-ms", 350),
    maxAttempts,
    maxPages
  };
}

export function templateExportRequestUrl(options: Pick<ExportWhatsappTemplatesOptions, "apiVersion" | "wabaId">, name: string) {
  const url = new URL(`https://${GRAPH_API_HOST}/${options.apiVersion}/${options.wabaId}/message_templates`);
  url.searchParams.set("name", name);
  url.searchParams.set("limit", "50");
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Meta's `name` filter matches by prefix, so a query for `wedding_rsvp_attending_followup` also
 * returns `..._website`, `..._single`, and `..._website_single`. Every requested name here is a
 * prefix of at least one other, so the exact match has to be re-established locally.
 */
export function exactNameMatches(entries: readonly GraphTemplate[], name: string) {
  return entries.filter((entry) => entry.name === name);
}

function idRank(entry: GraphTemplate) {
  const id = typeof entry.id === "string" ? entry.id : "";
  return /^\d+$/.test(id) ? BigInt(id) : -1n;
}

/**
 * Newest first. Meta assigns template ids in ascending order at creation time and does not return a
 * creation timestamp, so the id is the only recency signal available. Approval status is never part
 * of the ordering: a PENDING template outranks an APPROVED one when it was created later.
 */
export function compareTemplateRecency(left: GraphTemplate, right: GraphTemplate) {
  const leftId = idRank(left);
  const rightId = idRank(right);
  if (leftId === rightId) return (left.language ?? "").localeCompare(right.language ?? "");
  return leftId > rightId ? -1 : 1;
}

export function selectLatestTemplate(entries: readonly GraphTemplate[]) {
  return [...entries].sort(compareTemplateRecency)[0];
}

function unique(values: readonly (string | undefined)[]) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function graphErrorFrom(status: number, body: unknown) {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const message = typeof error?.message === "string" ? error.message : `Graph API responded with HTTP ${status}.`;
  const code = typeof error?.code === "number" ? error.code : undefined;
  return new WhatsappTemplateExportError(message, status, code);
}

function retryAfterMs(response: globalThis.Response, attempt: number) {
  const header = response.headers.get("retry-after");
  if (header && /^\d+$/.test(header)) return Number(header) * 1_000;
  return 500 * 2 ** (attempt - 1);
}

/** `paging.next` is echoed by Meta; only follow it when it still points at the Graph API. */
function nextPageUrl(body: Record<string, unknown>) {
  const paging = isRecord(body.paging) ? body.paging : undefined;
  const next = typeof paging?.next === "string" ? paging.next : undefined;
  if (!next) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(next);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== GRAPH_API_HOST) return undefined;
  // The token travels in the Authorization header; drop any copy Meta echoed into the query string.
  parsed.searchParams.delete("access_token");
  return parsed.toString();
}

async function fetchPage(
  url: string,
  token: string,
  options: ExportWhatsappTemplatesOptions,
  fetchImpl: typeof globalThis.fetch,
  sleep: (ms: number) => Promise<void>
): Promise<{ data: GraphTemplate[]; next?: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    let response: globalThis.Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
      });
    } catch (cause) {
      lastError = new WhatsappTemplateExportError(
        cause instanceof Error ? `Request failed: ${cause.message}` : "Request failed."
      );
      if (attempt === options.maxAttempts) break;
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? (JSON.parse(text) as unknown) : {};
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      const error = graphErrorFrom(response.status, body);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === options.maxAttempts) throw error;
      lastError = error;
      await sleep(retryAfterMs(response, attempt));
      continue;
    }

    if (!isRecord(body) || !Array.isArray(body.data)) {
      throw new WhatsappTemplateExportError("Graph API returned an unexpected payload shape.", response.status);
    }
    const data = body.data.filter(isRecord) as GraphTemplate[];
    if (data.length !== body.data.length) {
      throw new WhatsappTemplateExportError("Graph API returned a non-object template entry.", response.status);
    }
    return { data, next: nextPageUrl(body) };
  }
  throw lastError instanceof Error ? lastError : new WhatsappTemplateExportError("Request failed.");
}

async function fetchTemplate(
  name: string,
  token: string,
  options: ExportWhatsappTemplatesOptions,
  fetchImpl: typeof globalThis.fetch,
  sleep: (ms: number) => Promise<void>
) {
  const requestUrl = templateExportRequestUrl(options, name);
  const collected: GraphTemplate[] = [];
  let url: string | undefined = requestUrl;
  for (let page = 0; page < options.maxPages && url; page += 1) {
    if (page > 0 && options.delayMs > 0) await sleep(options.delayMs);
    const result: { data: GraphTemplate[]; next?: string } = await fetchPage(url, token, options, fetchImpl, sleep);
    collected.push(...result.data);
    url = result.next;
  }
  return { requestUrl, collected };
}

export function readAccessTokenFromEnv(env: Record<string, string | undefined> = process.env) {
  const token = env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("Missing required environment variable WHATSAPP_ACCESS_TOKEN.");
  return token;
}

export async function runExportWhatsappTemplates(
  options: ExportWhatsappTemplatesOptions,
  dependencies: ExportWhatsappTemplatesDependencies = {}
): Promise<WhatsappTemplateExport> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = dependencies.now ?? (() => new Date());
  const log = dependencies.log ?? ((message: string) => console.log(message));
  const token = (dependencies.getAccessToken ?? (() => readAccessTokenFromEnv()))();

  const templates: Record<string, WhatsappTemplateExportEntry> = {};
  const errors: WhatsappTemplateExportFailure[] = [];
  const missing: string[] = [];

  for (const [index, name] of options.names.entries()) {
    if (index > 0 && options.delayMs > 0) await sleep(options.delayMs);
    try {
      const { requestUrl, collected } = await fetchTemplate(name, token, options, fetchImpl, sleep);
      const versions = exactNameMatches(collected, name).sort(compareTemplateRecency);
      const latest = selectLatestTemplate(versions) ?? null;
      templates[name] = {
        name,
        requestUrl,
        matchCount: versions.length,
        statuses: unique(versions.map((entry) => entry.status)),
        languages: unique(versions.map((entry) => entry.language)),
        latest,
        versions,
        otherNameMatches: unique(collected.map((entry) => entry.name)).filter((other) => other !== name)
      };
      if (versions.length === 0) {
        missing.push(name);
        log(`- ${name}: not found in this WhatsApp Business Account.`);
      } else {
        log(
          `- ${name}: ${versions.length} version(s), latest ${latest?.id ?? "unknown"} ` +
            `[${latest?.status ?? "unknown"}] ${latest?.language ?? "unknown"}`
        );
      }
    } catch (cause) {
      const failure: WhatsappTemplateExportFailure = {
        name,
        message: cause instanceof Error ? cause.message : "Unknown failure.",
        status: cause instanceof WhatsappTemplateExportError ? cause.status : undefined,
        code: cause instanceof WhatsappTemplateExportError ? cause.code : undefined
      };
      errors.push(failure);
      console.error(`- ${name}: FAILED — ${failure.message}${failure.status ? ` (HTTP ${failure.status})` : ""}`);
    }
  }

  return {
    exportedAt: now().toISOString(),
    apiVersion: options.apiVersion,
    wabaId: options.wabaId,
    requested: options.names.length,
    succeeded: Object.keys(templates).length,
    failed: errors.length,
    missing,
    templates,
    errors
  };
}

export function writeWhatsappTemplateExport(result: WhatsappTemplateExport, outputFile: string) {
  const target = resolve(process.cwd(), outputFile);
  writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return target;
}

async function main() {
  const options = parseExportWhatsappTemplatesArgs(process.argv.slice(2));
  console.log(`Exporting ${options.names.length} WhatsApp template(s) from ${options.apiVersion}/${options.wabaId}`);
  const result = await runExportWhatsappTemplates(options);
  const target = writeWhatsappTemplateExport(result, options.outputFile);
  console.log(
    `Wrote ${target}: ${result.succeeded} fetched, ${result.missing.length} missing, ${result.failed} failed.`
  );
  if (result.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "WhatsApp template export failed.");
    process.exitCode = 1;
  });
}
