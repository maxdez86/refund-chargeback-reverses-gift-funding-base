import { getEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { getAppSecret } from "../secrets-manager/app-secrets";
import {
  WHATSAPP_GRAPH_API_VERSION,
  WhatsappErrorResponseSchema,
  WhatsappPhoneNumberIdSchema,
  WhatsappSendTemplateInputSchema,
  WhatsappSendTextInputSchema,
  WhatsappSuccessResponseSchema,
  type WhatsappSendTemplateInput
} from "./schemas";

const GRAPH_API_BASE_URL = "https://graph.facebook.com";
export const WHATSAPP_DEFAULT_TIMEOUT_MS = 15_000;

export type WhatsappErrorCategory =
  | "invalid_request"
  | "unauthorized"
  | "rate_limited"
  | "transient"
  | "timeout"
  | "network"
  | "ambiguous_delivery"
  | "invalid_response";

export class WhatsappApiError extends AppError {
  constructor(
    message: string,
    readonly category: WhatsappErrorCategory,
    readonly upstreamStatus: number | undefined,
    readonly retryable: boolean,
    readonly providerCode?: number,
    readonly providerSubcode?: number,
    readonly providerType?: string,
    readonly providerTraceId?: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message, 502);
    this.name = "WhatsappApiError";
  }
}

export class WhatsappConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 500);
    this.name = "WhatsappConfigurationError";
  }
}

type ClientDependencies = {
  fetch?: typeof globalThis.fetch;
  getAccessToken?: () => Promise<string>;
  getPhoneNumberId?: () => string;
  timeoutMs?: number;
};

function statusCategory(status: number): { category: WhatsappErrorCategory; retryable: boolean } {
  if (status === 401 || status === 403) return { category: "unauthorized", retryable: false };
  if (status === 429) return { category: "rate_limited", retryable: true };
  if (status >= 500) return { category: "transient", retryable: true };
  return { category: "invalid_request", retryable: false };
}

