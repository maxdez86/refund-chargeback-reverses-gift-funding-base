import { z } from "zod";
import {
  WHATSAPP_RSVP_TEMPLATE_PURPOSES,
  WhatsappFlowStageSchema,
  WhatsappRsvpActionSchema,
  type WhatsappFlowStage,
  type WhatsappRsvpAction,
  type WhatsappRsvpTemplatePurpose
} from "@brimax/contracts";
import { AppError } from "../../lib/errors";
import { WhatsappTemplateDefinitionSchema } from "./schemas";

/**
 * The single description of every WhatsApp template we send: what Meta approved, what variables it
 * takes and in what order, and which internal action each of its quick replies means. Seeding
 * (Step 06), variable derivation (Step 07), the queue worker (Step 09) and branch routing
 * (Step 12) all read this instead of restating template facts.
 *
 * Imported from wedding_templates_export.json on 2026-08-19; PENDING records are treated as
 * approved for this catalog. Re-check with the Meta Graph API before rollout.
 *   curl -sS -G "https://graph.facebook.com/v25.0/<metaTemplateId>" \
 *     --data-urlencode "fields=id,name,language,category,parameter_format,status,components" \
 *     -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}"
 */

/** Export timestamp pinned so re-seeding is byte-identical. */
const APPROVED_AT = "2026-08-19T21:18:43.724Z";

/*
 * Four purposes sit at version 2: wedding_rsvp_reconfirmation, wedding_rsvp_attending_followup,
 * wedding_rsvp_declined_followup and wedding_rsvp_undecided_followup. Their VERSION#000001 records
 * were seeded in dev with `createdAt` 2026-08-16T00:00:00.000Z, and `seed` compares `createdAt`
 * alongside the components, so re-seeding them at version 1 against APPROVED_AT fails as a content
 * conflict. Their components are unchanged from version 1 — only the seeded identity moves.
 */

/**
 * Copied verbatim from the record already seeded in dev
 * (`WHATSAPP_TEMPLATE#wedding_invitation` / `VERSION#000001`) so Step 06's re-run check reports
 * `unchanged` instead of a content conflict. Prod has no `wedding_invitation` record yet, so it
 * would be created from this same manifest value.
 */
const WEDDING_INVITATION_CREATED_AT = "2026-08-15T23:50:05.354Z";

export class WhatsappTemplateManifestError extends AppError {
  constructor(message: string) {
    super(message, 404, "TEMPLATE_NOT_FOUND");
    this.name = "WhatsappTemplateManifestError";
  }
}

const manifestStaticButtonSchema = z.object({
  index: z.number().int().min(0).max(99),
  subType: z.literal("url"),
  text: z.string().min(1),
  url: z.string().url()
}).strict();

const manifestButtonSchema = z.object({
  index: z.number().int().min(0).max(99),
  buttonId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  action: WhatsappRsvpActionSchema
}).strict();

export const WhatsappTemplateManifestEntrySchema = z.object({
  /** Seedable as-is: this is exactly what Step 06 writes to DynamoDB. */
  definition: WhatsappTemplateDefinitionSchema,
  /** Audit and traceability only — sends address a template by name + language, never by id. */
  metaTemplateId: z.string().regex(/^\d+$/).optional(),
  category: z.enum(["UTILITY", "MARKETING"]),
  /** Absent for `wedding_invitation`, which is not part of the RSVP flow. */
  flowStage: WhatsappFlowStageSchema.optional(),
  approvalStatus: z.enum(["approved", "pending_meta_approval"]),
  /** Variable-free buttons Meta renders from the template; they must never be sent as components. */
  staticButtons: z.array(manifestStaticButtonSchema).default([]),
  buttons: z.array(manifestButtonSchema).default([]),
  description: z.string().min(1)
}).strict();

export type WhatsappTemplateManifestEntry = z.infer<typeof WhatsappTemplateManifestEntrySchema>;

function storedButtons(entry: WhatsappTemplateManifestEntry) {
  return entry.definition.components.filter(
    (component): component is Extract<typeof component, { type: "button" }> =>
      component.type === "button"
  );
}

/**
 * Cross-entry invariants, checked once at module load so a manifest typo fails a test run rather
 * than a live send.
 */
