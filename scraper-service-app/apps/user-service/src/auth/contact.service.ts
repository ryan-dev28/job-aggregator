import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) { }

  async sendContactEmail(
    name: string,
    email: string,
    subject: string,
    message: string,
  ): Promise<void> {
    this.logger.log(`Sending contact email from ${email}`);

    try {
      const adminEmail = this.configService.get<string>('ADMIN_MAIL', 'joe.sitarz@buyersigs.com');

      await this.mailerService.sendMail({
        to: adminEmail,
        subject: `Contact Form: ${subject}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">New Contact Form Submission</h2>
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 10px 0;"><strong>From:</strong> ${name}</p>
              <p style="margin: 10px 0;"><strong>Email:</strong> ${email}</p>
              <p style="margin: 10px 0;"><strong>Subject:</strong> ${subject}</p>
            </div>
            <div style="background-color: #fff; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
              <h3 style="color: #555; margin-top: 0;">Message:</h3>
              <p style="color: #333; line-height: 1.6; white-space: pre-wrap;">${message}</p>
            </div>
            <div style="margin-top: 20px; padding: 15px; background-color: #e8f4f8; border-radius: 8px;">
              <p style="margin: 0; font-size: 14px; color: #666;">
                To reply, send an email to: <a href="mailto:${email}" style="color: #0066cc;">${email}</a>
              </p>
            </div>
          </div>
        `,
      });

      this.logger.log(`Contact email sent successfully from ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send contact email from ${email}:`, error);
      this.logger.error('Error details:', {
        message: error.message,
        stack: error.stack,
      });
      throw new Error('Failed to send contact email');
    }
  }
}
