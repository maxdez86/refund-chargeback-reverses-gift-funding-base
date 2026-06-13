import type { SQSEvent } from "aws-lambda";
import type { GuestMessage } from "@brimax/contracts";
import { getEnv } from "../../lib/env";
import { wrapLambdaHandler } from "../../lib/sentry";
import { withTracedSubsegment } from "../../lib/xray";
import { EmailService } from "../../services/email/client";
import {
  buildGuestMessageNotificationHtml,
  buildGuestMessageNotificationText
} from "../../services/email/guest-message-notification";

const emailService = new EmailService();

async function onGuestMessageNotify(event: SQSEvent) {
  for (const record of event.Records) {
    const message = JSON.parse(record.body) as GuestMessage;

    // Let a send failure throw: SQS redrives the record (up to maxReceiveCount)
    // and parks it on the DLQ if SES keeps rejecting, so the notification is
    // durable rather than silently dropped.
    await withTracedSubsegment(
      "guest_message.send_notification",
      {
        flow: "guest_message",
        entity_id: message.messageId
      },
      async () =>
        emailService.sendEmail({
          to: getEnv().contactEmail,
          subject: "Novo recado recebido no site",
          text: buildGuestMessageNotificationText(message),
          html: buildGuestMessageNotificationHtml(message)
        })
    );

    console.info(
      JSON.stringify({
        metric: "GUEST_MESSAGE_NOTIFY_SENT",
        messageId: message.messageId
      })
    );
  }
}

export const handler = wrapLambdaHandler(onGuestMessageNotify);
