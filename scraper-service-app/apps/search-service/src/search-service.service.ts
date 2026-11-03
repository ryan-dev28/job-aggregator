import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

import { Job } from 'libs/common/src/interfaces/job.interface';
@Injectable()
export class SearchServiceService {
  private readonly logger: Logger = new Logger(SearchServiceService.name);

  constructor(
    private readonly mailerService: MailerService,
  ) { }

  getHello(): string {
    return 'Hello World!';
  }

  public async processAlert(data: { userEmail: string, jobs: Job[] }[]) {
    try {
      const BATCH_SIZE = 10;
      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);

        await Promise.allSettled(
          batch.map(async ({ userEmail, jobs }) => {
            this.logger.log(`Jobs`, jobs)

            if (!jobs?.length) {
              this.logger.debug(`No jobs found for user ${userEmail}`);
              return;
            }

            try {
              await this.sendAlert(userEmail, jobs);
              this.logger.log(`Alert sent to user ${userEmail}`);
            } catch (err) {
              this.logger.error(`Error processing alert for user ${userEmail}`, err);
            }
          })
        )
      }
    } catch (err) {
      this.logger.error('Error processing alert', err);
      throw new Error('Error processing alert');
    }
  }

  private async sendAlert(email: string, jobs: Job[]) {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Job Alert Notification',
        template: './jobs/job-alert.mail.hbs',
        context: {
          matches: jobs,
        },
      });
    } catch (err) {
      this.logger.error('Failed to send search alert:', err);
      throw new Error('Failed to send search alert');
    }
  }
}
