import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/authService';
import { authenticate } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiter';
import { db } from '../db/store';
import { config } from '../config';

export const authRouter = Router();

// Register
authRouter.post(
  '/register',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
      };

      const result = await AuthService.register(req.body, clientInfo);

      // Set refresh token in HttpOnly secure cookie
      res.cookie('creemy_refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'lax',
        maxAge: config.cookieMaxAgeMs,
      });

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
      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
      };

      const result = await AuthService.login(req.body, clientInfo);

      res.cookie('creemy_refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'lax',
        maxAge: config.cookieMaxAgeMs,
      });

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
  rateLimit({ windowMs: 15 * 60 * 1000, max: 60 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken =
        req.cookies?.creemy_refresh_token || req.body?.refreshToken;

      if (!refreshToken) {
        res.status(401).json({ success: false, error: 'Refresh token required' });
        return;
      }

      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
      };

      const tokens = await AuthService.rotateRefreshToken(refreshToken, clientInfo);

      res.cookie('creemy_refresh_token', tokens.refreshToken, {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'lax',
        maxAge: config.cookieMaxAgeMs,
      });

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

// Logout Current Device
authRouter.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.creemy_refresh_token || req.body?.refreshToken;
    await AuthService.logout(refreshToken, req.user?.userId);

    res.clearCookie('creemy_refresh_token');
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// Logout All Devices (Revoke all active refresh sessions)
authRouter.post('/logout-all', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await AuthService.logoutAll(req.user!.userId);

    res.clearCookie('creemy_refresh_token');
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
