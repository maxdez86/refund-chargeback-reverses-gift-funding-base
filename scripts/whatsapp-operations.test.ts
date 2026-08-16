import test from "node:test";
import assert from "node:assert/strict";
import { WhatsappApiError } from "../apps/api/src/services/whatsapp/client.ts";
import { parseManageWhatsappTemplateArgs } from "./lib/manage-whatsapp-templates.ts";
import {
  formatSendWhatsappTemplateFailure,
  parseSendWhatsappTemplateArgs,
  runSendWhatsappTemplate
} from "./lib/send-whatsapp-template.ts";

test("template management defaults writes to dry-run", () => {
  const options = parseManageWhatsappTemplateArgs([
    "create",
    "--purpose",
    "wedding_invitation",
    "--version",
    "1",
    "--name",
    "wedding",
    "--language",
    "en"
  ]);
  assert.equal(options.apply, false);
  assert.equal(options.confirmProd, false);
  assert.equal(options.purpose, "wedding_invitation");
  assert.equal(options.version, 1);
});

test("template management recognizes explicit apply", () => {
  const options = parseManageWhatsappTemplateArgs([
    "activate",
    "--purpose",
    "wedding_invitation",
    "--version",
    "2",
    "--apply",
    "--confirm-prod"
  ]);
  assert.equal(options.apply, true);
  assert.equal(options.confirmProd, true);
});

test("template management refuses unconfirmed production writes", async () => {
  const { runManageWhatsappTemplates } = await import("./lib/manage-whatsapp-templates.ts");
  const repository = { createVersion: async () => assert.fail("must not write") };
  await assert.rejects(
    () =>
      runManageWhatsappTemplates(
        {
          command: "create",
          apply: true,
          confirmProd: false,
          purpose: "wedding_invitation",
          version: 1,
          name: "wedding",
          language: "en"
        },
        repository as never,
        "prod"
      ),
    /--confirm-prod/
  );
});

test("send parsing requires dev and explicit confirmation", () => {
  const args = ["--purpose", "wedding_invitation", "--recipient", "5511999999999"];
  assert.throws(() => parseSendWhatsappTemplateArgs(args, "dev"), /--confirm-send/);
  assert.throws(() => parseSendWhatsappTemplateArgs([...args, "--confirm-send"], "prod"), /dev stage/);
  assert.equal(parseSendWhatsappTemplateArgs([...args, "--confirm-send"], "dev").confirmSend, true);
});

test("send execution guard prevents calls without confirmation", async () => {
  const service = { send: async () => assert.fail("must not send") };
  await assert.rejects(
    () =>
      runSendWhatsappTemplate(
        {
          confirmSend: false,
          purpose: "wedding_invitation",
          recipient: "5511999999999",
          stage: "dev"
        },
        service as never
      ),
    /dev-stage confirmation/
  );
});

test("safe send result excludes recipient and provider WhatsApp id", async () => {
  const service = {
    send: async () => ({
      messageId: "wamid.safe",
      recipientWaId: "5511999999999",
      templatePurpose: "wedding_invitation",
      templateVersion: 1
    })
  };
  const result = await runSendWhatsappTemplate(
    {
      confirmSend: true,
      purpose: "wedding_invitation",
      recipient: "5511999999999",
      stage: "dev"
    },
    service as never
  );
  assert.deepEqual(result, {
    stage: "dev",
    templatePurpose: "wedding_invitation",
    templateVersion: 1,
    messageId: "wamid.safe",
    providerTraceId: undefined
  });
  assert.equal(JSON.stringify(result).includes("5511999999999"), false);
});

test("unknown send outcomes require reconciliation without exposing raw details", () => {
  for (const category of ["timeout", "network", "ambiguous_delivery"] as const) {
    const error = new WhatsappApiError(
      "WhatsApp delivery outcome is unknown.",
      category,
      undefined,
      false
    );
    const output = formatSendWhatsappTemplateFailure(error);
    assert.match(output, /Do not resend/);
    assert.match(output, /manually reconciled/);
    assert.equal(output.includes("5511999999999"), false);
  }

  assert.equal(
    formatSendWhatsappTemplateFailure(new Error("secret raw exception for 5511999999999")),
    "WhatsApp template send failed."
  );
});
