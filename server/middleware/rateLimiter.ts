import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { checkRateLimit } from '../redis/redisClient';

export function rateLimit(options: { windowMs: number; max: number; message?: string }) {
  const { windowMs, max, message = 'Too many requests. Please try again later.' } = options;
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // In test environment or health checks, skip rate limits
    if (process.env.NODE_ENV === 'test' || req.path === '/health' || req.path === '/ready') {
      return next();
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.baseUrl || ''}${req.path}`;

    try {
      const result = await checkRateLimit(key, max, windowSeconds);

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

      if (!result.allowed) {
        return next(new AppError(message, 429, 'RATE_LIMIT_EXCEEDED'));
      }

      next();
    } catch {
      next();
    }
  };
}
