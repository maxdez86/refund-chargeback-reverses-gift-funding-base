# Brimax Life — Improvement backlog

Written 2026-09-04 against `master` at `c426451`. Every claim below was checked in source on that
commit; file paths are the places a reviewer should open to confirm the problem exists.

Each item serves two goals at once:

1. **A real problem for the wedding or the platform** — something the couple, an operator, or a guest
   would notice, explained so a non-engineer reviewer can approve it.
2. **A benchmark task candidate** — a change whose *core* is hard for a coding agent because of hidden
   invariants, cross-cutting constraints, or domain edge cases, and whose behaviour can be observed by
   isolated Vitest tests that never touch the network.

The second goal is deliberately not "make the rubric strict". The retired DynamoDB task taught that a
task a strong model finds straightforward cannot be pushed under a 0.50 mean by rubric breadth alone.
So every item names **where the difficulty actually lives** and lists **independent observable cases**
(each one: a triggering input, an observable output, a reason a naive attempt gets it wrong). An item
with fewer than six such cases is marked as too small to stand alone and is paired with a neighbour.

## How to read an item

| Field | Meaning |
|---|---|
| **Problem** | The real-life or operational problem, in plain language. |
| **Change** | What gets built. |
| **Touches** | Files and layers the change crosses. |
| **Where it is hard** | The invariants and edge cases a naive implementation misses. This is the benchmark value. |
| **Observable cases** | Independent, unit-testable behaviours a grader can probe. |
| **Size** | S (≤300 lines, 1–3 files), M (300–900 lines), L (>900 lines; split before delivery). |
| **Task id** | Proposed `snake_case` id for the task ledger. |
| **Needs** | Items that must land first. |

Priority is a judgment on the product side (`P1` = do before the wedding), not on benchmark value.

---

## Summary

Rows are ordered by benchmark tier (tiers 1 and 1b in mining order), not by area. Tier 1b holds
the former tier 2 items promoted after the second investigation; F7 is new.

| # | Area | Task id | Product priority | Benchmark tier | Benchmark difficulty | Size |
|---|---|---|---|---|---|---|
| B1 | Payments | `refund_reverses_gift_funding` | P1 | 1 | High | M |
| D1 | WhatsApp | `brazilian_ninth_digit_phone_match` | P1 | 1 | High | S–M |
| H2 | Storage | `phone_lookup_stale_row_cleanup` | P1 | 1 (D1 variant) | Medium | S |
| E2 | Admin/Auth | `google_sso_open_signup_with_approval` | P2 | 1 | High | M |
| F1 | Guest | `rsvp_dietary_restrictions` | P1 | 1 | High | M |
| A1 | Security | `invitation_lookup_rate_limit` | P1 | 1 | High | M |
| C1 | Gifts | `admin_gift_catalog_backend` | P1 | 1 (pause slice) | High | M–L |
| B3 | Payments | `late_confirmation_never_oversells` | P1 | 1b | High | M |
| D7 | WhatsApp | `assign_unmatched_whatsapp_message` | P2 | 1b | High | S–M |
| F7 | Guest | `admin_confirm_keeps_child_age_unknown` | P2 | 1b | High | S–M |
| D2 | WhatsApp | `whatsapp_opt_out_compliance` | P1 | 1b | High | M |
| A2 | Security | `lookup_proof_key_rotation` | P2 | 1b | High | S–M |
| A3 | Security | `admin_token_revocation_cutoff` | P2 | 2 | High | S–M |
| A4 | Security | `guest_message_hold_queue` | P1 | 2 | High | M |
| E1 | Admin/Auth | `admin_viewer_role_field_redaction` | P2 | 2 | High | S–M |
| H3 | Storage | `invitation_delete_cascade_completeness` | P2 | 2 | High | M |
| B2 | Payments | `mercado_pago_provider_port` | P2 | 3 | High | L (3 tasks) |
| D3 | WhatsApp | `admin_whatsapp_template_management` | P2 | 3 | High | M–L |
| D4 | WhatsApp | `whatsapp_live_conversation_feed` | P2 | 3 | High | L (2 tasks) |
| D5 | WhatsApp | `whatsapp_inbound_media_archive` | P2 | 3 | Medium–High | M |
| D6 | WhatsApp | `whatsapp_quiet_hours_and_pacing` | P2 | 3 | High | M |
| D8 | WhatsApp | `whatsapp_send_kill_switch` | P2 | 3 | Medium | S–M |
| E3 | Admin/Auth | `admin_audit_trail` | P2 | 3 | Medium | M |
| F2 | Guest | `live_stream_page_gated` | P2 | 3 | Medium–High | M |
| F3 | Guest | `guest_area_otp_login` | P3 | 3 | High | M–L |
| F4 | Guest | `seating_plan_backend` | P2 | 3 | High | M |
| H1 | Storage | `dashboard_scan_to_query_migration` | P2 | 3 | High | M |
| H4 | Ops | `whatsapp_webhook_queue_alarms` | P1 | 3 | Medium | S |
| C2 | Gifts | `gift_recommendation_ranker` | P3 | 4 | Medium–High | S–M |
| F5 | Guest | `auto_seating_solver` | P3 | 4 | High | M |
| F6 | Guest | `music_suggestion_dedupe` | P3 | 4 | Medium–High | S |
| G1 | Data/ML | `guest_demographics_dashboard` | P3 | 4 | Medium–High | M |
| G2 | Data/ML | `carpool_matching` | P3 | 4 | High | M |
| G3 | Data/ML | `attendance_forecast_for_catering` | P3 | 4 | Medium–High | S–M |

Items A1, B1, B3, C1, D1, D2, F1, F7, H2 and H4 are the ones I would ship regardless of the benchmark.

Benchmark tier (see the next section) is the order in which items should be *mined for tasks*; it is
independent of product priority. Tier 1 = a found defect with a refusal or load shape, six or more
cases, an M-or-smaller diff, and a pinned observable surface. Tier 4 = ideas I invented rather than
defects I found; they stay on the product side only.

---

## Benchmark prioritisation

Re-scored on 2026-09-04 against the "benchmark factory" method (one problem, many variants; a found
defect, not a wish; human-grade before trusting a score; five checks and a fair grader). That method
selects on five filters, cheap to expensive, and the product priority column above is not one of them:

1. **A found defect, not a wish.** Its two entry points are a *refusal* (code that says no and explains
   why) and a *shared thing under load* (a counter, queue, cache, or pool). "Make this faster" is sent
   back as a wish.
2. **Six independent cases**, or the defect dies before any grader is written.
3. **Runs must finish.** A large diff hits the step limit, the most common rejection. L and M–L items
   must be split or dropped.
4. **A different correct fix must score ≥ 80 %.** A pinned domain output (a number in gift state, a
   match result, a verify result) grades the problem. New routes, schemas and screens invite grading
   the author's naming.
5. **Crowding.** One defect per part of the repository; leave a crowded area. The task ledger already
   holds sixteen brimax tasks, seven of them WhatsApp and four dashboard. D3–D8 sit in the most crowded
   place in the codebase.

The method also wants **fewer problems with a ladder of variants**, not thirty-four rows. The
practical reading is: mine the six tier 1 problems below, then the five tier 1b problems, each with named variants
(`variant-2-harder`, `variant-3-less-context`), before touching tier 2. Every run gets a one-sentence
hypothesis written *before* it; the ones below are the starting hypotheses.

### Tier 1 — mine first

