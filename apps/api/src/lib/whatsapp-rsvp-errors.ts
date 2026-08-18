import { WhatsappRsvpErrorCodeSchema, WhatsappRsvpErrorResponseSchema, type WhatsappRsvpErrorCode } from "@brimax/contracts";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { jsonResponse } from "./http";
import { reportHandledError } from "./sentry";

function codeFor(error: unknown): WhatsappRsvpErrorCode {
  if (error instanceof AppError && error.code) {
    const parsed = WhatsappRsvpErrorCodeSchema.safeParse(error.code);
    if (parsed.success) return parsed.data;
  }
  if (error instanceof ZodError || error instanceof SyntaxError) return "VALIDATION_ERROR";
  if (error instanceof AppError) {
    if (error.statusCode === 404) return "INVITATION_NOT_FOUND";
    if (error.statusCode === 409) return "INVALID_FLOW_TRANSITION";
    if (error.statusCode === 422) return "INVALID_INVITATION_STATE";
    if (error.statusCode === 503) return "QUEUE_FAILURE";
  }
  return "INTERNAL_ERROR";
}

export function whatsappRsvpErrorResponse(
  error: unknown,
  fallbackMessage: string,
  headers: Record<string, string> = {}
) {
  const body = WhatsappRsvpErrorResponseSchema.parse({
    code: codeFor(error),
    message: error instanceof ZodError || error instanceof SyntaxError
      ? "Invalid WhatsApp RSVP request."
      : error instanceof Error && error instanceof AppError
        ? error.message
        : fallbackMessage,
    issues: error instanceof ZodError ? error.issues : undefined
  });
  const statusCode = error instanceof AppError ? error.statusCode : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
  return jsonResponse(statusCode, body, headers);
}

export function withWhatsappRsvpErrors<TEvent, TResult>(
  handler: (event: TEvent) => Promise<TResult>,
  metric = "WHATSAPP_RSVP_OPERATOR_REQUEST_FAILED"
): (event: TEvent) => Promise<TResult | ReturnType<typeof jsonResponse>> {
  return async (event) => {
    try {
      return await handler(event);
    } catch (error) {
      reportHandledError(error, {
        metric,
        statusCode: error instanceof AppError
          ? error.statusCode
          : error instanceof ZodError || error instanceof SyntaxError
            ? 400
            : 500
      });
      return whatsappRsvpErrorResponse(error, "Unexpected WhatsApp RSVP error.");
    }
  };
}