const WhatsappTemplateManifestSchema = z
  .record(WhatsappTemplateManifestEntrySchema)
  .superRefine((manifest, context) => {
    const fail = (message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, message });

    const purposes = Object.keys(manifest);
    for (const expected of WHATSAPP_RSVP_TEMPLATE_PURPOSES) {
      if (!purposes.includes(expected)) fail(`Manifest is missing the ${expected} entry.`);
    }
    for (const purpose of purposes) {
      if (!(WHATSAPP_RSVP_TEMPLATE_PURPOSES as readonly string[]).includes(purpose)) {
        fail(`Manifest entry ${purpose} is not a known RSVP template purpose.`);
      }
      if (manifest[purpose].definition.purpose !== purpose) {
        fail(`Manifest key ${purpose} does not match its definition purpose.`);
      }
    }

    const allButtonIds: string[] = [];
    for (const [purpose, entry] of Object.entries(manifest)) {
      const buttons = storedButtons(entry);
      const quickReplies = buttons.filter((button) => button.subType === "quick_reply");

      for (const declared of entry.buttons) {
        const match = quickReplies.find((button) => button.index === declared.index);
        if (!match) fail(`${purpose} declares button index ${declared.index} with no quick-reply component.`);
        else if (match.buttonId !== declared.buttonId) {
          fail(`${purpose} button index ${declared.index} declares ${declared.buttonId} but stores ${match.buttonId}.`);
        }
      }
      for (const quickReply of quickReplies) {
        if (!entry.buttons.some((declared) => declared.index === quickReply.index)) {
          fail(`${purpose} stores a quick reply at index ${quickReply.index} with no declared action.`);
        }
      }

      const indexes = buttons.map((button) => button.index).sort((a, b) => a - b);
      indexes.forEach((index, position) => {
        if (index !== position) fail(`${purpose} button indexes must be contiguous from 0.`);
      });

      if (entry.definition.parameterFormat === "named") {
        for (const component of entry.definition.components) {
          if (component.type === "button") continue;
          for (const slot of component.parameters) {
            if (slot.type !== "text") {
              fail(`${purpose} is NAMED, so its ${component.type} slot ${slot.key} must be text.`);
            }
          }
        }
      }

      allButtonIds.push(...entry.buttons.map((button) => button.buttonId));
    }

    // A button id that contains another kills exact-match routing the moment someone reaches for
    // `includes()`. Rejecting substrings here makes that class of mis-route unrepresentable.
    for (const buttonId of allButtonIds) {
      if (allButtonIds.filter((other) => other === buttonId).length > 1) {
        fail(`Button id ${buttonId} is declared more than once.`);
      }
      for (const other of allButtonIds) {
        if (other !== buttonId && other.includes(buttonId)) {
          fail(`Button id ${buttonId} is a substring of ${other}.`);
        }
      }
    }
  });

