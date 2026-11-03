import { Controller, Post, Body, Req, Get, Res, HttpStatus, Logger, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { ContactService } from './contact.service';
import { GetUser } from './decorators/user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { InitiateRegistrationDto, SignInDto, ResendOtpDto, VerifyAccountDto } from 'libs/common/src/interfaces/auth/auth.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/forgot-password.dto';
import { ContactEmailDto } from './dto/contact-email.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
    private readonly logger: Logger = new Logger(AuthController.name);
    constructor(
        private readonly authService: AuthService,
        private readonly otpService: OtpService,
        private readonly contactService: ContactService,
    ) { }

    @Post('register')
    @ApiOperation({ summary: 'Initiate user registration with OTP' })
    @ApiResponse({ status: 201, description: 'OTP sent successfully' })
    async initiateRegistration(
        @Body() initiateDto: InitiateRegistrationDto,
        @Res() res: Response,
    ) {
        try {
            this.logger.log("Initiating registration for email: " + initiateDto.email);
            const { id } = await this.authService.register(initiateDto);
            return res.status(HttpStatus.CREATED).json({
                message: 'Registration initiated. OTP sent to your email.',
                userId: id,
            });
        } catch (err) {
            this.logger.error('Error in registration controller:', err);

            if (err.status >= 400 && err.status < 500) {
                return res.status(err.status).json({
                    message: err.message,
                    error: 'Bad Request'
                });
            }

            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                message: 'Internal server error during registration',
                error: 'Internal Server Error'
            });
        }
    }

    @Post('verify')
    @ApiOperation({ summary: 'Verify OTP for registration' })
    @ApiResponse({ status: 201, description: 'OTP verified successfully' })
    async verifyOtp(@Body() data: VerifyAccountDto) {
        const tokens = await this.authService.verifyAccount(data.email, data.otp);
        return {
            message: 'Account verified',
            ...tokens,
        }
    }

    @Post('resend-otp')
    @ApiOperation({ summary: 'Resend OTP for registration' })
    @ApiResponse({ status: 201, description: 'OTP resent successfully' })
    async resendOtp(
        @Body() resendDto: ResendOtpDto,
        @Res() res: Response,
    ) {
        try {
            await this.authService.resendOtp(resendDto.email);
            return res.status(HttpStatus.OK).json({
                message: 'OTP resent to your email',
            });
        } catch (error) {
            return res.status(HttpStatus.BAD_REQUEST).json({
                message: error.message || 'Failed to resend OTP',
            });
        }
    }

    @Post('signin')
    @ApiOperation({ summary: 'Sign in user' })
    @ApiResponse({ status: 201, description: 'User signed in successfully' })
    async signIn(
        @Body() data: SignInDto
    ) {
        const tokens = await this.authService.signIn(data.email, data.password);
        return {
            message: 'User signed in successfully',
            ...tokens,
        }
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    async fetchDecodedUserData(
        @GetUser() user: { sub: string, email: string },
        @GetUser('email') email: string
    ) {
        return {
            user,
            email
        }
    }

    @Post('forgot-password')
    @ApiOperation({ summary: 'Request password reset' })
    @ApiResponse({ status: 200, description: 'Password reset OTP sent successfully' })
    async forgotPassword(
        @Body() forgotPasswordDto: ForgotPasswordDto,
        @Res() res: Response,
    ) {
        try {
            await this.authService.forgotPassword(forgotPasswordDto.email);
            return res.status(HttpStatus.OK).json({
                message: 'Password reset code sent to your email',
            });
        } catch (error) {
            this.logger.error('Error in forgot password controller:', error);

            if (error.status >= 400 && error.status < 500) {
                return res.status(error.status).json({
                    message: error.message,
                    error: 'Bad Request'
                });
            }

            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                message: 'Internal server error during password reset request',
                error: 'Internal Server Error'
            });
        }
    }

    @Post('reset-password')
    @ApiOperation({ summary: 'Reset password with OTP' })
    @ApiResponse({ status: 200, description: 'Password reset successfully' })
    async resetPassword(
        @Body() resetPasswordDto: ResetPasswordDto,
        @Res() res: Response,
    ) {
        try {
            await this.authService.resetPassword(
                resetPasswordDto.email,
                resetPasswordDto.otp,
                resetPasswordDto.newPassword
            );

            return res.status(HttpStatus.OK).json({
                message: 'Password reset successfully',
            });
        } catch (error) {
            this.logger.error('Error in reset password controller:', error);

            if (error.status >= 400 && error.status < 500) {
                return res.status(error.status).json({
                    message: error.message,
                    error: 'Bad Request'
                });
            }

            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                message: 'Internal server error during password reset',
                error: 'Internal Server Error'
            });
        }
    }

    @Post('contact')
    @ApiOperation({ summary: 'Send contact form email' })
    @ApiResponse({ status: 200, description: 'Contact email sent successfully' })
    async sendContactEmail(
        @Body() contactDto: ContactEmailDto,
        @Res() res: Response,
        @Req() req: Request,
    ) {
        try {
            this.logger.log(`Contact form submission from ${contactDto.email}`);

            const sanitizedData = {
                name: contactDto.name.trim(),
                email: contactDto.email.trim().toLowerCase(),
                subject: contactDto.subject.trim(),
                message: contactDto.message.trim(),
            };

            await this.contactService.sendContactEmail(
                sanitizedData.name,
                sanitizedData.email,
                sanitizedData.subject,
                sanitizedData.message,
            );

            return res.status(HttpStatus.OK).json({
                message: 'Thank you for contacting us. We will get back to you soon.',
            });
        } catch (error) {
            this.logger.error('Error in contact form controller:', error);

            if (error.status >= 400 && error.status < 500) {
                return res.status(error.status).json({
                    message: error.message,
                    error: 'Bad Request'
                });
            }

            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                message: 'Failed to send message. Please try again later.',
                error: 'Internal Server Error'
            });
        }
    }
}