import type { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import type { AppStage } from "@brimax/config";
import { CHECKOUT_EXPIRY_GRACE_MS, isStalePendingCheckout } from "./payment-state";

type CheckoutExpiryRepository = Pick<
  PaymentRepository,
  "getPayment" | "listStaleOpenReservations" | "releaseReservationAfterCheckoutFailure" | "tryExpireStalePayment"
>;

type StoredPayment = NonNullable<Awaited<ReturnType<PaymentRepository["getPayment"]>>>;

// Default number of candidates pulled per sweep and how many are processed at
// once. Concurrency is bounded so a backlog cannot fan out into an unbounded
// burst of transactions; 4 keeps cross-gift contention low while still draining
// faster than the original serial loop.
const DEFAULT_SWEEP_LIMIT = 25;
const DEFAULT_SWEEP_CONCURRENCY = 4;

export type SweepSummary = {
  scanned: number;
  released: number;
  raceLost: number;
  protected: number;
  missingContext: number;
  failedIds: string[];
  oldestStaleAgeMs: number;
};

export async function expirePaymentIfStale(
  repository: CheckoutExpiryRepository,
  payment: StoredPayment,
  nowMs: number
): Promise<boolean> {
  if (!isStalePendingCheckout(payment.status, payment.checkout?.expiresAt, nowMs)) {
    return false;
  }

  return repository.tryExpireStalePayment({
    paymentId: payment.paymentId,
    expectedCurrentStatus: payment.status
  });
}

// Lazy fallback for checkouts whose CHECKOUT_EXPIRED webhook never arrived.
// Staleness comes from the reservation's own expiresAt (the GSI cutoff), not
// payment.checkout?.expiresAt — payments rebuilt from a shell can lack
// `checkout` entirely and would otherwise never expire.
//
// Returns a per-outcome summary so the background worker can emit metrics and
// decide whether to throw (only retryable failures count; race-lost and
// protected outcomes are expected, not errors). Each candidate is isolated:
// one failure never blocks the rest of the batch.
export async function sweepStaleCheckouts(
  repository: CheckoutExpiryRepository,
  nowMs: number,
  options: { limit?: number; concurrency?: number; stage?: AppStage } = {}
): Promise<SweepSummary> {
  const limit = options.limit ?? DEFAULT_SWEEP_LIMIT;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_SWEEP_CONCURRENCY);

  const cutoff = new Date(nowMs - CHECKOUT_EXPIRY_GRACE_MS).toISOString();
  const staleReservations = await repository.listStaleOpenReservations(cutoff, limit);

  const summary: SweepSummary = {
    scanned: staleReservations.length,
    released: 0,
    raceLost: 0,
    protected: 0,
    missingContext: 0,
    failedIds: [],
    oldestStaleAgeMs: 0
  };

  for (const reservation of staleReservations) {
    const ageMs = nowMs - Date.parse(reservation.expiresAt);
    if (Number.isFinite(ageMs) && ageMs > summary.oldestStaleAgeMs) {
      summary.oldestStaleAgeMs = ageMs;
    }
  }

  // Process in fixed-size waves so at most `concurrency` transactions are in
  // flight at once.
  for (let offset = 0; offset < staleReservations.length; offset += concurrency) {
    const wave = staleReservations.slice(offset, offset + concurrency);
    const outcomes = await Promise.all(
      wave.map((reservation) => processStaleReservation(repository, reservation, summary, options.stage))
    );

    for (const outcome of outcomes) {
      switch (outcome) {
        case "released":
          summary.released += 1;
          break;
        case "race-lost":
          summary.raceLost += 1;
          break;
        case "protected":
          summary.protected += 1;
          break;
        case "missing-context":
          summary.missingContext += 1;
          break;
        case "failed":
          // failedIds already recorded inside processStaleReservation.
          break;
      }
    }
  }

  return summary;
}

type SweepOutcome = "released" | "race-lost" | "protected" | "missing-context" | "failed";

async function processStaleReservation(
  repository: CheckoutExpiryRepository,
  reservation: { paymentId: string },
  summary: SweepSummary,
  stage: AppStage = "prod"
): Promise<SweepOutcome> {
  try {
    const payment = await repository.getPayment(reservation.paymentId);

    if (!payment) {
      return repository.releaseReservationAfterCheckoutFailure(reservation.paymentId);
    }

    if (payment.status === "CREATED" || payment.status === "AWAITING_PAYMENT") {
      const expired = await repository.tryExpireStalePayment({
        paymentId: payment.paymentId,
        expectedCurrentStatus: payment.status
      });

      return expired ? "released" : "race-lost";
    }

    // PROCESSING and terminal statuses are left for their own webhooks. A stale
    // reservation still sitting in the open index under one of these is
    // unexpected drift, surfaced as `protected`.
    return "protected";
  } catch (error) {
    // Retryable failure (e.g. TransactionConflict, throttling). Recorded so the
    // worker can throw and let SQS retry; the rest of the wave still proceeds.
    summary.failedIds.push(reservation.paymentId);
    console.error(
      JSON.stringify({
        metric: "CHECKOUT_EXPIRY_SWEEP_ITEM_FAILED",
        stage,
        paymentId: reservation.paymentId,
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    );

    return "failed";
  }
}
