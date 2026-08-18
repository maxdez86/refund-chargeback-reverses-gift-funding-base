import { AppError } from "../../lib/errors";
import { WhatsappCloudApiClient } from "./client";
import {
  WhatsappRecipientSchema,
  WhatsappTemplateParameterSchema,
  WhatsappTemplatePurposeSchema,
  type WhatsappStoredComponent,
  type WhatsappTemplateComponent,
  type WhatsappTemplateParameter,
  type WhatsappTemplateParameterFormat,
  type WhatsappTemplateDefinition
} from "./schemas";
import { WhatsappTemplateRepository, WhatsappTemplateNotFoundError } from "./template-repository";

type SendApprovedTemplateInput = {
  purpose: string;
  to: string;
  parameters?: Record<string, WhatsappTemplateParameter>;
};

function bindComponents(
  definitions: WhatsappStoredComponent[],
  rawParameters: Record<string, WhatsappTemplateParameter>,
  parameterFormat: WhatsappTemplateParameterFormat = "positional"
): WhatsappTemplateComponent[] | undefined {
  const parameters = Object.fromEntries(
    Object.entries(rawParameters).map(([key, value]) => [key, WhatsappTemplateParameterSchema.parse(value)])
  );
  const consumed = new Set<string>();

  const components = definitions.map((component) => {
    const bound = component.parameters.map((slot) => {
      const value = parameters[slot.key];
      if (!value) throw new AppError(`Missing WhatsApp template parameter ${slot.key}.`, 400);
      if (value.type !== slot.type) {
        throw new AppError(`WhatsApp template parameter ${slot.key} has the wrong type.`, 400);
      }
      consumed.add(slot.key);
      // Meta requires a parameter_name on every header/body parameter of a NAMED template. Button
      // parameters stay positional: URL buttons use {{1}} and quick replies carry a payload.
      if (component.type !== "button" && parameterFormat === "named") {
        if (value.type !== "text") {
          throw new AppError(`NAMED WhatsApp template slot ${slot.key} must be a text parameter.`, 400);
        }
        return { ...value, parameter_name: slot.key };
      }
      return value;
    });

    if (component.type !== "button") {
      return { type: component.type, parameters: bound } as WhatsappTemplateComponent;
    }

    const buttonParameters = component.buttonId
      ? [{ type: "payload" as const, payload: component.buttonId }, ...bound]
      : bound;
    return {
      type: "button" as const,
      sub_type: component.subType,
      index: String(component.index),
      parameters: buttonParameters
    };
  });

  const unexpected = Object.keys(parameters).filter((key) => !consumed.has(key));
  if (unexpected.length > 0) {
    throw new AppError(`Unexpected WhatsApp template parameter ${unexpected[0]}.`, 400);
  }

  return components.length > 0 ? components : undefined;
}

export class WhatsappTemplateMessageService {
  constructor(
    private readonly repository = new WhatsappTemplateRepository(),
    private readonly client = new WhatsappCloudApiClient()
  ) {}

  async send(
    input: SendApprovedTemplateInput,
    context: { requestId: string },
    suppliedDefinition?: WhatsappTemplateDefinition
  ) {
    const purpose = WhatsappTemplatePurposeSchema.parse(input.purpose);
    const to = WhatsappRecipientSchema.parse(input.to);
    const definition = suppliedDefinition ?? await this.repository.getActive(purpose);
    if (!definition) throw new WhatsappTemplateNotFoundError("No active WhatsApp template exists.");

    const components = bindComponents(
      definition.components,
      input.parameters ?? {},
      definition.parameterFormat
    );
    const response = await this.client.sendTemplate(
      {
        to,
        template: {
          name: definition.name,
          language: definition.language,
          ...(components ? { components } : {})
        }
      },
      { requestId: context.requestId, templatePurpose: purpose, templateVersion: definition.version }
    );

    return { ...response, templatePurpose: purpose, templateVersion: definition.version };
  }
}

export { bindComponents };
export type { SendApprovedTemplateInput };
