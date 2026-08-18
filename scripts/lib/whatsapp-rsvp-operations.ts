import { pathToFileURL } from "node:url";
import {
  WhatsappPhoneUpdateResponseSchema,
  WhatsappRsvpSendResponseSchema,
  WhatsappRsvpStatusResponseSchema
} from "../../packages/contracts/src/whatsapp-rsvp.ts";
import { WhatsappRsvpService } from "../../apps/api/src/domain/whatsapp-rsvp-service.ts";

const LISTABLE_STATUSES = ["send_queued", "failed", "reconciliation_required"] as const;
type ListableStatus = typeof LISTABLE_STATUSES[number];

function option(argv: readonly string[], name: string) {
  const index = argv.indexOf(name);
  const value = argv[index + 1];
  if (index < 0 || !value || value.startsWith("--")) throw new Error(`Missing ${name}.`);
  return value;
}

export function parseWhatsappRsvpArgs(argv: readonly string[]) {
  const command = argv[0];
  if (!command || !["phone", "send", "status", "list"].includes(command)) {
    throw new Error("Expected phone, send, status, or list.");
  }
  const invitationCode = option(argv, "--invitation-code");
  const rawStatus = command === "list" ? option(argv, "--status") : undefined;
  if (rawStatus && !(LISTABLE_STATUSES as readonly string[]).includes(rawStatus)) {
    throw new Error(`--status must be one of ${LISTABLE_STATUSES.join(", ")}.`);
  }
  return {
    command,
    invitationCode,
    phoneNumber: command === "phone" ? option(argv, "--phone") : undefined,
    templateId: command === "send" ? option(argv, "--template-id") : undefined,
    status: rawStatus as ListableStatus | undefined,
    apply: argv.includes("--apply"),
    confirmSend: argv.includes("--confirm-send"),
    full: argv.includes("--full")
  };
}

export function redactWhatsappPhone(phoneNumber: string | undefined) {
  if (!phoneNumber) return undefined;
  return phoneNumber.length <= 4 ? "****" : `${"*".repeat(phoneNumber.length - 4)}${phoneNumber.slice(-4)}`;
}

export function filterWhatsappRsvpHistory(
  history: NonNullable<Awaited<ReturnType<WhatsappRsvpService["getStatus"]>>["history"]>,
  requestedStatus: ListableStatus,
  flowStatus: string
) {
  return history.filter((entry) => {
    if (entry.kind !== "command") return false;
    if (requestedStatus === "send_queued") {
      return flowStatus === "send_queued" && (entry.status === "queued" || entry.status === "sending");
    }
    if (requestedStatus === "failed") return entry.status === "failed";
    return entry.status === "reconciliation_required" || entry.reconciliationStatus === "required";
  });
}

function safeStatusOutput(status: Awaited<ReturnType<WhatsappRsvpService["getStatus"]>>, full: boolean) {
  if (full) return status;
  return { ...status, phoneNumber: redactWhatsappPhone(status.phoneNumber) };
}

async function main() {
  const args = parseWhatsappRsvpArgs(process.argv.slice(2));
  const stage = process.env.STAGE?.trim() ?? "";
  const service = new WhatsappRsvpService();
  if (args.command === "phone") {
    if (!args.apply) throw new Error("Phone updates are dry-run by default; pass --apply.");
    console.log(JSON.stringify(WhatsappPhoneUpdateResponseSchema.parse(await service.updatePhone(args.invitationCode, args.phoneNumber!)), null, 2));
    return;
  }
  if (args.command === "send") {
    if (stage !== "dev") {
      throw new Error("The RSVP CLI is intentionally dev-only; production sends require a separately approved campaign path.");
    }
    if (!args.confirmSend) throw new Error("Real sends require STAGE=dev and --confirm-send.");
    console.log(JSON.stringify(WhatsappRsvpSendResponseSchema.parse(await service.queueTemplate(args.invitationCode, args.templateId!)), null, 2));
    return;
  }
  const status = WhatsappRsvpStatusResponseSchema.parse(await service.getStatus(args.invitationCode));
  if (args.command === "list") {
    const entries = filterWhatsappRsvpHistory(status.history ?? [], args.status!, status.status);
    console.log(JSON.stringify({ invitationCode: status.invitationCode, status: args.status, entries }, null, 2));
    return;
  }
  console.log(JSON.stringify(safeStatusOutput(status, args.full), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