| Item | Entry point | Starting hypothesis (what the agent gets wrong, and why) | Variant ladder |
|---|---|---|---|
| **B1** `refund_reverses_gift_funding` | Refusal: the transition table already permits `CHARGEBACK → CONFIRMED`; repository comments warn about double-decrement races. | It reverses `quantity × partValueCents` and misses the exact final quota; it flips the status but never `fullyFunded`; it decrements outside the versioned transaction. | v1 full refund on a single gift · v2 exact-final-quota refund · v3 chargeback then dispute won with the part resold · v4 less context: drop the mention of exact quotas from the prompt. |
| **D1** `brazilian_ninth_digit_phone_match` (+ **H2** as its write-side variant) | Refusal: `whatsappPhonesMatch` is exact-digit *by documented design*; the runbook admits the stale lookup row. | It fixes the match function and not the lookup key, so inbound still lands unassigned; or it strips the 9 from landlines too. | v1 read-side match · v2 write-side canonical key + legacy row still resolving · v3 (=H2) phone change with a shared number · v4 less context: "replies from known guests land in the unassigned pile". |
| **E2** `google_sso_open_signup_with_approval` | Refusal, the purest in the repo: `getAdminAuthEnv()` throws "must be exactly brimax.life"; the contract pins `hostedDomain` as a literal. | It relaxes the authorizer's `hd` check and never finds the startup guard or the contract literal, so a correct-looking change fails at cold start and the frontend contract test. | v1 accept approved consumer accounts · v2 keep Workspace auto-approval · v3 access request must not leak pending vs unknown · v4 less context: describe only the planner's Gmail symptom. |
| **F1** `rsvp_dietary_restrictions` | Missing mode: contract fields exist and are `min(1)`; the form never sends them. | It wires the form and misses that the idempotency digest turns a resubmission into a replay; it counts WhatsApp-confirmed guests as "no restriction" instead of "unknown"; it sends `""` and trips `min(1)`. | v1 collect + aggregate · v2 resubmission after the answer changed · v3 WhatsApp-confirmed household · v4 admin edit path (`sameAnswer`). |
| **A1** `invitation_lookup_rate_limit` | Shared thing under load: a per-caller counter on a route whose handler deliberately races the read against verification. | It counts *after* the read is issued; it inherits the Turnstile no-op path; it lets two Lambdas both reset on success. | v1 miss counter · v2 lock must not change the response body or timing · v3 concurrent reset race · v4 keep the "one gated read" invariant the handler documents. |
| **C1** `admin_gift_catalog_backend` — **pause slice only** | Shared thing under load: the reservation transaction. Refusal: `buildQuotaSelection` throws on invalid selections. | It pre-reads `paused` and then reserves, leaving the race; it blocks in-flight checkouts from confirming while paused. | v1 pause enforced in the transaction condition · v2 pending checkout still confirms · v3 price cut below sold parts refused · The CRUD, photo upload and seed semantics are tier 2/3 product work, not part of this task. |

### Tier 1b — promoted after a second investigation

Each former tier 2 item was re-read in source on 2026-09-04 looking for the same three things the
tier 1 items have: a refusal or a shared thing under load, a pinned observable surface, and six or
more independent cases inside an M-or-smaller diff. Five items had them once the scope was cut to the
defect. They enter the mining order **after** the six tier 1 items, in this order.

| Item | What the investigation found | Starting hypothesis | Variant ladder |
|---|---|---|---|
| **B3** → `late_confirmation_never_oversells` (was `payments_reconciliation_worker`) | A found defect, not a wish. `applyWebhookUpdate` already handles "confirm after the reservation was released" (`reservationStillHeld`), but it then adds `partsFunded += quantity` **unconditionally**. If the released parts were resold, the gift is over-funded (`partsFunded > totalParts`, hidden by `Math.max(0, …)` in `getGifts`). The sweeper expires a checkout Asaas may already have received; `getPaymentById` and `listPaymentsByExternalReference` exist on the client but the worker never asks. Load shape: three writers on one gift state (sweeper, webhook, new checkout). | It adds an availability check before the increment but leaves the arithmetic outside the conditional transaction, so two late confirms still over-fund; or it refuses the `EXPIRED → CONFIRMED` transition and loses the record that a guest paid. | v1 late confirm with room → re-consumed, counters consistent · v2 no room → `RECOVERY_HOLD`, payment `CONFIRMED`, gift untouched · v3 exact-final-quota part resold → hold · v4 sweeper consults the provider port: paid → apply `CONFIRMED`, not `EXPIRED`; provider unreachable → defer, never expire · v5 less context: only "a guest paid and the gift shows the part as sold to someone else". Rule: keep the sweep summary shape and the transaction structure. |
| **D7** `assign_unmatched_whatsapp_message` | A missing mode with four refusals around it. There is **no route at all** that lists unassigned messages; only the repository method exists. `WhatsappMessageInputSchema` refuses `invitationCode` without `matched` and vice versa. `putWhatsappMessage` is a conditional put, so assignment must be an update that moves the GSI1 entry. `touchWhatsappLastInboundAt` is monotonic. The runbook rule "matched records avoid redundant phone storage" means `senderPhone` must be **removed** on assignment. | It rewrites the item with a put (fails the conditional), leaves `senderPhone` in place, and sets `whatsappLastInboundAt` unconditionally so an old message rewinds the 24 h window. | v1 list + assign moves GSI1 atomically · v2 `senderPhone` removed · v3 older message does not rewind the window; newer one advances it · v4 `ambiguous_sender` resolved without touching the other household · v5 deleted invitation refused, re-assign to the same code idempotent, to a different code 409 · v6 less context: "attach this message to Aunt Lúcia". Rule: keep the item schema and the index layout; no branch routing re-run. |
| **F7** (new) `admin_confirm_keeps_child_age_unknown` | A found defect inside the schemas. `RsvpGuestAnswerSchema.isChildSixOrYounger` is a required boolean and the same schema is reused for the stored item, so "unknown" cannot be stored. `AdminGuestRsvpService.confirmGuests` therefore synthesises `false` for a seeded criança, and the dashboard's `courtesyState` reads `false` as "Não · 7 anos ou mais" — an answer nobody gave. The model's own comment promises an "awaiting" state that can never appear after confirm-all. The tests pin the current behaviour, so the task must change them. | It makes the field optional on the request as well as the item and breaks the website form's contract; or it stores `undefined` but changes the paid count (the rule is: unknown still pays). | v1 confirm-all stores no age, response omits it, count still `paid: 1` · v2 guest answers later on the site → `true` → courtesy · v3 admin PATCH explicit `false` → paying · v4 legacy stored `false` stays paying (compat pinned) · v5 export row `isChildSixOrYoungerConfirmed` undefined · v6 less context: "the panel says a child is paying before anyone answered". Rule: keep `deriveRsvpCounts`. |
| **D2** `whatsapp_opt_out_compliance` | Refusal anchors already exist: `queueAutoTemplate` throws 409 from `deriveWhatsappRsvpSendAvailability`, whose reason enum is a contract; the worker refuses at claim time; the fallback text auto-reply is enqueued on any correlated non-button inbound. Opt-out is a new reason on an existing surface, not a new endpoint. | It refuses at enqueue only, so already-queued commands still send; and it lets the "Ops! sou um assistente virtual" fallback answer the very message that said "PARAR". | v1 inbound "parar"/"sair"/"não quero mais" (accent- and case-folded) sets opt-out · v2 `sendAvailability` gains `opted_out`, first and resend refused · v3 queued command fails at claim with reason `opted_out`, flow not moved to `failed` · v4 fallback suppressed for the opt-out message · v5 operator free text inside the window still allowed (policy pinned) · v6 less context. Rule: keep the availability contract shape; re-opt-in is a variant, not the core. |
| **A2** `lookup_proof_key_rotation` | A documented operational gap: the WhatsApp webhook runbook says rotating the shared JSON secret "can also regenerate `lookupProofSecret`, so plan rotation around the 30-minute lifetime", and that caches hold the old value for five minutes. Refusal anchor: the verifier. Hidden invariant: the five-minute secret cache, so the "previous key" window must exceed it. | It adds a `kid` but drops legacy proofs on deploy, or accepts an unknown `kid` by falling back to the current key; it forgets the cache and sizes the overlap to the proof TTL alone. | v1 current key · v2 previous key until its expiry · v3 legacy (no `kid`) until `legacyUntil` · v4 unknown `kid` rejected in constant time · v5 extra segment rejected before HMAC · v6 overlap ≥ proof TTL + cache TTL · v7 less context: "rotate without logging guests out". Rule: keep the header name and the two-segment shape for legacy. |

### Tier 2 — re-scoped, ready when tier 1 and 1b are mined out

The remaining four items keep real anchors but are feature-shaped or wide. Each is cut to the slice
with a pinned surface; the rest of the original idea stays product work.

