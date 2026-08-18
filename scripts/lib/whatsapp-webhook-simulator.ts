import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseWhatsappWebhook } from "../../apps/api/src/services/whatsapp/webhook-parser.ts";
import { templatesByStage } from "../../apps/api/src/services/whatsapp/template-manifest.ts";

export type WhatsappSimulatorBranch = "a1" | "b1" | "b2" | "b3" | "fallback" | "duplicate";

const branchButton = {
  a1: () => templatesByStage("reconfirmation")[0]?.buttons[0],
  b1: () => templatesByStage("pending")[0]?.buttons[0],
  b2: () => templatesByStage("pending")[0]?.buttons[1],
  b3: () => templatesByStage("pending")[0]?.buttons[2]
} as const;

function option(argv: readonly string[], name: string, fallback?: string) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

export function parseWhatsappSimulatorArgs(argv: readonly string[]) {
  const branch = option(argv, "--branch");
  if (branch === "a2" || branch === "a2-website") {
    throw new Error("A2 is a website action, not a WhatsApp webhook event; use the website RSVP path.");
  }
  if (!branch || !["a1", "b1", "b2", "b3", "fallback", "duplicate"].includes(branch)) {
    throw new Error("Expected --branch a1, b1, b2, b3, fallback, or duplicate.");
  }
  return {
    branch: branch as WhatsappSimulatorBranch,
    invitationCode: option(argv, "--invitation-code", "SW0000")!
  };
}

function buttonForBranch(branch: Exclude<WhatsappSimulatorBranch, "fallback" | "duplicate">) {
  const button = branchButton[branch]();
  if (!button) throw new Error(`No manifest quick reply is configured for branch ${branch}.`);
  return button;
}

function messageForBranch(branch: WhatsappSimulatorBranch, invitationCode: string, messageId: string) {
  const common = {
    id: messageId,
    from: "5511900000000",
    timestamp: "1790000000",
    context: { id: `wamid.synthetic-outbound-${invitationCode}` }
  };

  if (branch === "fallback") {
    return { ...common, type: "text", text: { body: "Synthetic fallback input" } };
  }

  const actualBranch = branch === "duplicate" ? "b2" : branch;
  const button = buttonForBranch(actualBranch);
  return {
    ...common,
    type: "button",
    button: { payload: button.buttonId, text: `Synthetic ${button.action}` }
  };
}

export function buildWhatsappWebhookPayload(branch: WhatsappSimulatorBranch, invitationCode = "SW0000") {
  const messageId = `wamid.synthetic-${branch}-${invitationCode}`;
  const messages = [messageForBranch(branch, invitationCode, messageId)];
  if (branch === "duplicate") messages.push(messageForBranch(branch, invitationCode, messageId));
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-synthetic",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: {
            display_phone_number: "synthetic-display-number",
            phone_number_id: "synthetic-phone-number-id"
          },
          contacts: [{ wa_id: "5511900000000" }],
          messages
        }
      }]
    }]
  };
}

export function serializeWhatsappWebhookPayload(payload: unknown) {
  return JSON.stringify(payload);
}

export function whatsappWebhookSignature(rawBody: string, appSecret: string) {
  if (!appSecret) throw new Error("A non-empty app secret is required to sign the synthetic payload.");
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

export function simulateWhatsappWebhook(branch: WhatsappSimulatorBranch, invitationCode: string, appSecret: string) {
  const payload = buildWhatsappWebhookPayload(branch, invitationCode);
  const rawBody = serializeWhatsappWebhookPayload(payload);
  return {
    branch,
    signature: whatsappWebhookSignature(rawBody, appSecret),
    parsed: parseWhatsappWebhook(payload)
  };
}

async function main() {
  const options = parseWhatsappSimulatorArgs(process.argv.slice(2));
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!appSecret) throw new Error("Missing WHATSAPP_APP_SECRET; the simulator never retrieves secrets from AWS.");
  console.log(JSON.stringify(simulateWhatsappWebhook(options.branch, options.invitationCode, appSecret), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
