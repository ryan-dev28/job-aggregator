
export class ForgotPasswordDto {
    email: string;
}

export class ResetPasswordDto {
    email: string;
    otp: string;
    newPassword: string;
}