| Item | Re-scoped slice | Anchor found | Cases |
|---|---|---|---|
| **A3** → `admin_token_revocation_cutoff` (was a full session-token system) | No new token format. A `revokedBefore` timestamp, global and per Google `sub`, read by the authorizer; a token whose `iat` predates it is denied. One owner-only route sets it. | The authorizer function has **no table grant** today (`app-stack.ts:360` block), so the read is a CDK change the stack test pins. The 30 s `resultsCacheTtl` is a rule to keep: an agent that disables the cache to make revocation instant fails the "keep it fast" rule. | 7: before/after cutoff, global vs per-sub, missing `iat` denied, missing item allows, cache kept, owner-only route, context shape unchanged. |
| **E1** → `admin_viewer_role_field_redaction` (was roles + policy matrix) | One extra role, `viewer`, sourced from an `adminRoles` map in the existing JSON app secret; the authorizer adds `role` to its context; `GET /admin/dashboard` and the WhatsApp status route omit phone numbers and message bodies for viewers; every mutating admin handler answers 403 for viewers. | The status history schema already **refuses bodies on command entries** by `superRefine`; redaction extends a mechanism that exists. Every admin response is `.strict()`, so redaction must omit optional fields, never blank required ones, and `admin-contract.test.ts` must still pass. | 8: dashboard phone omitted, previews omitted, status history bodies omitted, strict parse still valid, owner byte-identical, unknown role denied, viewer PATCH/DELETE/POST 403 in the handler, session reports role. |
| **H3** → `invitation_delete_cascade_completeness` (was LGPD erasure) | Extend `deleteInvitationCascade` rather than build an erasure system. Today it deletes the lookup row of the **current** phone only, leaves unassigned messages that carry the household's `senderPhone` and body, and reports `phoneLookups` as `max(1)` in a strict contract. | No index maps an invitation to its historical phones (lookup rows are keyed by phone), so an agent that "deletes the old row too" has nothing to read from. Two correct designs exist (phone history on the invitation item, or a scan) and the grader must observe the rows, not the mechanism. | 7: current row gone, previous-phone row gone, shared-number row for the other household kept, unassigned messages from those numbers anonymised, counts truthful, markers untouched (TTL, pinned), second delete 404. **Needs** D1/H2 so stale rows have a source of truth. |
| **A4** → `guest_message_hold_queue` (was moderation queue + classifier) | Messages that contain a link or a phone number are held; held messages never appear in the public feed; an admin approve route moves them into the feed at their **original** `createdAt`. The profanity classifier is a variant, not the core. | The feed is one partition with `MESSAGE#createdAt#id` keys and the public route pages by cursor; a held message must live in a separate partition or paging breaks. The two-step delete already exists as the reference write. | 7: link held, phone in any spacing held, clean message public, held invisible on every page, approve keeps order, delete works on held, notification email states the bucket. |

**Demoted to tier 3:** **F4** `seating_plan_backend`. No defect, refusal, or shared resource anchors
it; the count rules it would depend on are the subject of F7, which is the defect-shaped kernel of the
idea. Seating stays product work.

### Tier 3 — product work, weak benchmark

D3, D4, D5, D6, D8, E3, F2, F3, B2, H1, H4. Features or wishes. **H1** is the "make it faster" shape
the method sends back. **H4** has five cases. **B2** and **D4** are large, span several tasks, and grade
against vendor contracts the grader must mock. **D3–D8** sit in the crowded WhatsApp area. Build them
for the wedding; do not open them as tasks until the tier 1 problems are mined out.

### Tier 4 — invented, skip for the benchmark

C2, F5, F6, G1, G2, G3. Pure functions I proposed rather than defects I found. They would fail the
first gate however well they grade. Keep them as product ideas only.

### Two corrections this re-scoring makes to the rest of this document

- Several "Where it is hard" lists lean on a strict grader catching conventions the prompt never
  states (route names, a specific status code). That is the dial that gets tasks rejected. The safe
  dial is removing detail from the prompt while an expert could still finish: the prompt states the
  observable behaviour and the rule to keep, and the grader probes only those.
- The retired DynamoDB task was feature-shaped and in the crowded WhatsApp area. Both are things this
  method would have flagged at stage 1, which is the argument for the tier order above.

---

## A. Security

### A1 · `invitation_lookup_rate_limit` — per-source rate limiting and lockout on invitation lookup

**Problem.** `GET /invitation/{code}` returns the household name and every guest's name for a valid
code. Codes are two letters from a 24-letter alphabet plus four digits from `2–9`
([invitation-code.ts](../packages/contracts/src/invitation-code.ts)): about 2.4 million combinations.
The only protections are a Cloudflare Turnstile token per request and API Gateway route throttling
(`ThrottlingRateLimit: 2`, `ThrottlingBurstLimit: 5` in
[app-stack.ts](../infra/cdk/lib/stacks/app-stack.ts)). Throttling is account-wide, not per caller, so
one abusive client degrades the route for every real guest, and Turnstile alone does not stop a
patient enumeration.

**Change.** A sliding-window counter per source IP and per invitation code, stored in the single table
with a TTL, checked before the DynamoDB read. Too many misses lock the code for a cooling period. A
success resets the counter. Turnstile stays.

**Touches.** `apps/api/src/functions/invitation-get/handler.ts`, a new `domain/lookup-rate-limit.ts`,
`services/dynamodb/key-builder.ts`, `services/dynamodb/repositories/wedding-repository.ts`, CDK IAM
(the function only has `grantReadData` today, at `app-stack.ts:757`; the counter needs a write grant
and the stack test pins the policy), tests.

**Where it is hard.**
- The handler currently starts the DynamoDB read *concurrently* with Turnstile and gates the response
  on verification. The limiter must be evaluated before the read is issued, or the "cost one gated read"
  invariant the handler comments describe is broken.
- `verifyTurnstile` is a no-op when `APP_SECRET_ARN` is unset (local and unit tests). The limiter must
  not inherit that escape hatch.
- Source identity: use `requestContext.http.sourceIp`, never `X-Forwarded-For`. IPv6 must be
  normalised (compressed form) or the same client gets many buckets.
- The 429 response must not leak whether the code exists: the same status and message whether the code
  is valid, invalid, or locked, and no timing difference from skipping the read.
- Atomic counter with `ADD` and a `ttl` that extends on each miss but never below the window; a
  conditional write so two Lambdas cannot both "reset on success" and drop a concurrent miss.
- Keys must go through `key-builder.ts`; the `reset:wedding:fresh-start` script classifies PK prefixes
  and must learn the new prefix or it reports the rows as `UNEXPECTED`.

**Observable cases.** (1) N misses within the window → 429 on the N+1th, valid code included.
(2) A hit resets the miss count. (3) Window expiry frees the client. (4) Two IPv6 spellings share a
bucket. (5) The Turnstile no-op path still enforces the limit. (6) The read is not issued when locked
(mock repository call count). (7) The 429 body is identical for existing and non-existing codes.
(8) Fresh-start classifier recognises the prefix.

**Size.** M. **Needs.** —

### A2 · `lookup_proof_key_rotation` — versioned HMAC keys for the RSVP lookup proof

**Reframed for the benchmark (tier 1b).** Anchored to the documented rotation gap in the WhatsApp webhook runbook and to the five-minute secret cache; see the tier 1b table for the hypothesis and ladder.

**Problem.** The RSVP form is authorised by a 30-minute HMAC proof
([lookup-proof.ts](../apps/api/src/lib/lookup-proof.ts)) signed with one secret. Rotating that secret
today invalidates every guest mid-form and there is no way to retire a key gracefully. The verifier
also splits on `.` without checking for extra segments and accepts any `exp` type at parse time.

**Change.** Proofs carry a key id (`kid`). The app secret holds a current key plus an optional
previous key with an expiry. Issuance uses the current key; verification accepts either until the
previous key's expiry. Proofs without a `kid` are treated as legacy and accepted only while a
`legacyUntil` timestamp allows.

**Where it is hard.**
- Three-way compatibility (legacy, previous, current) with a hard cutoff for each, tested at the
  boundaries.
- The header format is `payload.signature`; adding `kid` must keep a fixed segment count and reject a
  proof with an extra or missing segment before any HMAC work.
- Constant-time compare on every path, including the "kid unknown" path (no early return that leaks).
- The secret cache ([secret-cache.ts](../apps/api/src/services/secrets-manager/secret-cache.ts))
  caches the bucket; a rotation must become visible within a bounded time without a cold start.
