import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { getEnv } from "../../lib/env";

const sesClient = new SESv2Client({});

export class EmailService {
  async sendEmail(input: {
    to: string;
    subject: string;
    text: string;
  }) {
    const result = await sesClient.send(
      new SendEmailCommand({
        FromEmailAddress: getEnv().emailFrom,
        Destination: {
          ToAddresses: [input.to]
        },
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
              }
            }
          }
        }
      })
    );

    return {
      ok: true,
      messageId: result.MessageId
    };
  }
}
