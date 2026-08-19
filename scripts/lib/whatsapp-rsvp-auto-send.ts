import { pathToFileURL } from "node:url";
import { InvitationCodeSchema } from "../../packages/contracts/src/invitation-code.ts";
import { WhatsappRsvpSendResponseSchema } from "../../packages/contracts/src/whatsapp-rsvp.ts";

export function parseWhatsappRsvpAutoSendArgs(argv: readonly string[]) {
  if (argv.length === 0 || argv[0] !== "--invitation-code") {
    throw new Error("Expected --invitation-code <code>.");
  }
  const invitationCode = argv[1];
  if (!invitationCode || invitationCode.startsWith("--")) throw new Error("Missing --invitation-code.");
  InvitationCodeSchema.parse(invitationCode);
  if (argv.slice(2).some((argument) => argument !== "--confirm-send")) {
    throw new Error("Only --invitation-code and --confirm-send are supported.");
  }
  const confirmSend = argv.includes("--confirm-send");
  if (!confirmSend) throw new Error("Real sends require --confirm-send.");
  return { invitationCode, confirmSend };
}

export async function autoSendWhatsappRsvp(
  invitationCode: string,
  input: {
    apiBaseUrl: string;
    authorization: string;
    fetchImpl?: typeof fetch;
  }
) {
  const response = await (input.fetchImpl ?? fetch)(
    `${input.apiBaseUrl.replace(/\/+$/, "")}/admin/whatsapp/invitations/${encodeURIComponent(invitationCode)}/send-rsvp`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: input.authorization,
        "idempotency-key": `auto-rsvp-${invitationCode}`
      }
    }
  );
  const text = await response.text();
  const parsed = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    const message = parsed && typeof parsed === "object" && "message" in parsed
      ? String(parsed.message)
      : `WhatsApp RSVP auto-send failed with status ${response.status}.`;
    throw new Error(message);
  }
  return WhatsappRsvpSendResponseSchema.parse(parsed);
}

async function main() {
  const args = parseWhatsappRsvpAutoSendArgs(process.argv.slice(2));
  if (process.env.STAGE !== "dev") throw new Error("The RSVP auto-send CLI is intentionally dev-only.");
  if (!args.confirmSend) throw new Error("Real sends require STAGE=dev and --confirm-send.");
  const apiBaseUrl = process.env.PAYMENTS_API_URL?.trim();
  const authorization = process.env.ADMIN_AUTHORIZATION?.trim();
  if (!apiBaseUrl) throw new Error("Missing PAYMENTS_API_URL.");
  if (!authorization) throw new Error("Missing ADMIN_AUTHORIZATION (use a Google admin Bearer token).");
  console.log(JSON.stringify(await autoSendWhatsappRsvp(args.invitationCode, { apiBaseUrl, authorization }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
