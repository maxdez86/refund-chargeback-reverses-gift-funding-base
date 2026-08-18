import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WhatsappTemplateRepository } from "../../apps/api/src/services/whatsapp/template-repository.ts";
import {
  WhatsappStoredComponentSchema,
  WhatsappTemplateDefinitionSchema,
  WhatsappTemplatePurposeSchema,
  type WhatsappTemplateDefinition
} from "../../apps/api/src/services/whatsapp/schemas.ts";
import {
  listTemplateManifestEntries,
  type WhatsappTemplateManifestEntry
} from "../../apps/api/src/services/whatsapp/template-manifest.ts";

type ManageCommand = "create" | "activate" | "show" | "list" | "seed";

export type ManageWhatsappTemplateOptions = {
  command: ManageCommand;
  apply: boolean;
  confirmProd: boolean;
  purpose?: string;
  version?: number;
  name?: string;
  language?: string;
  componentsFile?: string;
  activate?: boolean;
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
  if (!command || !["create", "activate", "show", "list", "seed"].includes(command)) {
    throw new Error("Expected command create, activate, show, list, or seed.");
  }
  const rawPurpose = optionValue(argv, "--purpose");
  const purpose = rawPurpose === undefined ? undefined : WhatsappTemplatePurposeSchema.parse(rawPurpose);
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
    componentsFile: optionValue(argv, "--components-file"),
    activate: argv.includes("--activate")
  };
  if ((command === "create" || command === "activate" || command === "show" || command === "list") && !purpose) {
    throw new Error(`${command} requires --purpose.`);
  }
  if ((command === "create" || command === "activate" || command === "show") && !version) {
    throw new Error(`${command} requires --version.`);
  }
  if (command === "create" && (!options.name || !options.language)) {
    throw new Error("create requires --name and --language.");
  }
  if (command === "seed" && options.componentsFile && !purpose) {
    throw new Error("seed --components-file requires --purpose.");
  }
  if (command !== "seed" && options.activate) throw new Error("--activate is only supported by seed.");
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

type TemplateRepository = Pick<
  WhatsappTemplateRepository,
  "createVersion" | "getVersion" | "getActive" | "activate" | "listVersions"
>;
type SeedStatus = "create" | "unchanged" | "conflict" | "already-active";

export type SeedPlanEntry = {
  purpose: string;
  version: number;
  name: string;
  language: string;
  status: SeedStatus;
  activation?: "activate" | "blocked-pending-approval";
};

function comparableDefinition(definition: WhatsappTemplateDefinition) {
  return {
    purpose: definition.purpose,
    version: definition.version,
    name: definition.name,
    language: definition.language,
    parameterFormat: definition.parameterFormat,
    components: definition.components,
    createdAt: definition.createdAt
  };
}

function sameDefinition(left: WhatsappTemplateDefinition, right: WhatsappTemplateDefinition) {
  return JSON.stringify(comparableDefinition(left)) === JSON.stringify(comparableDefinition(right));
}

function safePlanEntry(entry: WhatsappTemplateManifestEntry, status: SeedStatus, activation?: SeedPlanEntry["activation"]): SeedPlanEntry {
  return {
    purpose: entry.definition.purpose,
    version: entry.definition.version,
    name: entry.definition.name,
    language: entry.definition.language,
    status,
    ...(activation ? { activation } : {})
  };
}

async function seedTemplates(
  options: ManageWhatsappTemplateOptions,
  repository: TemplateRepository,
  manifest = listTemplateManifestEntries()
) {
  const selected = options.purpose ? manifest.filter((entry) => entry.definition.purpose === options.purpose) : manifest;
  if (selected.length === 0) throw new Error(`No WhatsApp template manifest entry found for ${options.purpose}.`);
  const componentOverride = options.componentsFile ? loadComponents(options.componentsFile) : undefined;
  const inspected = await Promise.all(selected.map(async (entry) => {
    const definition = componentOverride
      ? WhatsappTemplateDefinitionSchema.parse({ ...entry.definition, components: componentOverride })
      : entry.definition;
    return {
      entry,
      definition,
      stored: await repository.getVersion(definition.purpose, definition.version),
      active: await repository.getActive(definition.purpose)
    };
  }));

  const conflicts = inspected.filter(({ definition, stored }) => stored && !sameDefinition(stored, definition));
  if (conflicts.length > 0) {
    throw new Error(conflicts.map(({ definition }) =>
      `${definition.purpose} version ${definition.version} already exists with different content; bump the manifest version.`
    ).join(" "));
  }

  const plan: SeedPlanEntry[] = inspected.map(({ entry, definition, stored, active }) => {
    const status: SeedStatus = stored ? (active?.version === definition.version ? "already-active" : "unchanged") : "create";
    const activation = options.activate && active?.version !== definition.version
      ? entry.approvalStatus === "approved" ? "activate" : "blocked-pending-approval"
      : undefined;
    return safePlanEntry(entry, status, activation);
  });
  const blocked = plan.filter((item) => item.activation === "blocked-pending-approval");
  if (blocked.length > 0) throw new Error(`Refusing to activate unapproved WhatsApp templates: ${blocked.map((item) => item.purpose).join(", " )}.`);
  if (!options.apply) return { mode: "dry-run" as const, plan };

  const completed: string[] = [];
  try {
    for (const item of inspected) {
      if (!item.stored) await repository.createVersion(item.definition);
      completed.push(item.definition.purpose);
    }
    if (options.activate) {
      for (const item of inspected) {
        if (item.active?.version !== item.definition.version) await repository.activate(item.definition.purpose, item.definition.version);
      }
      for (const item of inspected) {
        const active = await repository.getActive(item.definition.purpose);
        if (!active || !sameDefinition(active, item.definition)) {
          throw new Error(`Active WhatsApp template verification failed for ${item.definition.purpose} version ${item.definition.version}.`);
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const progress = completed.length > 0 ? ` (${completed.join(", ")})` : "";
    throw new Error(`WhatsApp template seed partially applied${progress}: ${message}`);
  }
  return { mode: "applied" as const, plan };
}

export async function runManageWhatsappTemplates(
  options: ManageWhatsappTemplateOptions,
  repository: TemplateRepository = new WhatsappTemplateRepository(undefined, requiredEnv("WEDDING_TABLE_NAME")),
  stage = process.env.STAGE?.trim() ?? "",
  manifest: WhatsappTemplateManifestEntry[] = listTemplateManifestEntries()
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
  if (options.command === "seed") return seedTemplates(options, repository, manifest);
  if (options.command === "activate") {
    if (!options.apply) {
      const definition = await repository.getVersion(options.purpose!, options.version!);
      if (!definition) throw new Error("WhatsApp template version does not exist.");
      return { mode: "dry-run" as const, activation: { purpose: options.purpose, version: options.version } };
    }
    return { mode: "applied" as const, activation: await repository.activate(options.purpose!, options.version!) };
  }
  if (options.command === "show") {
    const definition = await repository.getVersion(options.purpose!, options.version!);
    if (!definition) throw new Error("WhatsApp template version does not exist.");
    return { mode: "read" as const, definition };
  }
  return { mode: "read" as const, definitions: await repository.listVersions(options.purpose!) };
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
