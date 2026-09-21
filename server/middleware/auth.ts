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

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.creemy_access_token) {
      token = req.cookies.creemy_access_token;
    }

    if (!token) {
      throw new AppError('Authentication required. Missing token.', 401, 'UNAUTHORIZED');
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
  return (req: Request, res: Response, next: NextFunction): void => {
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
