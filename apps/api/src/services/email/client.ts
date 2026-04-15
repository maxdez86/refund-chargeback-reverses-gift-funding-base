export class EmailService {
  async sendVendorMessage(to: string, subject: string) {
    return {
      ok: true,
      to,
      subject
    };
  }
}
