export class InitiateRegistrationDto {
    email: string;
    firstName?: string;
    lastName?: string;
    password: string
}

export class VerifyAccountDto {
    email: string;
    otp: string;
}

export class CompleteRegistrationDto {
    email: string;
    otp: string;
    firstName?: string;
    lastName?: string;
    password: string
}

export class ResendOtpDto {
    email: string;
}

export class SignInDto {
    email: string;
    password: string;
}