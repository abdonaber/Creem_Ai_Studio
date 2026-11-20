import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db/store';
import { AppError } from './errorHandler';
import { UserRole } from '../types';

export interface AuthPayload {
  userId: string;
  email: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

    if (!token) {
      throw new AppError('Authentication required. Missing Bearer token.', 401, 'UNAUTHORIZED');
    }

    const decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;

    // Verify user exists and is active in DB
    const user = await db.findUserById(decoded.userId);
    if (!user) {
      throw new AppError('User not found or account deleted.', 401, 'USER_NOT_FOUND');
    }

    if (user.status === 'SUSPENDED') {
      throw new AppError('Account is suspended. Please contact customer support.', 403, 'ACCOUNT_SUSPENDED');
    }

    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else if ((error as Error).name === 'TokenExpiredError') {
      next(new AppError('Token expired. Please refresh your session.', 401, 'TOKEN_EXPIRED'));
    } else {
      next(new AppError('Invalid or corrupted authorization token.', 401, 'INVALID_TOKEN'));
    }
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401, 'UNAUTHORIZED'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          `Forbidden. Requires one of [${allowedRoles.join(', ')}] role.`,
          403,
          'FORBIDDEN'
        )
      );
    }

    next();
  };
}

/**
 * CSRF protection for cookie-backed auth state-changing routes (/refresh, /logout, /logout-all).
 * Validates Origin/Referer against allowed origins and blocks cross-site form/cookie submissions.
 */
export function verifyCsrfOrigin(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  const isAllowedOrigin = (candidate: string): boolean => {
    try {
      const parsed = new URL(candidate);
      const originOnly = `${parsed.protocol}//${parsed.host}`;
      if (config.allowedOrigins.includes(originOnly)) {
        return true;
      }
      if (!config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(originOnly)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  if (origin && !isAllowedOrigin(origin)) {
    return next(new AppError('CSRF validation failed: untrusted request origin.', 403, 'CSRF_ORIGIN_MISMATCH'));
  }

  if (!origin && referer && !isAllowedOrigin(referer)) {
    return next(new AppError('CSRF validation failed: untrusted request referer.', 403, 'CSRF_REFERER_MISMATCH'));
  }

  // In strict production, if cookie auth is used with no Origin/Referer and no custom header, block
  const usesCookie = Boolean(req.cookies?.creem_refresh_token || req.cookies?.creemy_refresh_token);
  const hasCustomHeader = Boolean(req.headers['x-requested-with'] || req.headers.authorization);
  if (config.isProduction && usesCookie && !origin && !referer && !hasCustomHeader) {
    return next(new AppError('CSRF validation failed: missing origin or custom request header.', 403, 'CSRF_HEADER_REQUIRED'));
  }

  next();
}

export function createAuthToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '15m' });
}
