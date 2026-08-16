import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WhatsappApiError } from "../../apps/api/src/services/whatsapp/client.ts";
import { WhatsappTemplateMessageService } from "../../apps/api/src/services/whatsapp/template-message-service.ts";
import { WhatsappTemplateParameterSchema } from "../../apps/api/src/services/whatsapp/schemas.ts";

export type SendWhatsappTemplateOptions = {
  confirmSend: boolean;
  parametersFile?: string;
  purpose: string;
  recipient: string;
  stage: string;
};

function optionValue(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

export function parseSendWhatsappTemplateArgs(
  argv: readonly string[],
  stage = process.env.STAGE?.trim() ?? ""
): SendWhatsappTemplateOptions {
  const purpose = optionValue(argv, "--purpose");
  const recipient = optionValue(argv, "--recipient");
  if (!purpose) throw new Error("Missing required --purpose.");
  if (!recipient) throw new Error("Missing required --recipient.");
  if (stage !== "dev") throw new Error("Real WhatsApp template sends are restricted to the dev stage.");
  if (!argv.includes("--confirm-send")) {
    throw new Error("Refusing to send without --confirm-send.");
  }
  return {
    confirmSend: true,
    parametersFile: optionValue(argv, "--parameters-file"),
    purpose,
    recipient,
    stage
  };
}

function loadParameters(filePath: string | undefined) {
  if (!filePath) return undefined;
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("WhatsApp parameters file must contain a JSON object.");
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, WhatsappTemplateParameterSchema.parse(value)])
  );
}

export async function runSendWhatsappTemplate(
  options: SendWhatsappTemplateOptions,
  service = new WhatsappTemplateMessageService()
) {
  if (options.stage !== "dev" || !options.confirmSend) {
    throw new Error("Refusing to send without dev-stage confirmation.");
  }

  const result = await service.send(
    {
      purpose: options.purpose,
      to: options.recipient,
      parameters: loadParameters(options.parametersFile)
    },
    { requestId: randomUUID() }
  );
  return {
    stage: options.stage,
    templatePurpose: result.templatePurpose,
    templateVersion: result.templateVersion,
    messageId: result.messageId,
    providerTraceId: result.providerTraceId
  };
}

export function formatSendWhatsappTemplateFailure(error: unknown) {
  if (
    error instanceof WhatsappApiError &&
    (error.category === "timeout" || error.category === "network" || error.category === "ambiguous_delivery")
  ) {
    return `${error.message} Do not resend until the original attempt has been manually reconciled.`;
  }
  return error instanceof WhatsappApiError ? error.message : "WhatsApp template send failed.";
}

async function main() {
  const options = parseSendWhatsappTemplateArgs(process.argv.slice(2));
  console.warn("This command sends an irreversible external WhatsApp message and may consume rate limits or incur charges.");
  const result = await runSendWhatsappTemplate(options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(formatSendWhatsappTemplateFailure(error));
    process.exitCode = 1;
  });
}
