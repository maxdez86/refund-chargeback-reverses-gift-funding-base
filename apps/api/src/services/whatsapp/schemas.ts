import { z } from "zod";
import {
  WhatsappTemplatePurposeSchema as SharedWhatsappTemplatePurposeSchema,
  WhatsappTextBodySchema
} from "@brimax/contracts";

export const WHATSAPP_GRAPH_API_VERSION = "v25.0";

export const WhatsappTemplatePurposeSchema = SharedWhatsappTemplatePurposeSchema;
export const WhatsappTemplateNameSchema = z.string().regex(/^[a-z0-9_]{1,512}$/);
export const WhatsappTemplateLanguageSchema = z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/);
export const WhatsappRecipientSchema = z.string().regex(/^[1-9]\d{7,14}$/);
export const WhatsappPhoneNumberIdSchema = z.string().regex(/^\d+$/);

const mediaReferenceSchema = z
  .object({ id: z.string().min(1).optional(), link: z.string().url().optional() })
  .refine((value) => Boolean(value.id) !== Boolean(value.link), {
    message: "Exactly one media id or link is required."
  });

export const WhatsappTemplateParameterSchema = z.discriminatedUnion("type", [
  // `parameter_name` is what Meta requires for a NAMED template. It is only modelled on the text
  // variant because every approved template's header/body slots are text; `bindComponents` fails
  // closed if a NAMED definition ever declares a slot of another type.
  z.object({
    type: z.literal("text"),
    parameter_name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
    text: z.string().min(1)
  }),
  z.object({
    type: z.literal("currency"),
    currency: z.object({
      fallback_value: z.string().min(1),
      code: z.string().length(3),
      amount_1000: z.number().int()
    })
  }),
  z.object({
    type: z.literal("date_time"),
    date_time: z.object({ fallback_value: z.string().min(1) })
  }),
  z.object({ type: z.literal("image"), image: mediaReferenceSchema }),
  z.object({
    type: z.literal("document"),
    document: mediaReferenceSchema.and(z.object({ filename: z.string().min(1).optional() }))
  }),
  z.object({ type: z.literal("video"), video: mediaReferenceSchema }),
  z.object({ type: z.literal("payload"), payload: z.string().min(1) })
]);

export type WhatsappTemplateParameter = z.infer<typeof WhatsappTemplateParameterSchema>;

const headerBodyComponentSchema = z.object({
  type: z.enum(["header", "body"]),
  parameters: z.array(WhatsappTemplateParameterSchema).min(1)
});

const buttonComponentSchema = z.object({
  type: z.literal("button"),
  sub_type: z.enum(["quick_reply", "url"]),
  index: z.string().regex(/^\d{1,2}$/),
  parameters: z.array(WhatsappTemplateParameterSchema).min(1)
});

export const WhatsappTemplateComponentSchema = z.union([
  headerBodyComponentSchema,
  buttonComponentSchema
]);
export type WhatsappTemplateComponent = z.infer<typeof WhatsappTemplateComponentSchema>;

export const WhatsappTemplateParameterSlotSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  type: z.enum(["text", "currency", "date_time", "image", "document", "video", "payload"])
});
export type WhatsappTemplateParameterSlot = z.infer<typeof WhatsappTemplateParameterSlotSchema>;

const storedHeaderBodyComponentSchema = z.object({
  type: z.enum(["header", "body"]),
  parameters: z.array(WhatsappTemplateParameterSlotSchema).min(1)
});

const storedButtonComponentSchema = z
  .object({
    type: z.literal("button"),
    subType: z.enum(["quick_reply", "url"]),
    index: z.number().int().min(0).max(99),
    buttonId: z.string().min(1).optional(),
    parameters: z.array(WhatsappTemplateParameterSlotSchema)
  })
  .superRefine((component, context) => {
    if (component.subType === "quick_reply" && (!component.buttonId || component.parameters.length > 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quick-reply buttons require one static buttonId and no runtime parameters."
      });
    }
    if (component.subType === "url" && (component.buttonId || component.parameters.length !== 1 || component.parameters[0]?.type !== "text")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL buttons require exactly one runtime text parameter and no buttonId."
      });
    }
  });

export const WhatsappStoredComponentSchema = z.union([
  storedHeaderBodyComponentSchema,
  storedButtonComponentSchema
]);
export type WhatsappStoredComponent = z.infer<typeof WhatsappStoredComponentSchema>;

export const WhatsappTemplateParameterFormatSchema = z.enum(["named", "positional"]);
export type WhatsappTemplateParameterFormat = z.infer<typeof WhatsappTemplateParameterFormatSchema>;

export const WhatsappTemplateDefinitionSchema = z.object({
  purpose: WhatsappTemplatePurposeSchema,
  version: z.number().int().positive(),
  name: WhatsappTemplateNameSchema,
  language: WhatsappTemplateLanguageSchema,
  // Defaulted so already-deployed positional definitions remain valid on read.
  parameterFormat: WhatsappTemplateParameterFormatSchema.default("positional"),
  components: z.array(WhatsappStoredComponentSchema).default([]),
  createdAt: z.string().datetime()
});
export type WhatsappTemplateDefinition = z.infer<typeof WhatsappTemplateDefinitionSchema>;

export const WhatsappTemplateVersionItemSchema = WhatsappTemplateDefinitionSchema.extend({
  PK: z.string().min(1),
  SK: z.string().min(1),
  entityType: z.literal("WhatsappTemplateVersion")
});

export const WhatsappTemplateActiveItemSchema = z.object({
  PK: z.string().min(1),
  SK: z.literal("ACTIVE"),
  entityType: z.literal("WhatsappTemplateActive"),
  purpose: WhatsappTemplatePurposeSchema,
  activeVersion: z.number().int().positive(),
  activatedAt: z.string().datetime()
});

export const WhatsappSendTemplateInputSchema = z.object({
  to: WhatsappRecipientSchema,
  template: z.object({
    name: WhatsappTemplateNameSchema,
    language: WhatsappTemplateLanguageSchema,
    components: z.array(WhatsappTemplateComponentSchema).min(1).optional()
  })
});

export const WhatsappSendTextInputSchema = z.object({
  to: WhatsappRecipientSchema,
  text: z.object({ body: WhatsappTextBodySchema })
});

export type WhatsappSendTemplateInput = z.infer<typeof WhatsappSendTemplateInputSchema>;

export const WhatsappSuccessResponseSchema = z.object({
  messaging_product: z.literal("whatsapp"),
  contacts: z.array(z.object({ input: z.string().optional(), wa_id: z.string().min(1).optional() })).optional(),
  messages: z.array(z.object({ id: z.string().min(1), message_status: z.string().optional() })).min(1)
});

export const WhatsappErrorResponseSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.number().int().optional(),
    error_subcode: z.number().int().optional(),
    fbtrace_id: z.string().optional()
  })
});
