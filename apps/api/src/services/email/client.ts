import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { getEnv } from "../../lib/env";
import { captureAwsClient, withTracedSubsegment } from "../../lib/xray";

const sesClient = captureAwsClient(new SESv2Client({}));

export class EmailService {
  async sendEmail(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    configurationSetName?: string;
    replyTo?: string;
  }) {
    const env = getEnv();
    const replyTo = input.replyTo ?? env.contactEmail;
    const configurationSetName = input.configurationSetName ?? env.emailConfigurationSetName;

    const result = await withTracedSubsegment(
      "email.send_email",
      {
        channel: "ses",
        has_html: Boolean(input.html)
      },
      async () =>
        sesClient.send(
          new SendEmailCommand({
            FromEmailAddress: env.emailFrom,
            Destination: {
              ToAddresses: [input.to]
            },
            ReplyToAddresses: [replyTo],
            ...(configurationSetName ? { ConfigurationSetName: configurationSetName } : {}),
            Content: {
              Simple: {
                Subject: {
                  Data: input.subject,
                  Charset: "UTF-8"
                },
                Body: {
                  Text: {
                    Data: input.text,
                    Charset: "UTF-8"
                  },
                  ...(input.html
                    ? {
                        Html: {
                          Data: input.html,
                          Charset: "UTF-8"
                        }
                      }
                    : {})
                }
              }
            }
          })
        )
    );

    return {
      ok: true,
      messageId: result.MessageId
    };
  }
}