- `exp` and `invitationCode` must be validated as types before use; `JSON.parse` on a crafted
  payload must not throw through the handler.

**Observable cases.** (1) Current-key proof accepted. (2) Previous-key proof accepted before expiry,
rejected after. (3) Legacy proof accepted before `legacyUntil`, rejected after. (4) Unknown `kid`
rejected. (5) Extra segment rejected. (6) Code mismatch rejected with the existing message.
(7) Non-numeric `exp` rejected. **Size.** S–M.

### A3 · `admin_session_tokens_with_revocation` — exchange the Google ID token for a server session

**Reframed for the benchmark (tier 2, as `admin_token_revocation_cutoff`).** The full session-token system stays product work. The task slice is a `revokedBefore` cutoff read by the authorizer, which today has no table grant, with the 30 s cache kept as a rule.

**Problem.** The dashboard sends the raw Google ID token as the bearer on every admin call. It lives up
to an hour, cannot be revoked by the couple, and the authorizer caches decisions for 30 s
([google-workspace-admin-sso.md](runbooks/google-workspace-admin-sso.md)). If a laptop is lost, there
is no "sign everyone out".

**Change.** `POST /admin/session` verifies the Google token once and issues a short server-signed
session token with a `sid` stored in DynamoDB. The authorizer verifies the session token and checks a
revocation flag. `DELETE /admin/session` and `POST /admin/sessions/revoke-all` exist.

**Where it is hard.** Two token formats during rollout (the authorizer must accept Google tokens until
the frontend ships); the authorizer's `context` contract (`subject`, `email`, `hostedDomain`, …) is
consumed by `AdminSessionResponseSchema.strict()` and must be preserved exactly; sliding vs absolute
expiry; the 30 s cache means revocation takes effect late unless the cache key changes (the
`identitySource` and `resultsCacheTtl` in CDK); token binding to `sub`, not email; clock skew
tolerance; never logging the token. **Observable cases** ≥ 8. **Size.** M. **Needs.** — (E1/E2
build on it).

### A4 · `guest_message_moderation_queue` — hold public wall posts for approval

**Reframed for the benchmark (tier 2, as `guest_message_hold_queue`).** The classifier is a variant. The task slice is the hold partition, the cursor-safe public feed, and approval that preserves the original order.

**Problem.** "Recados" is a public wall: anything a guest posts appears to everyone immediately
([guest-message-service.ts](../apps/api/src/domain/guest-message-service.ts)). Turnstile blocks bots
but not a person pasting a phone number, a link, or something offensive. The admin can delete after
the fact only.

**Change.** New messages enter `pending`. A pure classifier assigns `auto_approved`, `needs_review`, or
`auto_rejected` from rules (links, phone numbers, repeated characters, profanity list with accent and
leetspeak folding, all-caps ratio). The public list returns only approved messages. Admin approve/reject
routes exist; the notification email says which bucket the message landed in.

**Where it is hard.**
- pt-BR text: fold diacritics with NFD before matching, but match on **word boundaries** so `Cunha`
  is not flagged; handle `c*ralho`-style masking, repeated vowels, and zero-width characters.
- The public `GET /guest-messages` uses a cursor over `GUEST_MESSAGES` feed keys; pending messages must
  not be in the feed at all (a separate `GUEST_MESSAGES#PENDING` feed) or paging breaks when a page is
  entirely pending.
- Approving moves the item between feeds atomically and must keep the original `createdAt` ordering,
  not the approval time.
- The dashboard already lists all messages; `AdminDashboardResponseSchema` is `.strict()` and
  `GuestMessageSchema` gains a `status` — every consumer (fixtures, web tests, `admin-contract.test.ts`)
  must agree.
- The existing delete route must work on both feeds.

**Observable cases.** (1) Clean message auto-approved and visible. (2) Link → review, invisible
publicly. (3) Phone number in any spacing → review. (4) Profanity with accents/leetspeak → rejected.
(5) `Cunha`-type false positive not flagged. (6) Approve preserves feed order. (7) Cursor pagination
skips nothing when pending items exist. (8) Delete works on pending. **Size.** M.

---

## B. Payments

### B1 · `refund_reverses_gift_funding` — refunds and chargebacks must give the quota back

**Problem.** When a payment is refunded or charged back, the payment status moves to `REFUNDED` /
`CHARGEBACK` ([payment-state.ts](../apps/api/src/domain/payment-state.ts)), but the gift's
`partsFunded` is never decremented and `fullyFunded` never flips back
([payment-repository.ts](../apps/api/src/services/dynamodb/repositories/payment-repository.ts):
`applyWebhookUpdate` only consumes on CONFIRMED/RECEIVED and releases on EXPIRED/CANCELED/FAILED;
`incrementGiftFunding` has no counterpart). The payer name silently disappears from the admin list
(it filters on CONFIRMED/RECEIVED), so the couple sees a gift "complete" that nobody paid for and
another guest cannot buy the freed part.

**Change.** A reversal path that returns the exact quota values of the reversed payment to the gift
state, recomputes `fullyFunded`, and records the reversal on the reservation. The transition table
already allows `CHARGEBACK → CONFIRMED` (dispute won), which must re-consume.

**Where it is hard.**
- `EXACT_FINAL_QUOTA` gifts have a final part with a different value; the reversal must return the
  *specific* `quotaValuesCents` of that payment, not `quantity × partValueCents`.
- Partial refunds: Asaas can refund less than the full value. A partial refund must not release any
  part unless the remaining paid amount no longer covers the parts (policy to pin in the prompt).
- Idempotency: the same refund webhook arrives twice; a `CHARGEBACK` then `REFUNDED` sequence must
  release once.
