import type { RegistryCheckoutRequest, RegistryCheckoutResponse } from "@brimax/contracts";

export class StripeService {
  async createCheckoutSession(request: RegistryCheckoutRequest): Promise<RegistryCheckoutResponse> {
    return {
      ok: true,
      contributionId: `contrib_${request.guestId}`,
      checkoutUrl: "https://checkout.stripe.example/session"
    };
  }
}
