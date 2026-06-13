import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { GiftService } from "../../domain/gift-service";
import { corsHeaders, jsonResponse, noContentResponse } from "../../lib/http";
import { reportHandledError, wrapLambdaHandler } from "../../lib/sentry";
import { withWarmup } from "../../lib/warmup";
import { enqueueExpiryTrigger } from "../../services/sqs/checkout-expiry-publisher";

const service = new GiftService();

async function onGetGifts(event: APIGatewayProxyEventV2) {
  const cors = corsHeaders(event.headers.origin);

  if (event.requestContext.http.method === "OPTIONS") {
    return noContentResponse(cors);
  }

  try {
    // Read the gifts and nudge the expiry worker concurrently. The response is
    // built from the gift read alone; the enqueue is best-effort acceleration
    // and never affects listing (it swallows its own failures, and allSettled
    // isolates it even if that ever changes).
    const [giftsResult] = await Promise.allSettled([
      service.getGifts(),
      enqueueExpiryTrigger("gifts")
    ]);

    if (giftsResult.status === "rejected") {
      throw giftsResult.reason;
    }

    return jsonResponse(200, giftsResult.value, cors);
  } catch (error) {
    reportHandledError(error, {
      context: { requestId: event.requestContext.requestId },
      metric: "GIFTS_LOOKUP_FAILED",
      statusCode: 500
    });
    return jsonResponse(500, { message: "Unexpected gift lookup error." }, cors);
  }
}

export const handler = withWarmup(wrapLambdaHandler(onGetGifts));