export const WHATSAPP_TEMPLATE_MANIFEST: Readonly<Record<string, WhatsappTemplateManifestEntry>> =
  Object.freeze(
    WhatsappTemplateManifestSchema.parse({
      /*
       * The template already seeded and active before the RSVP flow existed. Positional and
       * variable-free; kept in the manifest so the complete catalog has one home, never re-seeded.
       */
      wedding_invitation: {
        definition: {
          purpose: "wedding_invitation",
          version: 1,
          name: "wedding",
          language: "en",
          parameterFormat: "positional",
          components: [],
          createdAt: WEDDING_INVITATION_CREATED_AT
        },
        category: "UTILITY",
        approvalStatus: "approved",
        description: "Pre-existing invitation template. No variables, no buttons, not part of the RSVP flow."
      },

      /*
       * Branch A opener — households that already confirmed on the website.
       *
       * Olá, *{{household_name}}*! 👋
       *
       * Aqui é o assistente do casamento da Brida e do Max! 💍
       *
       * Vocês já confirmaram presença pelo convite {{invitation_code}}.
       *
       * 📝 Confirmados: {{guests}}
       *
       * Se surgir algum imprevisto ou alguma mudança, não tem problema! É só avisar a gente. 🤍
       *
       * Podemos contar com a presença de vocês? 👇
       */
      wedding_rsvp_reconfirmation: {
        definition: {
          purpose: "wedding_rsvp_reconfirmation",
          version: 2,
          name: "wedding_rsvp_reconfirmation",
          language: "pt_BR",
          parameterFormat: "named",
          components: [
            {
              type: "body",
              parameters: [
                { key: "household_name", type: "text" },
                { key: "invitation_code", type: "text" },
                { key: "guests", type: "text" }
              ]
            },
            { type: "button", subType: "quick_reply", index: 0, buttonId: "rsvp_a1_confirm_all", parameters: [] },
            {
              type: "button",
              subType: "url",
              index: 1,
              parameters: [{ key: "invitation_link_suffix", type: "text" }]
            }
          ],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "1065748079365393",
        category: "UTILITY",
        flowStage: "reconfirmation",
        approvalStatus: "approved",
        buttons: [{ index: 0, buttonId: "rsvp_a1_confirm_all", action: "confirm_all" }],
        description:
          "Branch A opener. Asks an already-confirmed household to reconfirm; the URL button deep-links to the site for changes."
      },

      /*
       * Branch A1 follow-up — sent after a household confirms in WhatsApp.
       *
       * Temos um encontro marcado, *{{household_name}}*! 💍✨
       *
       * Estamos muito felizes com a confirmação! 🤍
       *
       * Se surgir algum imprevisto, é só atualizar a confirmação pelo link anterior.
       *
       * 🚗 Teremos estacionamento gratuito com manobrista no local.
       *
       * Já salva o endereço nos favoritos para o grande dia! 👇
       */
      wedding_rsvp_attending_followup: {
        definition: {
          purpose: "wedding_rsvp_attending_followup",
          version: 2,
          name: "wedding_rsvp_attending_followup",
          language: "pt_BR",
          parameterFormat: "named",
          components: [
            { type: "body", parameters: [{ key: "household_name", type: "text" }] }
          ],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "1099327752756506",
        category: "UTILITY",
        flowStage: "followup",
        approvalStatus: "approved",
        // Variable-free, so Meta renders it from the approved template and the send payload must
        // omit the button component entirely. Recorded here for documentation only.
        staticButtons: [
          { index: 0, subType: "url", text: "Ver no mapa", url: "https://maps.app.goo.gl/a7pZhhReympySbiq6" }
        ],
        description: "Branch A1 follow-up. Confirms attendance and links to the venue map via a static URL button."
      },

      /*
       * Branch B opener — households that have not confirmed anywhere. The only MARKETING template.
       *
       * Olá, *{{household_name}}*! 🤍
       *
       * Aqui é o assistente do casamento da Brida e do Max! 💍
       *
       * Esperamos poder celebrar esse dia ao lado de vocês! 🤍
       *
       * 📝 {{guests}}
       *
       * O casamento será em 6 de dezembro de 2026.
       *
       * Podemos contar com vocês? 👇
       */
      wedding_rsvp_pending_reminder_group: {
        definition: {
          purpose: "wedding_rsvp_pending_reminder_group",
          version: 1,
          name: "wedding_rsvp_pending_reminder_group",
          language: "pt_BR",
          parameterFormat: "named",
          components: [
            {
              type: "body",
              parameters: [
                { key: "household_name", type: "text" },
                { key: "guests", type: "text" }
              ]
            },
            { type: "button", subType: "quick_reply", index: 0, buttonId: "rsvp_b3_undecided", parameters: [] },
            { type: "button", subType: "quick_reply", index: 1, buttonId: "rsvp_b2_decline", parameters: [] },
            {
              type: "button",
              subType: "url",
              index: 2,
              parameters: [{ key: "invitation_link_suffix", type: "text" }]
            }
          ],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "1802419257592031",
        category: "MARKETING",
        flowStage: "pending",
        approvalStatus: "approved",
        buttons: [
          { index: 0, buttonId: "rsvp_b3_undecided", action: "undecided" },
          { index: 1, buttonId: "rsvp_b2_decline", action: "decline" }
        ],
        description:
          "Branch B opener, sent to every household that has not confirmed. MARKETING category: per-recipient limits, opt-out handling and stricter pacing apply."
      },

      /*
       * Branch B2 follow-up — sent after a household declines.
       *
       * O grande dia não será o mesmo sem vocês, *{{household_name}}*! 🥺
       *
       * Os noivos entendem que imprevistos acontecem e agradecem por avisarem.
       *
       * Se os planos mudarem, será uma alegria enorme receber vocês no grande dia! 🤍
       *
       * É só atualizar a confirmação pelo site através do link abaixo👇
       */
      wedding_rsvp_declined_followup: {
        definition: {
          purpose: "wedding_rsvp_declined_followup",
          version: 2,
          name: "wedding_rsvp_declined_followup",
          language: "pt_BR",
          parameterFormat: "named",
          components: [
            { type: "body", parameters: [{ key: "household_name", type: "text" }] },
            {
              type: "button",
              subType: "url",
              index: 0,
              parameters: [{ key: "invitation_link_suffix", type: "text" }]
            }
          ],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "2372473870257723",
        category: "UTILITY",
        flowStage: "followup",
        approvalStatus: "approved",
        description: "Branch B2 follow-up. Acknowledges a decline and deep-links to the site in case plans change."
      },

      /*
       * Branch B3 follow-up — sent after a household says it is undecided.
       *
       * Tudo bem, *{{household_name}}*! Nós entendemos perfeitamente. 🤍
       *
       * Sabemos que conciliar a agenda às vezes leva um tempinho. Como o grande dia é em dezembro,
       * vocês ainda têm um tempo para organizar tudo com calma.
       *
       * A Brida e o Max fazem muita questão da presença de vocês!
       *
       * Assim que vocês tiverem a confirmação que precisam, é só acessar o link abaixo e atualizar
       * a resposta direto no site
       *
       * Estamos na torcida para que dê tudo certo! ✨
       */
      wedding_rsvp_undecided_followup: {
        definition: {
          purpose: "wedding_rsvp_undecided_followup",
          version: 2,
          name: "wedding_rsvp_undecided_followup",
          language: "pt_BR",
          parameterFormat: "named",
          components: [
            { type: "body", parameters: [{ key: "household_name", type: "text" }] },
            {
              type: "button",
              subType: "url",
              index: 0,
              parameters: [{ key: "invitation_link_suffix", type: "text" }]
            }
          ],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "2064293954294492",
        category: "UTILITY",
        flowStage: "followup",
        approvalStatus: "approved",
        description: "Branch B3 follow-up. Gives an undecided household more time and deep-links to the site."
      },

      wedding_rsvp_reconfirmation_single: {
        definition: {
          purpose: "wedding_rsvp_reconfirmation_single",
          version: 1,
          name: "wedding_rsvp_reconfirmation_single",
          language: "pt_BR",
          parameterFormat: "named",
          components: [
            {
              type: "body",
              parameters: [
                { key: "household_name", type: "text" },
                { key: "invitation_code", type: "text" },
                { key: "guests", type: "text" }
              ]
            },
            { type: "button", subType: "quick_reply", index: 0, buttonId: "rsvp_single_a1_confirm_all", parameters: [] },
            {
              type: "button",
              subType: "url",
              index: 1,
              parameters: [{ key: "invitation_link_suffix", type: "text" }]
            }
          ],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "1617584283318635",
        category: "UTILITY",
        flowStage: "reconfirmation",
        approvalStatus: "approved",
        buttons: [{ index: 0, buttonId: "rsvp_single_a1_confirm_all", action: "confirm_all" }],
        description: "Single-invitee reconfirmation opener with a website update link."
      },

      wedding_rsvp_attending_followup_single: {
        definition: {
          purpose: "wedding_rsvp_attending_followup_single",
          version: 1,
          name: "wedding_rsvp_attending_followup_single",
          language: "pt_BR",
          parameterFormat: "named",
          components: [{ type: "body", parameters: [{ key: "household_name", type: "text" }] }],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "1082082874330927",
        category: "UTILITY",
        flowStage: "followup",
        approvalStatus: "approved",
        staticButtons: [{ index: 0, subType: "url", text: "Ver no mapa", url: "https://maps.app.goo.gl/a7pZhhReympySbiq6" }],
        description: "Single-invitee attendance follow-up with the venue map link."
      },

      wedding_rsvp_pending_reminder_single: {
        definition: {
          purpose: "wedding_rsvp_pending_reminder_single",
          version: 1,
          name: "wedding_rsvp_pending_reminder_single",
          language: "pt_BR",
          parameterFormat: "named",
          components: [
            {
              type: "body",
              parameters: [
                { key: "household_name", type: "text" },
                { key: "guests", type: "text" }
              ]
            },
            { type: "button", subType: "quick_reply", index: 0, buttonId: "rsvp_single_b3_undecided", parameters: [] },
            { type: "button", subType: "quick_reply", index: 1, buttonId: "rsvp_single_b2_decline", parameters: [] },
            {
              type: "button",
              subType: "url",
              index: 2,
              parameters: [{ key: "invitation_link_suffix", type: "text" }]
            }
          ],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "1659080989068863",
        category: "MARKETING",
        flowStage: "pending",
        approvalStatus: "approved",
        buttons: [
          { index: 0, buttonId: "rsvp_single_b3_undecided", action: "undecided" },
          { index: 1, buttonId: "rsvp_single_b2_decline", action: "decline" }
        ],
        description: "Single-invitee pending reminder with quick replies and a website confirmation link."
      },

      wedding_rsvp_attending_followup_website: {
        definition: {
          purpose: "wedding_rsvp_attending_followup_website",
          version: 1,
          name: "wedding_rsvp_attending_followup_website",
          language: "pt_BR",
          parameterFormat: "named",
          components: [{ type: "body", parameters: [{ key: "household_name", type: "text" }] }],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "1410677857628911",
        category: "MARKETING",
        flowStage: "followup",
        approvalStatus: "approved",
        staticButtons: [{ index: 0, subType: "url", text: "Ver no mapa", url: "https://maps.app.goo.gl/a7pZhhReympySbiq6" }],
        description: "Website attendance follow-up for group invitations with the venue map link."
      },

      wedding_rsvp_attending_followup_website_single: {
        definition: {
          purpose: "wedding_rsvp_attending_followup_website_single",
          version: 1,
          name: "wedding_rsvp_attending_followup_website_single",
          language: "pt_BR",
          parameterFormat: "named",
          components: [{ type: "body", parameters: [{ key: "household_name", type: "text" }] }],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "4611876665799667",
        category: "UTILITY",
        flowStage: "followup",
        approvalStatus: "approved",
        staticButtons: [{ index: 0, subType: "url", text: "Ver no mapa", url: "https://maps.app.goo.gl/a7pZhhReympySbiq6" }],
        description: "Website attendance follow-up for single-invitee invitations with the venue map link."
      },

      wedding_rsvp_undecided_followup_single: {
        definition: {
          purpose: "wedding_rsvp_undecided_followup_single",
          version: 1,
          name: "wedding_rsvp_undecided_followup_single",
          language: "pt_BR",
          parameterFormat: "named",
          components: [
            { type: "body", parameters: [{ key: "household_name", type: "text" }] },
            { type: "button", subType: "url", index: 0, parameters: [{ key: "invitation_link_suffix", type: "text" }] }
          ],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "2350419575764263",
        category: "MARKETING",
        flowStage: "followup",
        approvalStatus: "approved",
        description: "Single-invitee undecided follow-up with a website confirmation link."
      },

      wedding_rsvp_declined_followup_single: {
        definition: {
          purpose: "wedding_rsvp_declined_followup_single",
          version: 1,
          name: "wedding_rsvp_declined_followup_single",
          language: "pt_BR",
          parameterFormat: "named",
          components: [
            { type: "body", parameters: [{ key: "household_name", type: "text" }] },
            { type: "button", subType: "url", index: 0, parameters: [{ key: "invitation_link_suffix", type: "text" }] }
          ],
          createdAt: APPROVED_AT
        },
        metaTemplateId: "1047921497652045",
        category: "UTILITY",
        flowStage: "followup",
        approvalStatus: "approved",
        description: "Single-invitee decline follow-up with a website update link."
      }
    })
  );

const actionsByButtonId: ReadonlyMap<string, WhatsappRsvpAction> = new Map(
  Object.values(WHATSAPP_TEMPLATE_MANIFEST).flatMap((entry) =>
    entry.buttons.map((button) => [button.buttonId, button.action] as const)
  )
);

export function listTemplateManifestEntries(): WhatsappTemplateManifestEntry[] {
  return Object.values(WHATSAPP_TEMPLATE_MANIFEST);
}

/** Throws rather than returning undefined: an unknown purpose is a programming error, not a state. */
export function getTemplateManifestEntry(purpose: string): WhatsappTemplateManifestEntry {
  const entry = WHATSAPP_TEMPLATE_MANIFEST[purpose];
  if (!entry) throw new WhatsappTemplateManifestError(`Unknown WhatsApp template purpose ${purpose}.`);
  return entry;
}

/** Undefined for `wedding_invitation`, which declares no stage because it is outside the flow. */
export function flowStageForTemplate(purpose: string): WhatsappFlowStage | undefined {
  return getTemplateManifestEntry(purpose).flowStage;
}

export function templatesByStage(stage: WhatsappFlowStage): WhatsappTemplateManifestEntry[] {
  return listTemplateManifestEntries().filter((entry) => entry.flowStage === stage);
}

/** Exact match only. An unmapped id is unsupported — never fall back to a branch. */
export function actionForButtonId(buttonId: string): WhatsappRsvpAction | undefined {
  return actionsByButtonId.get(buttonId);
}

export type { WhatsappRsvpTemplatePurpose };
