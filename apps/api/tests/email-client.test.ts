import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-sesv2", () => {
  class SESv2Client {
    send = sendMock;
  }

  class SendEmailCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  return {
    SESv2Client,
    SendEmailCommand
  };
});

describe("EmailService", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ MessageId: "msg-1" });
    process.env.CONTACT_EMAIL = "casamento@brimax.life";
    process.env.EMAIL_FROM = "Casamento Brimax <casamento@brimax.life>";
    process.env.WEDDING_TABLE_NAME = "test-wedding-table";
  });

  it("maps text, html, and default reply-to into the SESv2 request", async () => {
    const { EmailService } = await import("../src/services/email/client");

    const result = await new EmailService().sendEmail({
      to: "convidado@example.com",
      subject: "Assunto",
      text: "Versão texto",
      html: "<p>Versão HTML</p>"
    });

    expect(result).toEqual({ ok: true, messageId: "msg-1" });
    expect(sendMock).toHaveBeenCalledTimes(1);

    const command = sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      FromEmailAddress: "Casamento Brimax <casamento@brimax.life>",
      Destination: {
        ToAddresses: ["convidado@example.com"]
      },
      ReplyToAddresses: ["casamento@brimax.life"],
      Content: {
        Simple: {
          Subject: {
            Data: "Assunto",
            Charset: "UTF-8"
          },
          Body: {
            Text: {
              Data: "Versão texto",
              Charset: "UTF-8"
            },
            Html: {
              Data: "<p>Versão HTML</p>",
              Charset: "UTF-8"
            }
          }
        }
      }
    });
  });

  it("allows overriding the reply-to address", async () => {
    const { EmailService } = await import("../src/services/email/client");

    await new EmailService().sendEmail({
      to: "convidado@example.com",
      subject: "Assunto",
      text: "Versão texto",
      replyTo: "respostas@example.com"
    });

    const command = sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      ReplyToAddresses: ["respostas@example.com"]
    });
  });
});
