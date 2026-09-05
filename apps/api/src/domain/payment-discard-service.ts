import {
  DiscardPaymentResponseSchema,
  PaymentSummarySchema,
  type PaymentSummary
} from "@brimax/contracts";
import { AppError } from "../lib/errors";
import { AsaasApiError, AsaasClient } from "../services/asaas/client";
import {
  PaymentRepository,
  type StoredPaymentReservation,
  type StoredPaymentShell
} from "../services/dynamodb/repositories/payment-repository";

const DISCARDABLE_PAYMENT_STATUSES = new Set(["CREATED", "AWAITING_PAYMENT"]);
const NON_PAYABLE_CHECKOUT_STATUSES = new Set(["CANCELED", "EXPIRED"]);

export class PaymentDiscardService {
  constructor(
    private readonly repository = new PaymentRepository(),
    private readonly asaasClient = new AsaasClient()
  ) {}

  async discard(paymentId: string, _idempotencyKeyHeader?: string) {
    const state = await this.getLocalState(paymentId);
    if (this.isFullyDiscarded(state.payment, state.reservation, state.shell)) {
      return this.buildResponse(state.payment);
    }

    if (!DISCARDABLE_PAYMENT_STATUSES.has(state.payment.status)) {
      throw new AppError("This payment can no longer be discarded.", 409);
    }

    if (
      state.reservation.status === "RELEASED" ||
      state.reservation.status === "CONSUMED" ||
      state.reservation.status === "REVERSED" ||
      state.shell.shellStatus === "CHECKOUT_RELEASED" ||
      state.shell.shellStatus === "CHECKOUT_CONSUMED"
    ) {
      throw new AppError("Payment checkout state cannot be discarded safely.", 409);
    }

    const checkoutId = state.shell.asaasCheckoutId ?? state.payment.checkout?.sessionId;
    if (!checkoutId) {
      throw new AppError("Payment checkout id is missing.", 409);
    }

    const checkoutStatus = await this.cancelOrReconcileCheckout(checkoutId);
    if (!NON_PAYABLE_CHECKOUT_STATUSES.has(checkoutStatus)) {
      throw new AppError("The payment checkout is still payable and was not discarded.", 409);
    }

    const applied = await this.repository.discardPendingPayment({
      paymentId,
      expectedPaymentStatus: state.payment.status as "CREATED" | "AWAITING_PAYMENT",
      expectedReservationStatus: state.reservation.status,
      expectedShellStatus: state.shell.shellStatus
    });

    const refreshed = await this.getLocalState(paymentId);
    if (!applied && !this.isFullyDiscarded(refreshed.payment, refreshed.reservation, refreshed.shell)) {
      throw new AppError("Payment state changed while it was being discarded. Please try again.", 409);
    }

    if (!this.isFullyDiscarded(refreshed.payment, refreshed.reservation, refreshed.shell)) {
      throw new AppError("Payment could not be discarded safely.", 409);
    }

    return this.buildResponse(refreshed.payment);
  }

  private async cancelOrReconcileCheckout(checkoutId: string) {
    try {
      const canceled = await this.asaasClient.cancelCheckout(checkoutId);
      return String(canceled.status ?? "").toUpperCase();
    } catch (error) {
      if (!(error instanceof AsaasApiError)) {
        throw error;
      }

      let checkout;
      try {
        checkout = await this.asaasClient.getCheckoutById(checkoutId);
      } catch {
        throw error;
      }

      const status = String(checkout?.status ?? "").toUpperCase();
      if (NON_PAYABLE_CHECKOUT_STATUSES.has(status)) {
        return status;
      }

      throw error;
    }
  }

  private async getLocalState(paymentId: string) {
    const [payment, reservation, shell] = await Promise.all([
      this.repository.getPayment(paymentId),
      this.repository.getPaymentReservation(paymentId),
      this.repository.getPaymentShell(paymentId)
    ]);

    if (!payment) {
      throw new AppError("Payment not found.", 404);
    }

    if (!reservation || !shell) {
      throw new AppError("Payment checkout state is incomplete.", 409);
    }

    return { payment, reservation, shell };
  }

  private isFullyDiscarded(
    payment: PaymentSummary,
    reservation: StoredPaymentReservation,
    shell: StoredPaymentShell
  ) {
    return (
      payment.status === "CANCELED" &&
      reservation.status === "RELEASED" &&
      shell.shellStatus === "CHECKOUT_RELEASED"
    );
  }

  private buildResponse(payment: PaymentSummary) {
    return DiscardPaymentResponseSchema.parse({
      ok: true,
      payment: PaymentSummarySchema.parse(payment)
    });
  }
}
