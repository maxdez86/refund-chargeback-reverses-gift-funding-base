# Testing: refund reverses gift funding

## Context

The webhook ingress is authenticated with the `asaas-access-token` header, deduplicated by the SHA of the raw body, and dispatched by the `event` field. That shapes how these tests are built.

**Short version:** Asaas sandbox has no button or API to simulate a chargeback, and PIX has no chargeback at all. So you test the chargeback path by posting synthetic webhook payloads to your own dev endpoint, and you test the refund path for real via the sandbox refund API.

**Before you attempt a refund, read [5.0](#50-the-critical-action-gate--read-this-first).** A sandbox refund returns HTTP 200 but is created *unauthorized*; if you do not clear the critical-action gate it silently cancels, no webhook fires, and the gift quota stays funded — which looks exactly like a broken reversal path.

Everything below is copy-paste. **The only value you type by hand is `PAYMENT_ID` in step 1.** Every other id, URL, table, queue, and secret is derived from it into an env var, so run all blocks in the same shell session.

Requires `jq` and `curl`.

## 1. Buy a gift on dev, then seed the session

Run a normal gift checkout on `https://dev.brimax.life` and confirm it. Use a sandbox **test card** for the chargeback blocks in step 4, or **PIX** for the refund blocks in step 5. Let `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` arrive so the reservation is `CONSUMED`.

The browser comes back to `https://dev.brimax.life/#paymentId=<...>&paymentStatus=success`. Copy that `paymentId` and export it — this is the one manual step:

```bash
export PAYMENT_ID="afa3cfd6-8e9e-4254-ad94-f9eefdf6f17a"
```

## 2. Derive everything else

Each block exports; nothing prints a secret.

```bash
export AWS_PROFILE=personal-stg

export STAGE_STACK=dev-BrimaxAppStack

export API_URL=$(aws cloudformation describe-stacks --stack-name "$STAGE_STACK" --query "Stacks[0].Outputs[?OutputKey=='ApiCustomDomainUrl'].OutputValue" --output text)

export TABLE_NAME=$(aws cloudformation describe-stacks --stack-name "$STAGE_STACK" --query "Stacks[0].Outputs[?OutputKey=='WeddingTableName'].OutputValue" --output text)

export WEBHOOK_QUEUE_URL=$(aws cloudformation describe-stacks --stack-name "$STAGE_STACK" --query "Stacks[0].Outputs[?OutputKey=='WebhookQueueUrl'].OutputValue" --output text)

export WEBHOOK_DLQ_ARN=$(aws sqs get-queue-attributes --queue-url "$WEBHOOK_QUEUE_URL" --attribute-names RedrivePolicy --query 'Attributes.RedrivePolicy' --output text | jq -r '.deadLetterTargetArn')

export WEBHOOK_DLQ_URL=$(aws sqs get-queue-url --queue-name "${WEBHOOK_DLQ_ARN##*:}" --query QueueUrl --output text)

export PROCESSOR_LOG_GROUP=/aws/lambda/dev-brimax-AsaasWebhookProcessorFunction

export APP_SECRETS=$(aws secretsmanager get-secret-value --secret-id /dev/brimax/app-secrets --query SecretString --output text)

export ASAAS_API_KEY=$(jq -r '.asaasApiKey' <<<"$APP_SECRETS")

export ASAAS_WEBHOOK_TOKEN=$(jq -r '.asaasWebhookToken' <<<"$APP_SECRETS")

export ASAAS_API=https://api-sandbox.asaas.com/v3

export PAYMENT_ITEM=$(aws dynamodb get-item --table-name "$TABLE_NAME" --key "{\"PK\":{\"S\":\"PAYMENT#${PAYMENT_ID}\"},\"SK\":{\"S\":\"PAYMENT\"}}" --output json)

export ASAAS_PAYMENT_ID=$(jq -r '.Item.asaasPaymentId.S' <<<"$PAYMENT_ITEM")

export GIFT_ID=$(jq -r '.Item.gift.M.id.S' <<<"$PAYMENT_ITEM")
```

Sanity check that the chain resolved (no secrets in this output):

```bash
echo "api=$API_URL table=$TABLE_NAME payment=$PAYMENT_ID asaas=$ASAAS_PAYMENT_ID gift=$GIFT_ID"
```

> If instead of the internal `paymentId` you only have the Asaas id from the sandbox dashboard, export `ASAAS_PAYMENT_ID` first and recover the internal one with a `gsi1` query on `ASAAS#PAYMENT#$ASAAS_PAYMENT_ID`; the rest of the chain is unchanged.

## 3. Capture a genuine payment payload

Asaas sandbox lets you pay with test cards and confirm, but it never emits `PAYMENT_CHARGEBACK_REQUESTED` on its own. There is no "simulate dispute" endpoint, so the synthetic payloads below are built from a real one.

```bash
export ASAAS_PAYMENT=$(curl -s -H "access_token: $ASAAS_API_KEY" "$ASAAS_API/payments/$ASAAS_PAYMENT_ID")
```

```bash
jq . <<<"$ASAAS_PAYMENT"
```

## 4. Chargeback on credit card (synthetic webhooks)

Each event body reuses the real payment object and overrides only `event` and `payment.status`. Dedup is by raw body hash, so every body carries a fresh `id` and `dateCreated` from `date` — that is what keeps the second and third posts from being silently dropped as duplicates.

### 4.1 `PAYMENT_CHARGEBACK_REQUESTED`

```bash
export CB_REQUESTED=$(jq -nc --argjson p "$ASAAS_PAYMENT" --arg id "evt_test_cb_req_$(date +%s)" --arg now "$(date '+%Y-%m-%d %H:%M:%S')" '{id:$id,event:"PAYMENT_CHARGEBACK_REQUESTED",dateCreated:$now,payment:($p|.status="CHARGEBACK_REQUESTED")}')
```

```bash
curl -s -X POST "$API_URL/webhooks/asaas" -H "content-type: application/json" -H "asaas-access-token: $ASAAS_WEBHOOK_TOKEN" -d "$CB_REQUESTED"
```

### 4.2 `PAYMENT_CHARGEBACK_DISPUTE`

```bash
export CB_DISPUTE=$(jq -nc --argjson p "$ASAAS_PAYMENT" --arg id "evt_test_cb_dis_$(date +%s)" --arg now "$(date '+%Y-%m-%d %H:%M:%S')" '{id:$id,event:"PAYMENT_CHARGEBACK_DISPUTE",dateCreated:$now,payment:($p|.status="CHARGEBACK_DISPUTE")}')
```

```bash
curl -s -X POST "$API_URL/webhooks/asaas" -H "content-type: application/json" -H "asaas-access-token: $ASAAS_WEBHOOK_TOKEN" -d "$CB_DISPUTE"
```

### 4.3 `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`

This is the reversal signal matched by `isChargebackReversalSignal`. It is the **only** signal that lifts a chargeback: it maps to `CONFIRMED`, bypasses the stale-confirmation guard, and **reinstates** the funded parts. Expect a `PAYMENT_STATE_TRANSITION` log line, the reservation back to `CONSUMED` with `reversedParts = 0`, and the gift's `partsFunded` back **up**.

`CHARGEBACK_CONFIRMATION_IGNORED` is *not* emitted here. That metric belongs to the opposite case — a plain `PAYMENT_CONFIRMED` or `PAYMENT_RECEIVED` redelivered onto a payment already in `CHARGEBACK`, which must be ignored so a redelivery cannot re-fund parts the acquirer took back. To see that branch, post 4.1 and then replay an ordinary confirmation body.

No email is sent on reinstatement: `isDisputeReinstatement` suppresses the payer/couple notifications that already went out on the original confirmation.

```bash
export CB_REVERSAL=$(jq -nc --argjson p "$ASAAS_PAYMENT" --arg id "evt_test_cb_rev_$(date +%s)" --arg now "$(date '+%Y-%m-%d %H:%M:%S')" '{id:$id,event:"PAYMENT_AWAITING_CHARGEBACK_REVERSAL",dateCreated:$now,payment:($p|.status="AWAITING_CHARGEBACK_REVERSAL")}')
```

```bash
curl -s -X POST "$API_URL/webhooks/asaas" -H "content-type: application/json" -H "asaas-access-token: $ASAAS_WEBHOOK_TOKEN" -d "$CB_REVERSAL"
```

> **Check the gift state between 4.1, 4.2 and 4.3, not only at the end.** Run the step 6 gift query after each post. Across the full sequence `partsFunded` goes down on 4.1, stays put on 4.2 (the second `CHARGEBACK` is a deliberate no-op), and comes back up on 4.3 — so a single reading taken after 4.3 looks identical to never having run the test at all.

> **Never send an empty `-d`.** If the variable is undefined the shell posts an empty body. The ingress now rejects that with `400 {"message":"Empty request body."}` and records nothing, so it can no longer reach the queue — but the post still did not test anything, so confirm each `export` produced a body before posting:
>
> ```bash
> jq -e '.event' <<<"$CB_REVERSAL" >/dev/null || echo "EMPTY — do not post"
> ```

> `ASAAS_WEBHOOK_TOKEN` came out of Secrets Manager into an env var and is never printed. Do not paste it into a commit or a shared shell history file.

## 5. Refund on PIX and credit card (real, end to end)

This one is real: sandbox refunds a confirmed payment and Asaas fires the genuine `PAYMENT_REFUNDED`. Use a payment you have **not** run the chargeback blocks against — reseed from step 1 with a fresh checkout if needed.

### 5.0 The critical-action gate — read this first

**A refund request returning HTTP 200 does not mean the money moved.** On this sandbox account, refunds are subject to Asaas's *critical action authorization* (2FA). The `POST /refund` call succeeds and returns the payment with a refund entry, but that entry is created as:

```json
"refunds": [{ "status": "AWAITING_CRITICAL_ACTION_AUTHORIZATION", "value": 50.0, "effectiveDate": null }]
```

Until you authorize it, the refund is not executed. After a few minutes Asaas flips it to `CANCELLED` and **fires no webhook at all** — not `PAYMENT_REFUNDED`, not `PAYMENT_REFUND_DENIED`. The platform is never told, so the payment stays `RECEIVED`, the reservation stays `CONSUMED`, and the gift quota stays funded. That is correct behaviour for "no refund happened", and it is indistinguishable from a broken reversal path if you only look at DynamoDB.

The processor also filters pending refunds out of the amount it trusts — `usableRefunds` counts only entries whose `status` is `DONE` or absent — precisely so an unauthorized refund can never un-fund a gift.

There is no sandbox API for this: `/v3/criticalActionConfirmations` and every sibling path return 404. **Authorization is console-only.**

#### Preflight

Confirm the payment can actually be refunded before you spend an attempt:

```bash
curl -s -H "access_token: $ASAAS_API_KEY" "$ASAAS_API/finance/balance"
```

```bash
curl -s -H "access_token: $ASAAS_API_KEY" "$ASAAS_API/payments/$ASAAS_PAYMENT_ID" | jq '{status, billingType, value, refunds}'
```

`status` must be `RECEIVED` or `CONFIRMED`, `refunds` must be `null`, and `balance` must cover the value. For PIX you can also check the underlying transaction:

```bash
export PIX_TX=$(curl -s -H "access_token: $ASAAS_API_KEY" "$ASAAS_API/payments/$ASAAS_PAYMENT_ID" | jq -r '.pixTransaction')
curl -s -H "access_token: $ASAAS_API_KEY" "$ASAAS_API/pix/transactions/$PIX_TX" | jq '{status, canBeRefunded, refusalReason}'
```

`canBeRefunded` must be `true`.

#### Remove the gate, or plan to authorize each refund

Two routes. The first is strongly preferred for testing, because it makes every later refund settle without a human in the loop.

**Route A — turn the requirement off for the sandbox account (do this once).** *On this account the setting is not self-service: it has to be changed by Asaas support, so Route A is unavailable outside their working hours.* Log in to <https://sandbox.asaas.com> with the account that owns `asaasApiKey` (`maxreis86@gmail.com`, mobile `…6517`). Open the account menu → **Configurações** → **Segurança** (also surfaced as *Autorização de ações críticas* / *Confirmação de ações críticas*). Disable the requirement for refunds/transfers and save. Asaas will send a confirmation token to the account's registered email or mobile to make *that* change — it is a one-time cost.

**Route B — authorize each refund as you issue it.** Leave the setting on. Immediately after the `POST /refund` below, go to <https://sandbox.asaas.com> → **Transferências** / **Cobranças → Estornos**, find the pending action, and enter the token Asaas sends to the registered email or mobile. You have only a few minutes before the refund auto-cancels, so have the console open and logged in *before* firing the request.

If the exact menu labels differ from the above, the API check in 5.3 is the source of truth — do not trust the console wording, trust `refunds[].status`.

### 5.1 Full refund

```bash
curl -s -X POST -H "access_token: $ASAAS_API_KEY" "$ASAAS_API/payments/$ASAAS_PAYMENT_ID/refund" | jq '.refunds'
```

If that prints `AWAITING_CRITICAL_ACTION_AUTHORIZATION`, go authorize it now (Route B) — the clock is running.

### 5.2 Partial refund

```bash
curl -s -X POST -H "access_token: $ASAAS_API_KEY" -H "content-type: application/json" -d '{"value": 10.00}' "$ASAAS_API/payments/$ASAAS_PAYMENT_ID/refund" | jq '.refunds'
```

Same gate applies.

### 5.3 Confirm the refund actually settled

This endpoint lists every refund attempt on the payment, including the ones that quietly died. It is the check that would have caught the failed run:

```bash
curl -s -H "access_token: $ASAAS_API_KEY" "$ASAAS_API/payments/$ASAAS_PAYMENT_ID/refunds" | jq '.data[] | {dateCreated, status, value, effectiveDate, description}'
```

Poll until the newest entry reads `"status": "DONE"` with a non-null `effectiveDate`:

```bash
for i in $(seq 1 20); do
  st=$(curl -s -H "access_token: $ASAAS_API_KEY" "$ASAAS_API/payments/$ASAAS_PAYMENT_ID/refunds" | jq -r '.data[0].status')
  echo "$(date '+%H:%M:%S') refund=$st"
  [ "$st" = "DONE" ] && break
  sleep 15
done
```

| `status` | Meaning | What to do |
|---|---|---|
| `DONE` | Settled. `PAYMENT_REFUNDED` fires. | Proceed to step 6. |
| `PENDING` | In flight. | Keep polling. |
| `AWAITING_CRITICAL_ACTION_AUTHORIZATION` | Not executed. No webhook will fire. | Authorize it in the console **now**. Do not start another refund — a second request creates a second critical action and the console token only clears the one it was issued for. |
| `CANCELLED` | Expired unauthorized, or denied. No webhook fires. | Apply Route A and issue a fresh refund. If Route A is unavailable, go to **5.4**. |

**Do not move to step 6 until you see `DONE`.** Any other value means the platform was never notified, and step 6 will correctly show the gift still funded. If you cannot get to `DONE`, use **5.4** to drive the reversal path directly.

Once it is `DONE`, `PAYMENT_REFUNDED` reaches the webhook and the reversal path runs. `PAYMENT_REFUND_IN_PROGRESS` is ignored by design ([`webhook-processor.ts`](../apps/api/src/domain/webhook-processor.ts)) and is not even in the dev subscription's event list, so its absence is expected.


### 5.4 Fallback — synthesize `PAYMENT_REFUNDED` when the gate blocks the real refund

Use this when 5.3 keeps ending in `CANCELLED` and Route A is not available (the sandbox account's critical-action setting can only be changed by Asaas support). Observed on `pay_ccwr15aidh2kw5xv`: two refunds requested minutes apart, 2FA authorized in the console on the second, both ended `CANCELLED` with `effectiveDate: null` and no webhook of any kind.

This exercises the **platform's** reversal path, which is what this test is for. It does not exercise Asaas. The money never moves, so after this the dev payment reads `REFUNDED` on our side and `RECEIVED` on Asaas's, permanently. Do it on a throwaway dev payment and never on prod.

**Preconditions.** Every entry from 5.3 must be `CANCELLED` — a refund still sitting in `AWAITING_CRITICAL_ACTION_AUTHORIZATION` can still settle later and land a real `PAYMENT_REFUNDED` on top of your synthetic one, applying the reversal twice.

```bash
curl -s -H "access_token: $ASAAS_API_KEY" "$ASAAS_API/payments/$ASAAS_PAYMENT_ID/refunds" | jq -e '[.data[].status] | all(. == "CANCELLED")' && echo "clear to synthesize"
```

Record the baseline before posting, so you can prove the reversal moved it:

```bash
aws dynamodb get-item --table-name "$TABLE_NAME" --key "{\"PK\":{\"S\":\"GIFT#${GIFT_ID}\"},\"SK\":{\"S\":\"STATE\"}}" --query 'Item.{partsFunded:partsFunded.N,confirmedAmountCents:confirmedAmountCents.N,version:version.N}'
```

#### 5.4a Full refund

`refunds[].status` **must** be `DONE`. `usableRefunds` keeps only `DONE` or status-less entries, so a `PENDING` or `CANCELLED` value here sums to zero and the payment transitions with `refundedAmountCents` unset — which looks like a pass but tests nothing.

```bash
export REFUND_FULL=$(jq -nc --argjson p "$ASAAS_PAYMENT" --arg id "evt_test_refund_full_$(date +%s)" --arg now "$(date '+%Y-%m-%d %H:%M:%S')" '{id:$id,event:"PAYMENT_REFUNDED",dateCreated:$now,payment:($p|.status="REFUNDED"|.refunds=[{dateCreated:$now,status:"DONE",value:$p.value,effectiveDate:($now|split(" ")[0]),description:null,endToEndIdentifier:null,refundedSplits:null,transactionReceiptUrl:null}])}')
```

```bash
jq -e '.payment.refunds[0].status == "DONE" and (.payment.refunds[0].value > 0)' <<<"$REFUND_FULL" || echo "MALFORMED — do not post"
```

```bash
curl -s -X POST "$API_URL/webhooks/asaas" -H "content-type: application/json" -H "asaas-access-token: $ASAAS_WEBHOOK_TOKEN" -d "$REFUND_FULL"
```

Expect `partsFunded` and `confirmedAmountCents` to drop back to the pre-payment baseline, and `refundedAmountCents` to equal the full `amountCents`.

#### 5.4b Partial refund

Asaas labels a partial refund `PAYMENT_REFUNDED` as well — the smaller `refunds[]` sum is the only thing distinguishing it, which is exactly the detection worth testing. Keep the value strictly below the payment value; the payment stays `RECEIVED` and only some parts are released.

```bash
export REFUND_PARTIAL=$(jq -nc --argjson p "$ASAAS_PAYMENT" --arg id "evt_test_refund_part_$(date +%s)" --arg now "$(date '+%Y-%m-%d %H:%M:%S')" --argjson v 10.00 '{id:$id,event:"PAYMENT_REFUNDED",dateCreated:$now,payment:($p|.refunds=[{dateCreated:$now,status:"DONE",value:$v,effectiveDate:($now|split(" ")[0]),description:null,endToEndIdentifier:null,refundedSplits:null,transactionReceiptUrl:null}])}')
```

```bash
jq -e '.payment.refunds[0].value < .payment.value and .payment.status == "RECEIVED"' <<<"$REFUND_PARTIAL" || echo "MALFORMED — do not post"
```

```bash
curl -s -X POST "$API_URL/webhooks/asaas" -H "content-type: application/json" -H "asaas-access-token: $ASAAS_WEBHOOK_TOKEN" -d "$REFUND_PARTIAL"
```

Note `payment.status` is deliberately left at `RECEIVED` here. Refund totals are cumulative and only ever move forward (`Math.max` against the stored value), so run 5.4b **before** 5.4a on a given payment — a full refund first pins the total at the maximum and the partial post afterwards becomes a no-op.

A partial refund that does not fully pay back a part leaves that part funded on purpose, and says so in the log. This check belongs to 5.4b only — a full refund never evaluates part boundaries, so on a 5.4a run it is always empty and an empty result there proves nothing:

```bash
aws logs filter-log-events --log-group-name "$PROCESSOR_LOG_GROUP" --start-time $(( ($(date +%s) - 900) * 1000 )) --filter-pattern 'REFUND_NOT_PART_ALIGNED' --query 'events[].message' --output text
```

#### 5.4c Unsettled refund (the guard)

A breakdown in which nothing has settled must change nothing at all. This is the regression case: it used to reverse the entire gift.

```bash
export REFUND_UNSETTLED=$(jq -nc --argjson p "$ASAAS_PAYMENT" --arg id "evt_test_refund_pend_$(date +%s)" --arg now "$(date '+%Y-%m-%d %H:%M:%S')" --argjson v 10.00 '{id:$id,event:"PAYMENT_REFUNDED",dateCreated:$now,payment:($p|.status="REFUNDED"|.refunds=[{dateCreated:$now,status:"AWAITING_CRITICAL_ACTION_AUTHORIZATION",value:$v,effectiveDate:null,description:null,endToEndIdentifier:null,refundedSplits:null,transactionReceiptUrl:null}])}')
```

```bash
curl -s -X POST "$API_URL/webhooks/asaas" -H "content-type: application/json" -H "asaas-access-token: $ASAAS_WEBHOOK_TOKEN" -d "$REFUND_UNSETTLED"
```

Expect `partsFunded`, `confirmedAmountCents` and the gift-state `version` **all unchanged**, the payment still `RECEIVED`, and one `REFUND_NOT_SETTLED` line:

```bash
aws logs filter-log-events --log-group-name "$PROCESSOR_LOG_GROUP" --start-time $(( ($(date +%s) - 900) * 1000 )) --filter-pattern 'REFUND_NOT_SETTLED' --query 'events[].message' --output text
```

#### What the processor does with each body

| Body | Outcome | Resulting status | `refundedAmountCents` |
|---|---|---|---|
| 5.4a, `refunds[0].status: "DONE"`, value == payment value | full reversal | `REFUNDED` | full `amountCents` |
| 5.4b, `refunds[0].status: "DONE"`, value < payment value | partial release | unchanged (`RECEIVED`) | the partial sum |
| 5.4c, no entry `DONE` | **nothing happens**, `REFUND_NOT_SETTLED` logged, event marked `ignored_unsettled_refund` | unchanged | unchanged |
| `PAYMENT_REFUNDED` with no `refunds[]` at all | full reversal (status is trusted when there is no breakdown) | `REFUNDED` | full `amountCents` |

`PAYMENT_REFUND_IN_PROGRESS` and `PAYMENT_REFUND_DENIED` are both short-circuited to `ignored_stale` before any of this, so there is no point synthesizing them.

## 6. Verifying each run

**Only run this after the scenario actually completed** — for step 5, that means `refunds[0].status == "DONE"` in 5.3. Every query below reads the platform's state, so a refund Asaas never executed shows up here as "nothing changed", not as a failure.

Payment status and refunded amount:

```bash
curl -s "$API_URL/payments/$PAYMENT_ID" | jq '.payment | {status, refundedAmountCents}'
```

Gift state row:

```bash
aws dynamodb get-item --table-name "$TABLE_NAME" --key "{\"PK\":{\"S\":\"GIFT#${GIFT_ID}\"},\"SK\":{\"S\":\"STATE\"}}" --query 'Item.{partsFunded:partsFunded.N,confirmedAmountCents:confirmedAmountCents.N,version:version.N}'
```

Reservation bookkeeping — this is where the reversal is recorded, and it disambiguates "reversed then reinstated" from "never touched":

```bash
aws dynamodb get-item --table-name "$TABLE_NAME" --key "{\"PK\":{\"S\":\"PAYMENT#${PAYMENT_ID}\"},\"SK\":{\"S\":\"RESERVATION\"}}" --query 'Item.{status:status.S,quantity:quantity.N,reversedParts:reversedParts.N,reversedAmountCents:reversedAmountCents.N}'
```

### What each scenario should produce

| Scenario | `payment.status` | `refundedAmountCents` | `reservation.status` | `partsFunded` |
|---|---|---|---|---|
| 4.1 chargeback requested | `CHARGEBACK` | unchanged | `REVERSED` | **down** to 0 for this payment |
| 4.2 chargeback dispute | `CHARGEBACK` | unchanged | `REVERSED` | unchanged (no-op) |
| 4.3 reversal | `CONFIRMED` | unchanged | `CONSUMED`, `reversedParts = 0` | **back up** |
| 5.1 full refund, `DONE` | `REFUNDED` | = `amountCents` | `REVERSED` | **down** to 0 for this payment |
| 5.2 partial refund below a part boundary | unchanged | partial value | `CONSUMED` | **unchanged**, plus a `REFUND_NOT_PART_ALIGNED` warning |
| 5.2 partial refund covering whole parts | unchanged | partial value | `CONSUMED`, `reversedParts > 0` | down by the fully-refunded parts only |
| 5.4c unsettled refund | unchanged | unchanged | unchanged | **unchanged**, plus a `REFUND_NOT_SETTLED` warning |

A partial refund that does not fully pay back a part deliberately leaves the part funded — freeing it would let the gift collect for that part twice. `REFUND_NOT_PART_ALIGNED` is the intended output there, not an error; the check itself lives in 5.4b, where it can actually fire.

Processor logs for the invariant and ignore metrics:

```bash
aws logs filter-log-events --log-group-name "$PROCESSOR_LOG_GROUP" --start-time $(( ($(date +%s) - 900) * 1000 )) --filter-pattern '?REVERSAL_TRANSACTION_INVARIANT_VIOLATION ?REVERSAL_TRANSACTION_VERSION_RETRY ?CHARGEBACK_CONFIRMATION_IGNORED ?REFUND_NOT_SETTLED' --query 'events[].message' --output text
```

Confirm the webhook actually arrived — this separates "the reversal path is broken" from "Asaas never told us". If this returns nothing for a refund you believe settled, the problem is on the Asaas side, not in the processor:

```bash
aws dynamodb query --table-name "$TABLE_NAME" --key-condition-expression "PK = :p" --expression-attribute-values '{":p":{"S":"WEBHOOK#asaas"}}' --output json | jq -c --arg a "$ASAAS_PAYMENT_ID" '.Items[] | select(.payload.S | contains($a)) | {eventType:.eventType.S, receivedAt:.receivedAt.S, processedAt:.processedAt.S}'
```

Live tail while posting, if you prefer:

```bash
aws logs tail "$PROCESSOR_LOG_GROUP" --follow
```

Dead-letter queue depth must not grow during the run (it holds unrelated older messages, so record the depth before you start and compare):

```bash
aws sqs get-queue-attributes --queue-url "$WEBHOOK_DLQ_URL" --attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' --output text
```

## 7. Troubleshooting

**"I refunded it and the gift quota is still paid."** Almost always the critical-action gate from 5.0. Check in this order:

1. `GET $ASAAS_API/payments/$ASAAS_PAYMENT_ID/refunds` — if the newest entry is `AWAITING_CRITICAL_ACTION_AUTHORIZATION` or `CANCELLED`, the money never moved. Nothing downstream is wrong.
2. The `WEBHOOK#asaas` query above — if no `PAYMENT_REFUNDED` row exists, Asaas never delivered one.
3. `GET $ASAAS_API/webhooks` — the dev subscription must be `enabled: true`, `interrupted: false`, and include `PAYMENT_REFUNDED` and `PAYMENT_PARTIALLY_REFUNDED`.
4. Only if a `PAYMENT_REFUNDED` row exists with a `processedAt` and the gift is still funded is this a platform bug.

```bash
curl -s -H "access_token: $ASAAS_API_KEY" "$ASAAS_API/webhooks" | jq '.data[] | {name, url, enabled, interrupted, events}'
```

**A cancelled or denied refund is silent by design.** The dev subscription does not include `PAYMENT_REFUND_DENIED` or `PAYMENT_REFUND_IN_PROGRESS`, and the processor ignores both anyway. Asaas records a denied refund as a `CANCELLED` entry in `refunds[]` and sends nothing, so `GET /payments/{id}/refunds` is your only signal.

**A pending refund can never un-fund a gift.** `usableRefunds` counts only `DONE` (or status-less) entries, so an `AWAITING_CRITICAL_ACTION_AUTHORIZATION` amount is never subtracted — a refund that is later denied must not have permanently released a part.

When a payload carries a breakdown in which *nothing* has settled, the processor now stops before the status transition: it logs `REFUND_NOT_SETTLED` with the entry statuses and marks the event `ignored_unsettled_refund`. Previously such a payload fell through to the status map, which returns `REFUNDED`, and the repository zeroed **every** funded part regardless of the amount — a R$10 unsettled refund released a whole R$50 gift, and the later `DONE` copy could not put it back. If you see `REFUND_NOT_SETTLED`, the gift is untouched by design; re-post once the refund reads `DONE`.

## Caution

On the synthetic chargeback payloads: since Asaas never sends you a real dispute-won event in sandbox, the event name you assert in the reversal branch stays unverified until the first production dispute. Log the full raw body on that branch so you can correct the match list later without guessing.

`ASAAS_API_KEY` and `ASAAS_WEBHOOK_TOKEN` live only in env vars. Do not paste them into a commit, a shared shell history file, or a bug report.
