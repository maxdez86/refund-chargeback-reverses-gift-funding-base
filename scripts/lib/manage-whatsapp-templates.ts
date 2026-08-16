import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WhatsappTemplateRepository } from "../../apps/api/src/services/whatsapp/template-repository.ts";
import {
  WhatsappStoredComponentSchema,
  WhatsappTemplateDefinitionSchema,
  WhatsappTemplatePurposeSchema
} from "../../apps/api/src/services/whatsapp/schemas.ts";

type ManageCommand = "create" | "activate" | "show" | "list";

export type ManageWhatsappTemplateOptions = {
  command: ManageCommand;
  apply: boolean;
  confirmProd: boolean;
  purpose: string;
  version?: number;
  name?: string;
  language?: string;
  componentsFile?: string;
};

function optionValue(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

export function parseManageWhatsappTemplateArgs(argv: readonly string[]): ManageWhatsappTemplateOptions {
  const command = argv[0];
  if (!command || !["create", "activate", "show", "list"].includes(command)) {
    throw new Error("Expected command create, activate, show, or list.");
  }
  const purpose = WhatsappTemplatePurposeSchema.parse(optionValue(argv, "--purpose"));
  const rawVersion = optionValue(argv, "--version");
  const version = rawVersion === undefined ? undefined : Number(rawVersion);
  if (rawVersion !== undefined && (!Number.isInteger(version) || Number(version) <= 0)) {
    throw new Error("--version must be a positive integer.");
  }

  const options: ManageWhatsappTemplateOptions = {
    command: command as ManageCommand,
    apply: argv.includes("--apply"),
    confirmProd: argv.includes("--confirm-prod"),
    purpose,
    version,
    name: optionValue(argv, "--name"),
    language: optionValue(argv, "--language"),
    componentsFile: optionValue(argv, "--components-file")
  };
  if ((command === "create" || command === "activate" || command === "show") && !version) {
    throw new Error(`${command} requires --version.`);
  }
  if (command === "create" && (!options.name || !options.language)) {
    throw new Error("create requires --name and --language.");
  }
  return options;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function loadComponents(filePath: string | undefined) {
  if (!filePath) return [];
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  return WhatsappStoredComponentSchema.array().parse(parsed);
}

export async function runManageWhatsappTemplates(
  options: ManageWhatsappTemplateOptions,
  repository = new WhatsappTemplateRepository(undefined, requiredEnv("WEDDING_TABLE_NAME")),
  stage = process.env.STAGE?.trim() ?? ""
) {
  if (stage === "prod" && options.apply && !options.confirmProd) {
    throw new Error("Refusing to modify production WhatsApp templates without --confirm-prod.");
  }

  if (options.command === "create") {
    const definition = WhatsappTemplateDefinitionSchema.parse({
      purpose: options.purpose,
      version: options.version,
      name: options.name,
      language: options.language,
      components: loadComponents(options.componentsFile),
      createdAt: new Date().toISOString()
    });
    if (!options.apply) return { mode: "dry-run" as const, definition };
    return { mode: "applied" as const, definition: await repository.createVersion(definition) };
  }

  if (options.command === "activate") {
    if (!options.apply) {
      const definition = await repository.getVersion(options.purpose, options.version!);
      if (!definition) throw new Error("WhatsApp template version does not exist.");
      return { mode: "dry-run" as const, activation: { purpose: options.purpose, version: options.version } };
    }
    return { mode: "applied" as const, activation: await repository.activate(options.purpose, options.version!) };
  }

  if (options.command === "show") {
    const definition = await repository.getVersion(options.purpose, options.version!);
    if (!definition) throw new Error("WhatsApp template version does not exist.");
    return { mode: "read" as const, definition };
  }

  return { mode: "read" as const, definitions: await repository.listVersions(options.purpose) };
}

async function main() {
  const options = parseManageWhatsappTemplateArgs(process.argv.slice(2));
  const result = await runManageWhatsappTemplates(options);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "WhatsApp template operation failed.");
    process.exitCode = 1;
  });
}
