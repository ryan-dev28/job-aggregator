export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
}

export interface UserPayload {
    email: string;
    sub: string;
}