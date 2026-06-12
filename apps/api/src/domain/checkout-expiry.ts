import type { PaymentRepository } from "../services/dynamodb/repositories/payment-repository";
import { CHECKOUT_EXPIRY_GRACE_MS, isStalePendingCheckout } from "./payment-state";

type CheckoutExpiryRepository = Pick<
  PaymentRepository,
  "getPayment" | "listStaleOpenReservations" | "releaseReservationAfterCheckoutFailure" | "tryExpireStalePayment"
>;

type StoredPayment = NonNullable<Awaited<ReturnType<PaymentRepository["getPayment"]>>>;

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
export async function sweepStaleCheckouts(repository: CheckoutExpiryRepository, nowMs: number) {
  const cutoff = new Date(nowMs - CHECKOUT_EXPIRY_GRACE_MS).toISOString();
  const staleReservations = await repository.listStaleOpenReservations(cutoff);

  for (const reservation of staleReservations) {
    try {
      const payment = await repository.getPayment(reservation.paymentId);

      if (!payment) {
        await repository.releaseReservationAfterCheckoutFailure(reservation.paymentId);
        continue;
      }

      if (payment.status === "CREATED" || payment.status === "AWAITING_PAYMENT") {
        await repository.tryExpireStalePayment({
          paymentId: payment.paymentId,
          expectedCurrentStatus: payment.status
        });
      }
      // PROCESSING and terminal statuses are left for their own webhooks.
    } catch (error) {
      console.error(
        JSON.stringify({
          metric: "CHECKOUT_EXPIRY_SWEEP_ITEM_FAILED",
          paymentId: reservation.paymentId,
          errorMessage: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }
}