- `fullyFunded` was set by a second unconditional `UpdateCommand`; the reversal has to be a conditional
  transaction on the gift `version` like `reserveGiftSelection`, or two concurrent reversals
  double-decrement (the repository's own comments warn about this race for releases).
- `CHARGEBACK → CONFIRMED` re-consume must fail if the freed part was meanwhile sold to someone else,
  and the operator needs a signal (`RECOVERY_HOLD` exists in the reservation vocabulary).
- Thank-you notification (`payment-message-service`) must be refused after reversal (409).

**Observable cases.** (1) Full refund on a single gift → `partsFunded 1→0`, `fullyFunded false`.
(2) Refund of the final exact part returns `finalPartValueCents`. (3) Duplicate refund event → no
second decrement. (4) Partial refund below threshold → no release. (5) Chargeback then dispute won →
re-consumed. (6) Dispute won but part resold → hold, not double-sold. (7) Payer name excluded after
reversal. (8) Message route 409 after reversal. **Size.** M. **Needs.** —

### B2 · `mercado_pago_provider_port` — add Mercado Pago beside Asaas (three tasks)

**Problem.** Guests trust and already have Mercado Pago; Asaas is unknown to most of them and the
hosted checkout looks foreign. Asaas is welded into the code: field names (`asaasPaymentId`,
`asaasCheckoutId`), the GSI1 lookup keys `ASAAS#PAYMENT#…` / `ASAAS#CHECKOUT#…`
([key-builder.ts](../apps/api/src/services/dynamodb/key-builder.ts)), the webhook auth header
`asaas-access-token`, the status vocabulary in `mapAsaasWebhookToPaymentStatus`, and the
[webhook-processor.ts](../apps/api/src/domain/webhook-processor.ts) recovery logic that calls Asaas to
resolve unknown references.

**Change (split).**
1. **`payment_provider_port`** — a `PaymentProvider` interface (create checkout, fetch payment, build
   checkout URL, parse webhook), Asaas moved behind it byte-for-byte, and provider-neutral storage
   (`providerPaymentId`, `provider`, GSI1 `PROVIDER#<name>#PAYMENT#<id>`) with **read compatibility for
   every existing `ASAAS#` row** — no data migration.
2. **`mercado_pago_checkout_and_webhook`** — Checkout Pro preference creation (`external_reference`,
   `expires` + `expiration_date_to`, `back_urls`, `notification_url`, `payer.email` required), webhook
   verification with the `x-signature` header (`ts=…,v1=…`, HMAC-SHA256 over
   `id:{data.id};request-id:{x-request-id};ts:{ts};`), and the fact that a Mercado Pago webhook is
   **not self-describing** — it carries only `data.id` and `action`, so the processor must fetch the
   payment before mapping.
3. **`dual_provider_cutover`** — a `PAYMENTS_PROVIDER` setting per stage, open Asaas checkouts still
   resolving after the switch, and admin visibility of the provider per payment.

**Where it is hard (the trap list a reviewer should insist on).**
- Mercado Pago has **no `expired` status**: an expired PIX arrives as `status: cancelled` with
  `status_detail: expired`. Mapping `cancelled` blindly to `CANCELED` makes the checkout-expiry worker
  and the reservation release disagree with the provider.
- `approved` must be gated on `status_detail: accredited`; `in_process` ↔ `PROCESSING`;
  `rejected` ↔ `FAILED`; `refunded` vs `charged_back`; partial refunds show as
  `transaction_amount_refunded < transaction_amount` with status still `approved`.
- Amounts are decimals in BRL; `0.1 + 0.2` style float drift when grouping quota values — build from
  cents and format with two decimals, never multiply floats.
- `date_approved` is ISO with an offset (`-04:00` or `-03:00`); today's `normalizeSettlementDate`
  accepts only `YYYY-MM-DD`. The settlement date must be the **America/Sao_Paulo calendar day**, not
  the UTC day.
- Webhook idempotency today is `sha256(rawBody)`. Mercado Pago retries with the same body, but it also
  sends many distinct `payment.updated` events for one payment; the event id must be the provider's
  `id` + `action`, with a TTL longer than the 24 h Asaas markers use.
- `init_point` vs `sandbox_init_point` by stage; the dev stage must never produce a production
  checkout link.
- Recovery in the processor currently asks Asaas for unknown references; the port must route recovery
  to the provider recorded on the shell, and an event for the *wrong* provider must be rejected, not
  looked up in both.

**Observable cases.** Well over ten across the three tasks (status matrix alone is nine). **Size.** L,
split as above. **Needs.** B1 first (so reversal semantics exist before a second provider).

### B3 · `payments_reconciliation_worker` — catch the webhooks that never arrived

**Reframed for the benchmark (tier 1b, as `late_confirmation_never_oversells`).** The investigation found a defect rather than a wish: `applyWebhookUpdate` increments `partsFunded` unconditionally on a confirmation that arrives after the reservation was released, so a resold part is counted twice. The reconciliation call becomes the sweeper's safe fallback (ask the provider before expiring), not a separate worker.

**Problem.** The repo already ships `diagnose-asaas-webhook.mjs` and a webhook sync script because
webhook delivery was unreliable during rollout. A missed `CONFIRMED` leaves a guest's gift "pending" and
the reservation waiting for the expiry sweeper, which will then **release a paid part**.

**Change.** A scheduled worker lists open payments older than a threshold, fetches provider status, and
feeds the same `shouldApplyStatusTransition` + `applyWebhookUpdate` path a webhook would.

**Where it is hard.** Must reuse the exact transition and consume/release code (no parallel
implementation); paginate the provider API with a rate cap; skip payments younger than the checkout
expiry grace; never send the thank-you notification twice (`acquireNotificationSend` semantics);
partial-batch failures; the expiry sweeper and this worker racing on the same reservation (conditional
`version`). **Observable cases** ≥ 7. **Size.** M. **Needs.** — (B2 if both providers).

---

## C. Gifts

### C1 · `admin_gift_catalog_backend` — make the gift screen real

**Problem.** The admin "Presentes" screen lets the operator create a gift, edit price and photo, and
pause a gift, but all of it dispatches to the in-browser store only
([admin-dashboard-store.ts](../apps/web/src/lib/admin-dashboard-store.ts) `create-gift` /
`save-gift`). There is no admin gift route in the API or CDK, `paused` is not in
[`GiftSchema`](../packages/contracts/src/gifts.ts), and the catalogue is a hard-coded list in
[packages/config/src/gifts.ts](../packages/config/src/gifts.ts) that `GiftService.getGifts()` iterates
by id — a gift added only in DynamoDB is invisible.

**Change.** `POST/PATCH/DELETE /admin/gifts`, `paused` and `sortOrder` in the contract, `GiftMetadata`
as the source of truth (config list becomes the seed), photo upload to the media bucket via a
presigned URL, and the public `GET /gifts` hiding paused gifts.

**Where it is hard.**
- Editing a fractional gift's price when parts are already funded or reserved: `totalParts` may not
  drop below `partsFunded + partsReserved`; `finalPartValueCents` must be recomputed for
  `EXACT_FINAL_QUOTA`; switching `fractional` on a gift with any payment must be refused.
- **Pause must be enforced inside the reservation transaction** (a condition on the metadata item),
  not by a pre-read, or a checkout started a millisecond before the pause still reserves. In-flight
  checkouts must still confirm via webhook while paused.
- `getGifts()` must stop iterating `PAYMENT_GIFTS` and list metadata instead, while
  `batchGetGiftCatalog` (BatchGet, 100-key limit) and the "metadata missing" drift warning keep their
  meaning.
- `AdminGiftSchema` and `AdminDashboardResponseSchema` are `.strict()`; the web fixtures and
  `admin-contract.test.ts` pin the shape.
- Deleting is allowed only with zero payments and zero reservations, and must not orphan the state
  item.
- `reset:gifts:catalog` and `seed:gifts:catalog` semantics change: seed must not overwrite an
  operator-edited gift.

**Observable cases.** (1) Create → visible in public list. (2) Pause → hidden publicly, reservation
refused with 409 inside the transaction. (3) Paused gift's pending checkout still confirms. (4) Price
raise on funded gift recomputes parts and unflags `fullyFunded`. (5) Price cut below sold parts
refused. (6) Toggle `fractional` with payments refused. (7) Delete with reservation refused. (8) Seed
does not overwrite an edited gift. **Size.** M–L. **Needs.** —

### C2 · `gift_recommendation_ranker` — order the gift carousel for the guest

**Problem.** The carousel shows the same order to every guest. Expensive fractional gifts with many
parts left sit next to cheap gifts that are almost done; guests skim past the ones that need help.

**Change.** A pure ranking function: prefer gifts whose remaining amount is small relative to total
(closer to completion), demote fully funded and paused, spread price bands, and keep a deterministic
tie-break. Optionally personalise by the guest's earlier choice stored in the browser.

**Where it is hard.** Deterministic ordering with stable ties; not recommending gifts with zero
available parts even when `fullyFunded` is false (reserved parts); `EXACT_FINAL_QUOTA` remaining
amount uses the final part value; band spreading without starvation; cold-start behaviour identical to
the current `sortGifts`. **Observable cases** 6–7. **Size.** S–M. Pairs with C1.

---

## D. WhatsApp

### D1 · `brazilian_ninth_digit_phone_match` — correlate inbound messages from numbers with or without the 9

**Problem.** Brazilian mobile numbers gained a leading `9` in 2012–2016. WhatsApp still reports some
accounts with the **old 8-digit form** in `wa_id`, so an invitation stored as `5511912345678` receives
a reply from `551112345678` and the message lands in the unassigned pile.
[whatsapp-phone-match.ts](../apps/api/src/domain/whatsapp-phone-match.ts) is exact-digit by design and
the lookup row `WHATSAPP_PHONE#<phone>` is keyed by the exact string.

**Change.** A canonical form for Brazilian mobiles (country code 55, two-digit area code, then the
9-prefixed 8 digits) used for lookup rows and matching; both spellings resolve to the same invitation;
non-Brazilian numbers untouched.

**Where it is hard.**
- Only **mobile** numbers get the 9; landlines (`55 11 3xxx-xxxx`) must not. The rule depends on the
  first digit after the area code.
- Numbers with a `0` trunk prefix (`0 11 …`) or `+55 (11) 9…` formatting.
- The lookup row key changes shape → existing rows must still resolve (dual lookup, then a backfill
  script) without creating duplicates; the `phone` update route must write the canonical key.
- Two invitations that already share the same canonical number must both be returned (the repository
  supports multiple).
- Never log the phone; tests must not contain a real number.

**Observable cases.** (1) 8-digit `wa_id` matches 9-digit stored. (2) Landline not altered.
(3) Formatted input canonicalised. (4) Non-BR number untouched. (5) Legacy lookup row still resolves.
(6) Backfill is idempotent. (7) Shared-number households both returned. **Size.** S–M.

### D2 · `whatsapp_opt_out_compliance` — honour "stop" replies

**Reframed for the benchmark (tier 1b).** Opt-out is a new reason on the existing `sendAvailability` contract and a claim-time refusal in the worker; the fallback auto-reply must be suppressed. Re-opt-in is a variant.

**Problem.** Meta pauses or bans numbers with poor quality ratings; `wedding_rsvp_pending_reminder_group`
is a MARKETING template subject to opt-outs ([whatsapp-rsvp.md](runbooks/whatsapp-rsvp.md)). Today a
guest who replies "não quero mais receber" keeps receiving templates.

**Change.** Inbound text matching an opt-out vocabulary sets `whatsappOptOut` on the invitation with
timestamp and source message id; sending any template to an opted-out invitation is refused **at send
time in the worker**, not only at enqueue; the dashboard shows the state and lets an operator record a
re-opt-in with a reason.

**Where it is hard.** Vocabulary normalisation (accents, case, punctuation, "PARAR", "SAIR", "STOP",
"não quero", "remover"); a queued command for an invitation that opts out after enqueue must fail with
reason `opted_out` and must not move the flow to `failed` as a provider error would; utility vs
marketing policy pinned in the prompt; opt-out must not block the operator's free-text reply inside the
24 h window (a human answering "ok, removido"); the flow state machine
([whatsapp-flow-state.ts](../apps/api/src/domain/whatsapp-flow-state.ts)) needs a terminal-safe
transition. **Observable cases** ≥ 8. **Size.** M.

### D3 · `admin_whatsapp_template_management` — manage templates from the dashboard

**Problem.** Templates are seeded and activated with `pnpm whatsapp:template …` from a laptop with
production credentials ([step-3-whatsapp-template-seeding.md](runbooks/step-3-whatsapp-template-seeding.md)).
The couple cannot see which version is active or roll back without an engineer.

**Change.** Admin routes to list purposes with versions and the active pointer, create an immutable
version from components, activate a version, and refresh Meta approval status from the Graph API.

**Where it is hard.**
- The manifest in [template-manifest.ts](../apps/api/src/services/whatsapp/template-manifest.ts) is
  **code**, and the variable derivation in `whatsapp-template-variables.ts` and the quick-reply
  `buttonId → action` routing in the webhook depend on it. A version created from the UI must be
  validated against the manifest's slots and button ids or replies to the new template cannot be
  routed. This code/data split is the core difficulty.
- `parameterFormat` named vs positional and the `WhatsappStoredComponentSchema` refinements
  (quick-reply needs a static `buttonId`, URL button needs exactly one text parameter).
- Activation is only allowed for a Meta status of `APPROVED`; `PENDING` and `PAUSED` (quality) are not
  activatable, and the export marks PENDING as approved only for the initial seed.
- Versions are immutable (`createVersion` is conditional); the UI must show a conflict, not overwrite.
- Production gating equivalent to `--confirm-prod`: an explicit confirmation field in the request.

**Observable cases** ≥ 8. **Size.** M–L. **Needs.** E1 if role-gated.

### D4 · `whatsapp_live_conversation_feed` — live updates in the admin chat (two tasks)

**Problem.** Inbound messages are stored by the webhook worker, but the chat panel only refreshes when
the operator opens a thread or presses "Atualizar dados". During the RSVP campaign the operator
answers dozens of guests and misses replies.

**Change (split).**
1. **`whatsapp_recent_activity_cursor`** — a `GET /admin/whatsapp/updates?since=<cursor>` route
   returning conversation summaries changed after the cursor, plus the frontend long-poll.
2. **`whatsapp_websocket_push`** — API Gateway WebSocket, connection registry item with TTL, fan-out from
   the webhook worker, reconnect with catch-up through task 1's cursor.

**Where it is hard.** A message item already uses its single GSI1 slot for the per-invitation timeline
(`INVITATION#code / WHATSAPP#ts…`), so a global "recent" index cannot be another attribute on the same
item — it needs either a new GSI (data stack change, one GSI mutation per deploy) or a separate feed
item written in the same transaction as the message. Unread counts must keep the "trailing inbound
run" rule the summary and the loaded thread share. The free-text window (`whatsappFreeTextWindow`)
must be re-derived on push. WebSocket `$connect` cannot carry an `Authorization` header from a browser,
so auth moves to a one-time ticket; stale connections return 410 and must be pruned. **Observable cases**
≥ 8 per task. **Size.** L. **Needs.** A3 (tickets) for task 2.

### D5 · `whatsapp_inbound_media_archive` — keep the photos and audios guests send

**Problem.** The parser already recognises audio, image, video, document and sticker events
([webhooks.ts](../packages/contracts/src/webhooks.ts)), but the media is never downloaded. Meta media
URLs expire in minutes, so a voice note from a grandparent is lost.

**Change.** The webhook worker fetches the media through the Graph API, verifies the `sha256` from the
event, stores it in the media bucket under a key derived from the message id, records mime and size on
the message item, and the dashboard shows it through short-lived presigned URLs.

**Where it is hard.** Two-step Meta fetch (metadata → binary) with the access token; sha256 mismatch
must reject; size caps; idempotency when the webhook is retried after the upload succeeded; the message
item schema strips unknown keys on parse, so the new fields must be modelled or they vanish; presigned
URL TTL shorter than the session; never log the URL or the phone; retention policy stated (the
runbook forbids TTLs without a plan). **Observable cases** ≥ 7. **Size.** M.

### D6 · `whatsapp_quiet_hours_and_pacing` — do not message guests at 23:00

**Problem.** `whatsapp-rsvp-auto-send` can enqueue every pending invitation at once. Sending at night
or hundreds per minute harms the sender quality rating and annoys guests.

**Change.** Sends outside 08:00–21:00 America/Sao_Paulo are deferred; marketing templates get a daily
cap; the worker re-enqueues deferred commands with a delay.

**Where it is hard.** SQS delay is capped at 15 minutes, so "send at 08:00" is a loop of deferrals or an
EventBridge Scheduler entry, and each hop must be idempotent on the command; the time zone must come
from IANA rules, not a hard-coded `-03:00`; the cap counts **sent**, not enqueued, and resets on the
local calendar day; a deferred command must not consume a worker attempt (`WHATSAPP_WORKER_MAX_ATTEMPTS`)
or age into the DLQ; operator manual sends may bypass quiet hours with an explicit flag.
**Observable cases** ≥ 8. **Size.** M.

### D7 · `assign_unmatched_whatsapp_message` — attach an unassigned message to an invitation

**Reframed for the benchmark (tier 1b).** No route lists unassigned messages today. Four existing refusals anchor the task: the item-schema refinement, the conditional put, the monotonic inbound timestamp, and the runbook rule that matched records carry no phone.

**Problem.** Messages from unknown numbers sit in `WHATSAPP#UNASSIGNED` and never reach a thread. The
operator can see them but cannot say "this is Aunt Lúcia".

**Change.** `POST /admin/whatsapp/unassigned/{messageId}/assign` with an invitation code; optionally
records the phone on the invitation.

**Where it is hard.** The item's `correlationStatus` and `invitationCode` refinement in
[whatsapp-items.ts](../apps/api/src/services/dynamodb/whatsapp-items.ts) forbids one without the
other; GSI1 must move from the unassigned index to the conversation index in one transaction; the
invitation's `whatsappLastInboundAt` must be touched so the 24 h window opens; a deleted invitation
must be refused; assigning must be idempotent; the unread rule applies. **Observable cases** 6–7.
**Size.** S–M.

### D8 · `whatsapp_send_kill_switch` — pause all sends from the dashboard

**Problem.** Stopping sends today means disabling the SQS event-source mapping in the AWS console
(runbook). The couple cannot do that.

**Change.** A `SETTINGS#whatsapp` item with `sendsPaused`; the worker checks it at claim time; the
dashboard toggle with audit.

**Where it is hard.** Paused commands must stay `queued` and return to the queue with a delay through
SQS partial-batch failure semantics, not be marked `failed`; the claim/in-flight rules in the runbook
must hold; the setting read must be cheap (one read per batch, not per message). **Observable cases**
6. **Size.** S–M. Pairs with D6.

---

## E. Admin and authentication

### E1 · `admin_roles_and_field_redaction` — more than one kind of admin

**Reframed for the benchmark (tier 2, as `admin_viewer_role_field_redaction`).** One role, sourced from the existing JSON app secret, and field-level redaction on two read routes plus 403 on writes. The status history schema already refuses bodies on command entries, which is the mechanism to extend.

**Problem.** Every member of the `brimax.life` Workspace is a full admin. The wedding planner and the
caterer need read access without phone numbers or the ability to delete invitations.

**Change.** Roles `owner`, `planner`, `viewer` stored per Google `sub`; the authorizer adds `role` to
the context; a route policy matrix; **field-level redaction** of phone numbers and WhatsApp bodies for
`viewer`.

**Where it is hard.** Redaction must keep every `.strict()` response schema valid (omit optional
fields, never blank required ones) and the frontend contract test must still pass; the export CSV
route needs the same redaction; the authorizer cache means a demotion lags 30 s; the owner must be
bootstrapped from configuration so a fresh table is not lockout; policy must be enforced in the
handler, not only in CDK route wiring, so a test can prove it. **Observable cases** ≥ 8. **Size.** M–L.
**Needs.** A3 recommended.

### E2 · `google_sso_open_signup_with_approval` — any Google account, with approval

**Problem.** The planner has a Gmail account. The authorizer requires `hd=brimax.life`
([admin-google-auth.ts](../apps/api/src/lib/admin-google-auth.ts)) and `getAdminAuthEnv()` in
[env.ts](../apps/api/src/lib/env.ts) **throws at startup** unless the hosted domain is exactly
`brimax.life`; `AdminSessionResponseSchema` pins `hostedDomain` as a literal.

**Change.** Verified Google accounts without `hd` may request access; an owner approves; the authorizer
allows approved `sub`s; Workspace members stay auto-approved.

**Where it is hard.** Three hidden invariants to loosen without weakening: the env guard, the literal in
the contract, and the `email_verified` check that must stay mandatory; the access-request route must
verify the Google token itself (it cannot sit behind the authorizer) and must not leak whether a `sub`
is pending vs unknown; identity is `sub`, not email, and an email change on an approved account must
not create a second identity; pending users must get a clear UI state though the authorizer can only
allow/deny. **Observable cases** ≥ 8. **Size.** M. **Needs.** E1 for the role of approved accounts.

### E3 · `admin_audit_trail` — who changed what

**Problem.** Admin writes (guest status edits, invitation deletes, phone changes, gift edits) leave no
record of the actor.

**Change.** An `AUDIT#<day>` item per mutation with actor `sub`/email from the authorizer context, the
route, the subject id, and a redacted before/after; a dashboard screen.

**Where it is hard.** Actor must come from `requestContext.authorizer.lambda`, never from the body;
`deleteInvitationCascade` already issues many writes and a transaction is capped at 100 items, so the
audit write needs a placement strategy that survives partial failure; ordering key must be
`ISO#ulid`, never `Date.now()`; phone numbers and bodies redacted. **Observable cases** 6–7.
**Size.** M. Pairs with E1.

---

## F. Guest experience

### F1 · `rsvp_dietary_restrictions` — ask about allergies and diets

**Problem.** The caterer needs counts of vegetarians, vegans, coeliacs and allergies. The contract
already has `mealPreference` and `dietaryNotes`
([rsvp.ts](../packages/contracts/src/rsvp.ts), [guest.ts](../packages/contracts/src/guest.ts)) but
the RSVP form never collects them ([RSVP.tsx](../apps/web/src/components/sections/RSVP.tsx) sends only
`isChildSixOrYounger` and the music note).

**Change.** Per attending guest: a restriction enum (multi-select) plus optional free text; a dashboard
aggregate; a caterer export.

**Where it is hard.** The RSVP write is idempotent on a payload digest, so a resubmission with new
dietary data must be a new operation, not a replay; the admin edit path compares answers by content
(`sameAnswer`) and must include the new fields; a guest confirmed through **WhatsApp** has no meal
answer, and the aggregate must count them as "unknown", not "none"; children ≤ 6 have no adult meal;
free text sanitised the way `extractFirstName` sanitises (control characters, whitespace) and empty
strings omitted because the schema is `min(1)`; declined guests excluded. **Observable cases** ≥ 8.
**Size.** M.

### F2 · `live_stream_page_gated` — a stream page for guests who cannot travel

**Problem.** Relatives abroad want to watch. A public stream link would be shared beyond the guest
list.

**Change.** `/ao-vivo` with three states by server time (before: countdown; live: embedded player;
after: replay). The embed URL comes from an API route that requires a valid invitation lookup proof and
only answers inside the event window.

**Where it is hard.** Server-side time gating (client clocks are untrusted); the event is 15:00 BRT
(18:00 UTC) and the ICS in `Local.tsx` is the source of truth for start/end; the lookup proof lives 30
minutes but the stream lasts hours, so the route needs a distinct longer-lived scope or a refresh
path; CloudFront response headers policy needs `frame-src` for the player in the edge stack; the
privacy page must mention the stream. **Observable cases** 6–7. **Size.** M.

### F3 · `guest_area_otp_login` — a private area for guests

**Problem.** Surprises for guests, table numbers, and transport details should not be public. Guests
have no login.

**Change.** Invitation code + one-time code sent by WhatsApp template (the send infrastructure exists);
short-lived guest session; a private page.

**Where it is hard.** OTP hashing, expiry, attempt limits, and rate limiting (reuse A1's limiter); a
phone shared by several invitations returns several households (the repository already does) so the
guest must choose; opt-out (D2) must block the OTP template; the OTP template must exist in the
manifest (D3's code/data split again); the guest session must not be confused with the admin
authorizer. **Observable cases** ≥ 8. **Size.** M–L. **Needs.** A1, D2.

### F4 · `seating_plan_backend` — tables and seats

**Demoted to tier 3.** No defect or refusal anchors seating. The count rules it depends on are the defect-shaped kernel, now F7.

**Problem.** The couple plans tables in a spreadsheet that drifts from the RSVP data.

**Change.** Tables with capacity; assignment of guests; invariants enforced server-side; export in
table order.

**Where it is hard.** A household stays at one table unless explicitly split; capacity counts attending
adults and children ≥ 7 differently from children ≤ 6 (policy pinned); a guest who later declines is
unassigned automatically but the history is kept; two operators moving guests concurrently (version per
table); pt-BR collation for name ordering (`localeCompare("pt-BR")`, accents). **Observable cases**
≥ 8. **Size.** M.

### F5 · `auto_seating_solver` — propose a seating plan

**Problem.** With 150 guests, placing families, friend groups and "keep apart" pairs by hand takes
evenings.

**Change.** A pure solver over F4's data with hard constraints (capacity, household together,
must-not-sit-with) and soft preferences (affinity groups), producing a deterministic plan.

**Where it is hard.** Greedy assignment violates hard constraints on realistic fixtures; the solver must
report infeasibility instead of silently dropping a guest; determinism for identical input; bounded
runtime inside a Lambda. **Observable cases** 6–8 with fixtures. **Size.** M. **Needs.** F4.

### F6 · `music_suggestion_dedupe` — one list for the DJ

**Problem.** Suggestions are free text (`"Evidências - Chitãozinho & Xororó"` vs
`"evidencias chitaozinho e xororo"`) stored inside the RSVP note with a prefix
([rsvp.ts](../packages/contracts/src/rsvp.ts) `MUSIC_NOTE_PREFIX`). The dashboard lists duplicates and
cannot rank popularity.

**Change.** Normalisation (NFD fold, case, punctuation, `feat.`/`ft.`, artist–title order) and fuzzy
grouping with a representative string and a count; DJ export.

**Where it is hard.** Diacritics folding without breaking `ç`; swapped artist/title order; edit-distance
threshold that groups near-duplicates but not different songs by the same artist; a stable
representative (first submitted). A follow-up task moves music out of `note` into its own field while
still reading legacy prefixed notes. **Observable cases** 6–7. **Size.** S.

### F7 · `admin_confirm_keeps_child_age_unknown` — do not invent a child's age when the operator confirms

**Problem.** When the operator presses "confirmar todos" on a household with a seeded criança,
[admin-guest-rsvp-service.ts](../apps/api/src/domain/admin-guest-rsvp-service.ts) synthesises
`isChildSixOrYounger: false` for that child, because
[`RsvpGuestAnswerSchema`](../packages/contracts/src/rsvp.ts) makes the field a required boolean and
the same schema is reused for the stored answer. The dashboard's `courtesyState` then shows
"Não · 7 anos ou mais" as if the family had answered, and the "Aguardando confirmação do convidado"
state the model documents can never appear after an admin confirmation. The caterer count is right
by accident (unknown pays), the operator's view is wrong.

**Change.** Store no age answer when none was given: the stored answer's `isChildSixOrYounger`
becomes optional while the website request keeps it required; counts treat unknown as paying;
the response and export omit the field; the tests that pin the synthesised `false` change with it.

**Where it is hard.** One Zod schema serves the request and the item, so the split must not break
the website form's contract or the RSVP idempotency digest; `sameAnswer` must treat `undefined` and
`false` as different; legacy rows already holding a synthesised `false` cannot be told apart and stay
paying; `deriveRsvpCounts` is the rule to keep.

**Observable cases.** (1) Confirm-all stores no age and omits it in the response. (2) Count still
`paid: 1`. (3) Later website answer `true` → courtesy. (4) Admin PATCH explicit `false` → paying.
(5) Legacy `false` rows unchanged. (6) Export row `isChildSixOrYoungerConfirmed` undefined.
(7) Website request without the field still rejected. **Size.** S–M. **Needs.** —

---

## G. Data and machine learning

### G1 · `guest_demographics_dashboard` — who is coming, in aggregate

**Problem.** Planning transport, the kids' corner and the bar needs age bands, home region and whether
guests drive. None of that exists on the guest item.

**Change.** Operator-entered or imported profile fields (age band, side, relationship, CEP, has car);
distance to the venue from CEP; aggregate cards and histograms.

**Where it is hard.** CEP has eight digits with leading zeros (`01310-100`) and must never be stored as
a number; geocoding without network in tests → a geocoder port with a static CEP-prefix centroid
table and haversine; aggregates only, with a small-count floor so a bucket never identifies one
person; the export row schema changes.

**A note for the reviewer.** Religion is sensitive personal data under LGPD (art. 5, II); gender is
personal data with limited planning value. I recommend **not** collecting religion and keeping gender
out of the profile; age band, region and transport need are enough for the stated goals and are
defensible under purpose limitation. **Observable cases** 6–7. **Size.** M.

### G2 · `carpool_matching` — match guests without a car to guests with seats

**Problem.** The venue is in São Paulo and many guests come from far; parking is limited (FAQ).

**Change.** A pure matching function over G1's data: drivers with free seats and riders within a radius
and on the way; households ride together; deterministic output; an operator-editable result.

**Where it is hard.** Greedy nearest-neighbour strands riders; households must not split; declined
guests excluded; seat counts include children; radius from haversine on G1's centroids; deterministic
ties. **Observable cases** 6–8. **Size.** M. **Needs.** G1.

### G3 · `attendance_forecast_for_catering` — expected headcount with uncertainty

**Problem.** The caterer wants a number weeks before every RSVP is in. Pending invitations are not
zero and confirmed ones are not one hundred percent.

**Change.** A transparent scoring model (logistic-style weights on flow status, read receipts,
response latency, history) producing an expected count and an interval, with the weights in
configuration and a calibration test on fixtures.

**Where it is hard.** No training at runtime; correct handling of every `whatsappFlowStatus` value
including `reconciliation_required`; declined is not "0.05"; households count per guest; the interval
must widen with pending share; deterministic. **Observable cases** 6–7. **Size.** S–M.

---

## H. Storage and operations

### H1 · `dashboard_scan_to_query_migration` — stop scanning the whole table for the dashboard

**Problem.** `listAdminDashboardInvitations` and `exportGuests` run a **full-table Scan** with a
filter ([wedding-repository.ts](../apps/api/src/services/dynamodb/repositories/wedding-repository.ts)),
reading every payment, webhook marker and command item to find invitations. It gets slower and more
expensive with every WhatsApp message.

**Change.** A second GSI on `entityType` / `invitationCode#SK`, a paginated, throttled backfill script
for existing items, and a query-based read with the same output ordering.

**Where it is hard.** Adding a GSI is an in-place update but only one GSI mutation per deploy; items
written before the backfill lack the attributes, so the cutover must be gated on a completed backfill
(a settings item) with the Scan as fallback until then; `entityType=WhatsappMessage` is a hot partition
candidate → write-sharded key with fan-in on read; the output must be byte-identical (ordering by
invitation code, skipped-message warning); the data-stack test pins the index. **Observable cases**
≥ 7. **Size.** M.

### H2 · `phone_lookup_stale_row_cleanup` — replacing a phone should not keep the old one resolving

**Problem.** The runbook states it plainly: updating an invitation's phone adds the new
`WHATSAPP_PHONE#<phone>` lookup row but never removes the old one, so a recycled number still routes to
the wrong household.

**Change.** On phone change, remove the previous lookup row in the same transaction **unless another
invitation shares that number**; a dry-run script that lists and removes existing stale rows.

**Where it is hard.** The shared-number case (repository supports multiple invitations per phone);
the transaction must condition on the previous phone still being the stored one; the dry-run must be
safe on production and idempotent; interaction with D1's canonical key. **Observable cases** 6.
**Size.** S. Pairs with D1.

### H3 · `lgpd_household_erasure` — delete a guest's data on request, keep what the law requires

**Reframed for the benchmark (tier 2, as `invitation_delete_cascade_completeness`).** The existing cascade deletes only the current phone's lookup row and leaves unassigned messages carrying the household's phone. There is no invitation-to-phone index, which is the hidden invariant. Needs D1/H2.

**Problem.** After the wedding, guests may ask for erasure. Payments must be kept for fiscal reasons,
WhatsApp bodies should not.

**Change.** `POST /admin/privacy/erasure/{invitationCode}`: delete guest names and phones, tombstone the
invitation, anonymise payer name/email on payments while keeping amounts and dates, drop message bodies
while keeping the timeline, remove all phone lookup rows including stale ones, keep the audit.

**Where it is hard.** Deciding item by item what to keep; the public lookup must answer 404, not a
tombstone with names; unassigned messages still carry the sender phone; GSI entries on message items;
idempotent re-run; the cascade exceeds one transaction. **Observable cases** ≥ 8. **Size.** M.
**Needs.** E3 recommended.

### H4 · `whatsapp_webhook_queue_alarms` — alarm on the queue that has none

**Problem.** The runbook says it: "the separate WhatsApp webhook queue and its terminal markers have no
dedicated alarm." The observability stack alarms on auth errors only.

**Change.** DLQ depth, age-of-oldest-message, and terminal-marker metric filter alarms, stage-specific
names, wired into the composite alarm and dashboard.

**Where it is hard.** A recent commit fixed stage-collided alarm names for checkout expiry — the same
mistake is easy to repeat; `treatMissingData` for sparse traffic; the observability stack test asserts
alarm counts and names. **Observable cases** 5–6 (pair with D8 for a full task). **Size.** S.

---

## Sequencing suggestions

Two different orders, for two different goals.

**Benchmark mining order** (from the tier tables): B1 → D1 with H2 as a variant → E2 → F1 → A1 → C1
pause slice, then the promoted tier 1b items B3 → D7 → F7 → D2 → A2. Each one is mined into a variant
ladder and human-graded before the next is opened. Tier 2 only after these eleven are exhausted; tier 3
and 4 are not opened as tasks.

**Product build order** (what the wedding needs, independent of the benchmark):

- **Payments track:** B1 → B3 → B2 (three tasks).
- **WhatsApp track:** D1 + H2 → D2 → D8 + H4 → D6 → D7 → D3 → D5 → D4.
- **Admin track:** A3 → E1 → E2 → E3 → D3 (if role-gated).
- **Guest track:** F1 → F6 → F4 → F5 → F2 → F3 (F3 after A1 and D2).
- **Data track:** H1 → G1 → G2/G3.
- **Security quick wins:** A1, A4, A2 are independent of everything else.

## What is deliberately not here

- Anything requiring a live provider, Meta, or Google call inside a grader; every item above is
  designed so the network sits behind an injectable port.
- Prompt-level tricks. The difficulty in each item is a property of the domain and the existing code,
  not of a strict rubric.
