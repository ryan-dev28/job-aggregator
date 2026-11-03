import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OtpService {
    private readonly logger: Logger = new Logger(OtpService.name);
    private readonly otpExpiry: number;

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private readonly mailerService: MailerService,
        private readonly configService: ConfigService,
    ) {
        this.otpExpiry = this.configService.get<number>('OTP_EXPIRY_MINUTES', 5) * 60 * 1000;
    }

    async generateOtp(email: string): Promise<string> {
        try {
            const lastSent = await this.cacheManager.get<number>(`otp:lastSent:${email}`);
            if (lastSent && Date.now() - lastSent < 30000) {
                throw new BadRequestException('Please wait before requesting new OTP');
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();

            await Promise.all([
                this.cacheManager.set(`otp:${email}`, otp, 300000),
                this.cacheManager.set(`otp:lastSent:${email}`, Date.now(), 30000)
            ]);

            await this.sendOtpEmail(email, otp);
            return otp;
        } catch (err) {
            this.logger.error('Error generating OTP', err);
            throw new Error('Error generating OTP');
        }
    }

    async verifyOtp(email: string, otp: string): Promise<boolean> {
        const storedOtp = await this.cacheManager.get<string>(`otp:${email}`);
        return storedOtp === otp;
    }

    private async sendOtpEmail(email: string, otp: string) {
        try {
            await this.mailerService.sendMail({
                to: email,
                subject: 'Your Verification Code',
                template: './auth/register-otp.mail.hbs',
                context: {
                    otp,
                    expiryMinutes: this.configService.get<number>('OTP_EXPIRY_MINUTES', 5)
                },
            });
        } catch (err) {
            this.logger.error('Failed to send OTP email:', err);
            throw new Error('Failed to send OTP email');
        }
    }

    async generatePasswordResetOtp(email: string): Promise<string> {
        try {
            const lastSent = await this.cacheManager.get<number>(`passwordReset:lastSent:${email}`);
            if (lastSent && Date.now() - lastSent < 60000) {
                throw new BadRequestException('Please wait before requesting another password reset');
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();

            await Promise.all([
                this.cacheManager.set(`passwordReset:otp:${email}`, otp, 900000),
                this.cacheManager.set(`passwordReset:lastSent:${email}`, Date.now(), 60000)
            ]);

            await this.sendPasswordResetEmail(email, otp);
            return otp;
        } catch (err) {
            this.logger.error('Error generating password reset OTP', err);
            if (err instanceof BadRequestException) {
                throw err;
            }
            throw new Error('Error generating password reset OTP');
        }
    }

    async verifyPasswordResetOtp(email: string, otp: string): Promise<boolean> {
        const storedOtp = await this.cacheManager.get<string>(`passwordReset:otp:${email}`);
        return storedOtp === otp;
    }

    async clearPasswordResetOtp(email: string): Promise<void> {
        await this.cacheManager.del(`passwordReset:otp:${email}`);
    }

    private async sendPasswordResetEmail(email: string, otp: string) {
        try {
            await this.mailerService.sendMail({
                to: email,
                subject: 'Password Reset Code',
                template: './auth/password-reset.mail.hbs',
                context: {
                    otp,
                    expiryMinutes: 15
                },
            });
        } catch (err) {
            this.logger.error('Failed to send password reset email:', err);
            throw new Error('Failed to send password reset email');
        }
    }
}