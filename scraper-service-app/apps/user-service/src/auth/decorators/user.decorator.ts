import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserPayload } from 'libs/common/src/interfaces/auth/auth.interfaces';

export const GetUser = createParamDecorator(
    (data: keyof UserPayload | undefined, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user as UserPayload;

        return data ? user[data] : user;
    },
);