function parseRetryAfter(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function safeJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export class WhatsappCloudApiClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly getAccessToken: () => Promise<string>;
  private readonly getPhoneNumberId: () => string;
  private readonly timeoutMs: number;

  constructor(dependencies: ClientDependencies = {}) {
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch;
    this.getAccessToken = dependencies.getAccessToken ?? (() => getAppSecret("whatsappAccessToken"));
    this.getPhoneNumberId = dependencies.getPhoneNumberId ?? (() => getEnv().whatsappPhoneNumberId);
    this.timeoutMs = dependencies.timeoutMs ?? WHATSAPP_DEFAULT_TIMEOUT_MS;
  }

  async sendTemplate(
    input: WhatsappSendTemplateInput,
    context: { requestId: string; templatePurpose?: string; templateVersion?: number }
  ) {
    const validated = WhatsappSendTemplateInputSchema.parse(input);
    const phoneNumberIdResult = WhatsappPhoneNumberIdSchema.safeParse(this.getPhoneNumberId().trim());
    if (!phoneNumberIdResult.success) {
      throw new WhatsappConfigurationError("WhatsApp phone-number ID is missing or invalid.");
    }
    const phoneNumberId = phoneNumberIdResult.data;

    const accessToken = (await this.getAccessToken()).trim();
    if (!accessToken) throw new WhatsappConfigurationError("WhatsApp access token is missing.");

    const body = {
      messaging_product: "whatsapp",
      to: validated.to,
      type: "template",
      template: {
        name: validated.template.name,
        language: { code: validated.template.language },
        ...(validated.template.components ? { components: validated.template.components } : {})
      }
    };
    const url = `${GRAPH_API_BASE_URL}/${WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    let logFields: Record<string, unknown> = {};

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (error) {
        const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
        // retryable means safe for an automated replay. A transport failure
        // cannot prove whether Meta received the request, so replay is unsafe.
        throw new WhatsappApiError(
          timedOut
            ? "WhatsApp request timed out; the delivery outcome is unknown."
            : "WhatsApp network request failed; the delivery outcome is unknown.",
          timedOut ? "timeout" : "network",
          undefined,
          false
        );
      }

      const providerTraceId = response.headers.get("x-fb-trace-id") ?? undefined;
      logFields = { httpStatus: response.status, providerTraceId };

      let responseBody: string;
      try {
        responseBody = await response.text();
      } catch {
        if (response.ok) {
          throw new WhatsappApiError(
            "WhatsApp returned successful response headers, but the delivery outcome is unknown.",
            "ambiguous_delivery",
            response.status,
            false,
            undefined,
            undefined,
            undefined,
            providerTraceId
          );
        }

        const classification = statusCategory(response.status);
        throw new WhatsappApiError(
          `WhatsApp request failed with status ${response.status}, and its response body could not be read.`,
          classification.category,
          response.status,
          classification.retryable,
          undefined,
          undefined,
          undefined,
          providerTraceId,
          parseRetryAfter(response.headers.get("retry-after"))
        );
      }

      const parsed = safeJson(responseBody);
      if (!response.ok) {
        const providerError = WhatsappErrorResponseSchema.safeParse(parsed);
        const details = providerError.success ? providerError.data.error : undefined;
        const classification = statusCategory(response.status);
        logFields = {
          httpStatus: response.status,
          providerCode: details?.code,
          providerType: details?.type,
          providerTraceId: details?.fbtrace_id ?? providerTraceId
        };
        throw new WhatsappApiError(
          `WhatsApp request failed with status ${response.status}.`,
          classification.category,
          response.status,
          classification.retryable,
          details?.code,
          details?.error_subcode,
          details?.type,
          details?.fbtrace_id ?? providerTraceId,
          parseRetryAfter(response.headers.get("retry-after"))
        );
      }

      const success = WhatsappSuccessResponseSchema.safeParse(parsed);
      if (!success.success) {
        logFields = { httpStatus: response.status, providerTraceId };
        throw new WhatsappApiError(
          "WhatsApp returned an invalid success response.",
          "invalid_response",
          response.status,
          false,
          undefined,
          undefined,
          undefined,
          providerTraceId
        );
      }

      const messageId = success.data.messages[0].id;
      const recipientWaId = success.data.contacts?.[0]?.wa_id;
      logFields = { httpStatus: response.status, messageId, providerTraceId };
      return { messageId, recipientWaId, providerTraceId };
    } catch (error) {
      if (error instanceof WhatsappApiError) {
        logFields = {
          ...logFields,
          errorCategory: error.category,
          retryable: error.retryable
        };
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      console.info(
        JSON.stringify({
          metric: "WHATSAPP_TEMPLATE_REQUEST",
          requestId: context.requestId,
          templatePurpose: context.templatePurpose,
          templateVersion: context.templateVersion,
          durationMs: Date.now() - startedAt,
          ...logFields
        })
      );
    }
  }

  async sendText(input: { to: string; text: { body: string } }, context: { requestId: string }) {
    const validated = WhatsappSendTextInputSchema.parse(input);
    const phoneNumberId = WhatsappPhoneNumberIdSchema.parse(this.getPhoneNumberId().trim());
    const accessToken = (await this.getAccessToken()).trim();
    if (!accessToken) throw new WhatsappConfigurationError("WhatsApp access token is missing.");
    const url = `${GRAPH_API_BASE_URL}/${WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { accept: "application/json", authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: validated.to, type: "text", text: validated.text }),
        signal: controller.signal
      });
      const parsed = safeJson(await response.text());
      if (!response.ok) {
        const error = WhatsappErrorResponseSchema.safeParse(parsed).success ? WhatsappErrorResponseSchema.parse(parsed).error : undefined;
        const classification = statusCategory(response.status);
        throw new WhatsappApiError(`WhatsApp text request failed with status ${response.status}.`, classification.category, response.status, classification.retryable, error?.code, error?.error_subcode, error?.type, error?.fbtrace_id);
      }
      const success = WhatsappSuccessResponseSchema.safeParse(parsed);
      if (!success.success) throw new WhatsappApiError("WhatsApp returned an invalid text response.", "invalid_response", response.status, false);
      return { messageId: success.data.messages[0].id, recipientWaId: success.data.contacts?.[0]?.wa_id };
    } catch (error) {
      if (error instanceof WhatsappApiError) throw error;
      if (error instanceof AppError) throw error;
      throw new WhatsappApiError("WhatsApp text request failed; the delivery outcome is unknown.", "network", undefined, false);
    } finally {
      clearTimeout(timeout);
      console.info(JSON.stringify({ metric: "WHATSAPP_TEXT_REQUEST", requestId: context.requestId }));
    }
  }
}
