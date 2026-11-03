import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

@Injectable()
export class OtpSecurityMiddleware implements NestMiddleware {
    constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) { }

    async use(req: Request, res: Response, next: NextFunction) {
        const ip = req.ip;
        const attemptsKey = `otp:attempts:${ip}`;

        const attempts = (await this.cacheManager.get<number>(attemptsKey)) || 0;
        if (attempts > 5) {
            return res.status(429).json({
                message: 'Too many attempts. Please try again later.',
            });
        }

        await this.cacheManager.set(attemptsKey, attempts + 1, 3600000);
        next();
    }
}