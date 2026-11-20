import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/authService';
import { authenticate, verifyCsrfOrigin } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiter';
import { AppError } from '../middleware/errorHandler';
import { db } from '../db/store';
import { config } from '../config';

export const authRouter = Router();

const REFRESH_COOKIE_NAME = 'creem_refresh_token';
const LEGACY_REFRESH_COOKIE_NAME = 'creemy_refresh_token';

function getRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: config.cookieMaxAgeMs,
  };
}

function clearRefreshCookies(res: Response): void {
  const clearOpts = {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };
  res.clearCookie(REFRESH_COOKIE_NAME, clearOpts);
  res.clearCookie(LEGACY_REFRESH_COOKIE_NAME, clearOpts);
}

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7).max(20),
  password: z.string().min(8).max(128),
  role: z.enum(['RIDER', 'DRIVER', 'ADMIN']).optional(),
  licenseNumber: z.string().trim().max(50).optional(),
  vehicleDetails: z
    .object({
      make: z.string().trim().min(1).max(60),
      model: z.string().trim().min(1).max(60),
      year: z.coerce.number().int().min(1995).max(new Date().getFullYear() + 1),
      color: z.string().trim().min(1).max(40),
      plateNumber: z.string().trim().min(2).max(30),
      category: z.enum(['STANDARD', 'COMFORT', 'VIP', 'ECO']).optional(),
    })
    .optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

// Register
authRouter.post(
  '/register',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new AppError(parsed.error.issues[0]?.message || 'Invalid registration data.', 400, 'VALIDATION_ERROR'));
      }

      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
      };

      const result = await AuthService.register(parsed.data, clientInfo);
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getRefreshCookieOptions());

      res.status(201).json({
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// Login
authRouter.post(
  '/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new AppError('Valid email and password are required.', 400, 'VALIDATION_ERROR'));
      }

      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
      };

      const result = await AuthService.login(parsed.data, clientInfo);
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getRefreshCookieOptions());

      res.json({
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// Refresh Token Rotation
authRouter.post(
  '/refresh',
  verifyCsrfOrigin,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 60 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken =
        req.cookies?.[REFRESH_COOKIE_NAME] ||
        req.cookies?.[LEGACY_REFRESH_COOKIE_NAME] ||
        req.body?.refreshToken;

      if (!refreshToken) {
        res.status(401).json({ success: false, error: 'Refresh token required' });
        return;
      }

      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
      };

      const tokens = await AuthService.rotateRefreshToken(refreshToken, clientInfo);
      res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, getRefreshCookieOptions());

      res.json({
        success: true,
        data: {
          accessToken: tokens.accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// Change Password (revokes all refresh sessions across devices)
authRouter.put(
  '/password',
  authenticate,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 15 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(new AppError(parsed.error.issues[0]?.message || 'Invalid password payload.', 400, 'VALIDATION_ERROR'));
      }

      await AuthService.changePassword(
        req.user!.userId,
        parsed.data.currentPassword,
        parsed.data.newPassword,
        {
          ip: req.ip || req.socket.remoteAddress,
          userAgent: req.get('user-agent'),
        }
      );

      clearRefreshCookies(res);
      res.json({
        success: true,
        message: 'Password updated and all active sessions revoked.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// Logout Current Device
authRouter.post('/logout', verifyCsrfOrigin, authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken =
      req.cookies?.[REFRESH_COOKIE_NAME] ||
      req.cookies?.[LEGACY_REFRESH_COOKIE_NAME] ||
      req.body?.refreshToken;
    await AuthService.logout(refreshToken, req.user?.userId);

    clearRefreshCookies(res);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// Logout All Devices (Revoke all active refresh sessions)
authRouter.post('/logout-all', verifyCsrfOrigin, authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await AuthService.logoutAll(req.user!.userId);

    clearRefreshCookies(res);
    res.json({ success: true, message: 'All active sessions have been terminated.' });
  } catch (err) {
    next(err);
  }
});

// Current Authenticated User (Me)
authRouter.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await db.findUserById(req.user!.userId);
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const driver = user.role === 'DRIVER' ? await db.findDriverByUserId(user.id) : undefined;
    if (driver) {
      const vehicle = await db.findVehicleByDriverId(driver.id);
      if (vehicle) driver.vehicle = vehicle;
    }
    const wallet = await db.getOrCreateWallet(user.id);

    const { passwordHash: _, ...safeUser } = user;

    res.json({
      success: true,
      data: {
        user: safeUser,
        driver,
        walletBalance: wallet.balance,
        currency: wallet.currency,
      },
    });
  } catch (err) {
    next(err);
  }
});
