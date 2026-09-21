import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitRecord>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60 * 1000);

export function rateLimit(options: { windowMs: number; max: number; message?: string }) {
  const { windowMs, max, message = 'Too many requests. Please try again later.' } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    // In test environment or health checks, skip rate limits
    if (process.env.NODE_ENV === 'test' || req.path === '/health' || req.path === '/ready') {
      return next();
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.baseUrl || ''}${req.path}`;
    const now = Date.now();

    const record = rateLimitMap.get(key);

    if (!record || now > record.resetTime) {
      rateLimitMap.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      return next();
    }

    if (record.count >= max) {
      return next(new AppError(message, 429, 'RATE_LIMIT_EXCEEDED'));
    }

    record.count += 1;
    next();
  };
}
