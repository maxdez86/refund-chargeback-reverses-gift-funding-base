/**
 * Post-deploy, READ-ONLY production smoke test.
 *
 * Hits only public HTTPS surfaces (the CloudFront site + two anonymous API GETs)
 * and validates them against the shared `@brimax/contracts` Zod schemas. It runs
 * after a prod deploy as a detective control: the site is already live, so a
 * failure surfaces a red GitHub run + native failed-workflow email — it never
 * rolls anything back.
 *
 * SAFETY INVARIANT: this script performs GET requests only. It sends no
 * idempotency-key / proof / webhook-token headers, so it cannot satisfy any
 * mutation endpoint's auth even by accident. The GitHub job that runs it is also
 * configured with `permissions: contents: read` (no `id-token: write`) and no
 * AWS credentials, so it is structurally incapable of mutating prod. Keep both
 * guarantees: do not add writes here, and do not add AWS credentials to the job.
 */
import { appendFile } from "node:fs/promises";
// Import the schemas from their leaf modules rather than the package barrel
// (../packages/contracts/src/index.ts): under tsx + Node's ESM loader the
// `export *` star re-exports in that barrel do not surface named bindings, so a
// barrel import fails at link time with "does not provide an export named ...".
// These two files are still the source of truth for the response shapes.
import { GetGiftsResponseSchema } from "../packages/contracts/src/gifts.ts";
import { ListGuestMessagesResponseSchema } from "../packages/contracts/src/messages.ts";

// Exact strings that must be present in the statically-served index.html. The
// title is asserted by apps/web/tests/shell.test.ts (stable contract); the
// tagline lives in the <meta name="description"> tag. Both use a literal em dash
// (U+2014) — the match string must use the same character.
const PAGE_TITLE = "<title>Brimax — Casamento Brida e Max</title>";
const PAGE_TAGLINE = "Casamento de Brida e Max. 06.12.2026.";

// Per-request hard timeout, and the exponential backoff schedule applied between
// attempts. Up to MAX_ATTEMPTS tries per request; the wait before retry N uses
// RETRY_DELAYS_MS[N-1] (2s, 4s, 8s, 16s; 30s is the documented ceiling).
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];
const MAX_ATTEMPTS = 5;

// Initial settle delay to let edge/DNS propagation catch up right after a deploy.
// Overridable (mostly for local negative-path testing) via SMOKE_INITIAL_DELAY_MS.
const INITIAL_DELAY_MS = Number.parseInt(process.env.SMOKE_INITIAL_DELAY_MS ?? "5000", 10);

type PhaseOutcome = {
  name: string;
  ok: boolean;
  detail: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDomain(envKey: string, fallback: string): string {
  const value = process.env[envKey]?.trim();
  return value && value.length > 0 ? value : fallback;
}

/** Log to stdout and, when running in GitHub Actions, append to the step summary. */
async function report(line: string) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${line}\n`, "utf8");
  }
}

async function safeJson(response: Response): Promise<unknown> {
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

function assertStatus(actual: number, expected: number, phase: string) {
  if (actual !== expected) {
    throw new Error(`${phase} expected HTTP ${expected}, received ${actual}`);
  }
}

function parseWithSchema<T>(
  label: string,
  schema: {
    safeParse(input: unknown):
      | { success: true; data: T }
      | { success: false; error: { message: string } };
  },
  input: unknown
): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(`${label} schema validation failed: ${parsed.error.message}`);
}

/**
 * fetch with a per-attempt timeout and bounded exponential backoff. Always uses
 * `redirect: "manual"` so a misconfigured/removed redirect surfaces as its real
 * 3xx status instead of being silently chased to a 200.
 *
 * Retries on thrown errors (network/TLS/timeout) for every phase. Additionally
 * retries on any status for which `retryStatus` returns true — callers pass a
 * predicate so e.g. a transient 404 is retried on the apex homepage but a clean
 * non-301 on the www redirect (a real misconfig) fails fast.
 */
async function fetchWithRetry(
  url: string,
  retryStatus: (status: number) => boolean
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const isLast = attempt === MAX_ATTEMPTS;
    const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!isLast && retryStatus(response.status)) {
        console.warn(
          `retry ${attempt}/${MAX_ATTEMPTS - 1} for ${url}: HTTP ${response.status}; waiting ${delay}ms`
        );
        await sleep(delay);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (isLast) {
        throw new Error(`${url} failed after ${MAX_ATTEMPTS} attempts: ${message}`);
      }
      console.warn(
        `retry ${attempt}/${MAX_ATTEMPTS - 1} for ${url}: ${message}; waiting ${delay}ms`
      );
      await sleep(delay);
    }
  }
  // Unreachable: the loop either returns or throws on the final attempt.
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runPhase(
  name: string,
  results: PhaseOutcome[],
  fn: () => Promise<string>
) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    await report(`- ✅ PASS \`${name}\`${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail: message });
    await report(`- ❌ FAIL \`${name}\` — ${message}`);
  }
}

