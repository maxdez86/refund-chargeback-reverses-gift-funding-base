import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, SQSEvent } from "aws-lambda";
import type { GuestMessage } from "@brimax/contracts";

process.env.WEDDING_TABLE_NAME = "test-wedding-table";
process.env.CONTACT_EMAIL = "casamento@brimax.life";

const sendEmailMock = vi.fn();

// Mock the SES client adapter so importing the handler never constructs a real
// SESv2Client at module load.
vi.mock("../src/services/email/client", () => ({
  EmailService: class {
    sendEmail = sendEmailMock;
  }
}));

let handler: typeof import("../src/functions/guest-message-notify/handler").handler;

const context = {} as Context;
const callback = () => undefined;

const message: GuestMessage = {
  messageId: "msg-1",
  authorName: "Ana Clara",
  message: "Sejam muito felizes!",
  createdAt: "2026-05-29T18:00:00.000Z"
};

function eventWith(...bodies: string[]): SQSEvent {
  return { Records: bodies.map((body) => ({ body })) } as unknown as SQSEvent;
}

describe("guest-message-notify handler", () => {
  beforeAll(async () => {
    ({ handler } = await import("../src/functions/guest-message-notify/handler"));
  });

  beforeEach(() => {
    sendEmailMock.mockReset().mockResolvedValue({ ok: true, messageId: "ses-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the notification email rendered from the queued message", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await handler(eventWith(JSON.stringify(message)), context, callback);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "casamento@brimax.life",
        subject: "Novo recado recebido no site",
        text: expect.stringContaining("Nome: Ana Clara"),
        html: expect.stringContaining("Recado:")
      })
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("\"metric\":\"GUEST_MESSAGE_NOTIFY_SENT\"")
    );
  });

  it("processes every record in the batch", async () => {
    await handler(
      eventWith(
        JSON.stringify(message),
        JSON.stringify({ ...message, messageId: "msg-2" })
      ),
      context,
      callback
    );

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  it("propagates a send failure so SQS can redrive the record", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("ses rejected"));

    await expect(
      handler(eventWith(JSON.stringify(message)), context, callback)
    ).rejects.toThrow("ses rejected");
  });
});
