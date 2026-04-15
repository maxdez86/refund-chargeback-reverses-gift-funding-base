export class WhatsappService {
  async sendConfirmation(phoneNumber: string, message: string) {
    return {
      ok: true,
      phoneNumber,
      message
    };
  }
}