async function main() {
  const rootDomain = resolveDomain("ROOT_DOMAIN", "brimax.life");
  const wwwDomain = resolveDomain("WWW_DOMAIN", "www.brimax.life");
  const apiDomain = resolveDomain("API_DOMAIN", "api.brimax.life");
  const rootUrl = `https://${rootDomain}`;
  const wwwUrl = `https://${wwwDomain}`;
  const apiUrl = `https://${apiDomain}`;

  const results: PhaseOutcome[] = [];
  const warnings: string[] = [];

  await report("## Prod public smoke");
  await report("");
  await report(`- root: ${rootUrl}`);
  await report(`- www: ${wwwUrl}`);
  await report(`- api: ${apiUrl}`);
  await report("");

  if (INITIAL_DELAY_MS > 0) {
    await sleep(INITIAL_DELAY_MS);
  }

  // Phase 1 — apex homepage. Retry on network/5xx and a transient 404 (edge may
  // 404 briefly while a fresh deploy propagates).
  await runPhase("frontend-apex", results, async () => {
    const url = `${rootUrl}/`;
    const response = await fetchWithRetry(url, (status) => status >= 500 || status === 404);
    assertStatus(response.status, 200, "frontend-apex");
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      throw new Error(`frontend-apex expected text/html content-type, received "${contentType}"`);
    }
    const body = await response.text();
    if (!body.includes(PAGE_TITLE)) {
      throw new Error("frontend-apex body is missing the expected <title> tag");
    }
    if (!body.includes(PAGE_TAGLINE)) {
      throw new Error(`frontend-apex body is missing the expected tagline "${PAGE_TAGLINE}"`);
    }
    return "200 text/html, title + tagline present";
  });

  // Phase 2 — www → apex 301. Retry only on network/5xx; a clean non-301 is a
  // real misconfig (not propagation), so it must fail fast.
  await runPhase("frontend-www-redirect", results, async () => {
    const url = `${wwwUrl}/`;
    const response = await fetchWithRetry(url, (status) => status >= 500);
    assertStatus(response.status, 301, "frontend-www-redirect");
    const location = response.headers.get("location") ?? "";
    const expected = `${rootUrl}/`;
    if (location !== expected) {
      throw new Error(`frontend-www-redirect expected Location "${expected}", received "${location}"`);
    }
    return `301 → ${location}`;
  });

  // Phase 3 — GET /gifts. Exercises Lambda → DynamoDB → response end-to-end.
  // Empty catalog is WARN-only (a fresh DB is not a deploy failure).
  await runPhase("api-gifts", results, async () => {
    const url = `${apiUrl}/gifts`;
    const response = await fetchWithRetry(url, (status) => status >= 500);
    assertStatus(response.status, 200, "api-gifts");
    const body = await safeJson(response);
    const parsed = parseWithSchema("api-gifts", GetGiftsResponseSchema, body);
    if (parsed.gifts.length === 0) {
      warnings.push("api-gifts: gift catalog is empty (GET /gifts returned 0 gifts)");
    }
    return `200, ${parsed.gifts.length} gift(s), schema valid`;
  });

  // Phase 4 — GET /guest-messages. Empty messages list is normal; never asserted
  // non-empty. The schema check validates ok/messages[]/nextCursor shape.
  await runPhase("api-guest-messages", results, async () => {
    const url = `${apiUrl}/guest-messages`;
    const response = await fetchWithRetry(url, (status) => status >= 500);
    assertStatus(response.status, 200, "api-guest-messages");
    const body = await safeJson(response);
    const parsed = parseWithSchema("api-guest-messages", ListGuestMessagesResponseSchema, body);
    return `200, ${parsed.messages.length} message(s), schema valid`;
  });

  if (warnings.length > 0) {
    await report("");
    await report("### Warnings");
    for (const warning of warnings) {
      await report(`- ⚠️ ${warning}`);
    }
  }

  const failed = results.filter((result) => !result.ok);
  await report("");
  if (failed.length === 0) {
    await report(
      `✅ All ${results.length} phases passed${warnings.length ? ` (${warnings.length} warning(s))` : ""}.`
    );
  } else {
    await report(
      `❌ ${failed.length} of ${results.length} phases failed: ${failed.map((result) => result.name).join(", ")}.`
    );
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await report("");
  await report(`❌ Prod public smoke crashed: ${message}`);
  console.error(error);
  process.exitCode = 1;
});
