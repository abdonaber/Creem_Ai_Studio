import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      id?: string;
      startTime?: number;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const reqId = (req.headers['x-request-id'] as string) || `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  req.id = reqId;
  req.startTime = Date.now();

  res.setHeader('X-Request-Id', reqId);

  res.on('finish', () => {
    const durationMs = req.startTime ? Date.now() - req.startTime : 0;
    const statusCode = res.statusCode;

    // Log request metrics
    if (statusCode >= 500) {
      logger.error(`[HTTP] ${req.method} ${req.originalUrl} ${statusCode} - ${durationMs}ms`, undefined, {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl,
        statusCode,
        durationMs,
        ip: req.ip,
      });
    } else if (statusCode >= 400) {
      logger.warn(`[HTTP] ${req.method} ${req.originalUrl} ${statusCode} - ${durationMs}ms`, {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl,
        statusCode,
        durationMs,
      });
    } else if (!req.originalUrl.startsWith('/@') && !req.originalUrl.startsWith('/node_modules') && !req.originalUrl.startsWith('/src')) {
      logger.info(`[HTTP] ${req.method} ${req.originalUrl} ${statusCode} - ${durationMs}ms`, {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl,
        statusCode,
        durationMs,
      });
    }
  });

  next();
}
