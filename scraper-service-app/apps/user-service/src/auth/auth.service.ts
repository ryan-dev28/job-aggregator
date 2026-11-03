import { Injectable, Logger, UnauthorizedException, BadRequestException, InternalServerErrorException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from 'bcrypt';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { HttpService } from "@nestjs/axios";

import { UserPayload, AuthTokens } from "libs/common/src/interfaces/auth/auth.interfaces";
import { InitiateRegistrationDto } from "libs/common/src/interfaces/auth/auth.dto";
import { OtpService } from "./otp.service";

@Injectable()
export class AuthService {
    private readonly logger: Logger = new Logger(AuthService.name);
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly httpService: HttpService,
        private readonly otpService: OtpService,
    ) { }

    private get storageHost() {
        return this.configService.get<string>('STORAGE_SERVICE_HOST');
    }

    async register(data: InitiateRegistrationDto): Promise<any> {
        try {
            const otp = await this.otpService.generateOtp(data.email);
            const hashedPassword = await bcrypt.hash(data.password, 10);

            const res = await firstValueFrom(this.httpService.post(`${this.storageHost}/user/create`, {
                email: data.email,
                password: hashedPassword,
                firstName: data.firstName,
                lastName: data.lastName,
                verificationCode: otp,
                verificationExpiry: new Date(Date.now() + 10 * 60 * 1000),
            }),)

            const user = res.data?.data || res.data;

            if (!user) {
                throw new Error('Failed to create user');
            }

            return user;
        } catch (err) {
            this.logger.error('Error registering user:', err);

            if (err.response?.status === 400) {
                throw new BadRequestException(err.response.data.message || 'Invalid registration data provided');
            }

            if (err.response?.status >= 500) {
                throw new InternalServerErrorException('Registration service unavailable');
            }

            throw new InternalServerErrorException('Failed to register user', err);
        }
    }

    async verifyAccount(email: string, otp: string): Promise<AuthTokens> {
        try {
            const res = await firstValueFrom(
                this.httpService.post(`${this.storageHost}/user/verify-otp`, {
                    email,
                    otp,
                }),
            );
            const user = res.data;

            if (!user) {
                throw new BadRequestException('Invalid OTP or user not found');
            }

            return this.generateToken({ email: user.email, sub: user.id });
        } catch (err) {
            this.logger.error('Error verifying account:', err);

            if (err.response?.status === 400) {
                throw new BadRequestException(err.response.data.message || 'Invalid OTP or user not found');
            }

            if (err.response?.status === 404) {
                throw new BadRequestException('User not found');
            }

            if (err.response?.status >= 500) {
                throw new InternalServerErrorException('Verification service unavailable');
            }

            throw new InternalServerErrorException('Failed to verify account');
        }
    }

    async resendOtp(email: string): Promise<void> {
        try {
            const { data: user } = await firstValueFrom(
                this.httpService.post(`${this.storageHost}/user`, { email }),
            );

            if (!user) {
                throw new BadRequestException('User not found');
            }

            if (user.isVerified) {
                throw new BadRequestException('User is already verified');
            }

            const otp = await this.otpService.generateOtp(email);
            await firstValueFrom(
                this.httpService.post(`${this.storageHost}/user/update-otp`, {
                    id: user.id,
                    otp,
                    expiry: new Date(Date.now() + 10 * 60 * 1000),
                }),
            );
        } catch (err) {
            this.logger.error('Error resending OTP:', err);

            if (err instanceof BadRequestException) {
                throw err;
            }

            if (err.response?.status === 400) {
                throw new BadRequestException(err.response.data.message || 'Invalid request');
            }

            if (err.response?.status === 404) {
                throw new BadRequestException('User not found');
            }

            if (err.response?.status >= 500) {
                throw new InternalServerErrorException('OTP service unavailable');
            }

            throw new InternalServerErrorException('Failed to resend OTP');
        }
    }

    async signIn(email: string, password: string): Promise<AuthTokens> {
        try {
            const res = await firstValueFrom(
                this.httpService.post(`${this.storageHost}/user`, { email }),
            );

            const user = res.data

            if (!user) {
                throw new UnauthorizedException('Invalid credentials');
            }

            if (!user.isVerified) {
                throw new UnauthorizedException('Account not verified');
            }

            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                throw new UnauthorizedException('Invalid credentials');
            }

            return this.generateToken({ email: user.email, sub: user.id });
        } catch (err) {
            this.logger.error('Error signing in:', err);

            if (err instanceof UnauthorizedException) {
                throw err;
            }

            if (err.response?.status === 400) {
                throw new BadRequestException(err.response.data.message || 'Invalid request');
            }

            if (err.response?.status === 404) {
                throw new UnauthorizedException('Invalid credentials');
            }

            if (err.response?.status >= 500) {
                throw new InternalServerErrorException('Authentication service unavailable');
            }

            throw new InternalServerErrorException('Failed to sign in');
        }
    }

    async generateToken(payload: UserPayload): Promise<AuthTokens> {
        return {
            accessToken: this.jwtService.sign(payload, {
                expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRATION_TIME', '15m'),
            }),
            refreshToken: this.jwtService.sign(payload, {
                expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION_TIME', '7d'),
            })
        }
    }

    async decodeToken(token: string): Promise<UserPayload> {
        try {
            const payload = await this.jwtService.verifyAsync(token);
            return payload;
        } catch (err) {
            this.logger.error("Failed to decode token", err);
            throw new UnauthorizedException('Invalid or expired token');
        }
    }

    async validateUser(email: string): Promise<any> {
        try {
            const { data: user } = await firstValueFrom(
                this.httpService.post(`${this.storageHost}/user`, { email }),
            );
            return user;
        } catch (err) {
            this.logger.error('Error validating user:', err);

            if (err.response?.status === 400) {
                throw new BadRequestException(err.response.data.message || 'Invalid request');
            }

            if (err.response?.status === 404) {
                return null;
            }

            if (err.response?.status >= 500) {
                throw new InternalServerErrorException('User service unavailable');
            }

            throw new InternalServerErrorException('Failed to validate user');
        }
    }

    async forgotPassword(email: string): Promise<void> {
        try {
            const user = await this.validateUser(email);

            if (!user) {
                throw new BadRequestException('User not found');
            }

            if (!user.isVerified) {
                throw new BadRequestException('Account not verified. Please verify your account first.');
            }

            const otp = await this.otpService.generatePasswordResetOtp(email);

            this.logger.log(`Password reset OTP generated for user: ${email}`);
        } catch (err) {
            this.logger.error('Error in forgot password:', err);

            if (err instanceof BadRequestException) {
                throw err;
            }

            if (err.response?.status === 400) {
                throw new BadRequestException(err.response.data.message || 'Invalid request');
            }

            if (err.response?.status === 404) {
                throw new BadRequestException('User not found');
            }

            if (err.response?.status >= 500) {
                throw new InternalServerErrorException('Password reset service unavailable');
            }

            throw new InternalServerErrorException('Failed to process password reset request');
        }
    }

    async resetPassword(email: string, otp: string, newPassword: string): Promise<void> {
        try {
            const isValidOtp = await this.otpService.verifyPasswordResetOtp(email, otp);

            if (!isValidOtp) {
                throw new BadRequestException('Invalid or expired OTP');
            }

            const user = await this.validateUser(email);

            if (!user) {
                throw new BadRequestException('User not found');
            }

            if (!user.isVerified) {
                throw new BadRequestException('Account not verified');
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);

            await firstValueFrom(
                this.httpService.put(`${this.storageHost}/user/reset-password`, {
                    email,
                    password: hashedPassword,
                }),
            );

            await this.otpService.clearPasswordResetOtp(email);

            this.logger.log(`Password successfully reset for user: ${email}`);
        } catch (err) {
            this.logger.error('Error resetting password:', err);

            if (err instanceof BadRequestException) {
                throw err;
            }

            if (err.response?.status === 400) {
                throw new BadRequestException(err.response.data.message || 'Invalid request');
            }

            if (err.response?.status === 404) {
                throw new BadRequestException('User not found');
            }

            if (err.response?.status >= 500) {
                throw new InternalServerErrorException('Password reset service unavailable');
            }

            throw new InternalServerErrorException('Failed to reset password');
        }
    }
}