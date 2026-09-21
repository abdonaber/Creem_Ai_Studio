import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/authService';
import { authenticate } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiter';
import { db } from '../db/store';

export const authRouter = Router();

// Register
authRouter.post(
  '/register',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await AuthService.register(req.body);

      // Set refresh token in HttpOnly secure cookie
      res.cookie('creemy_refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
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
      const result = await AuthService.login(req.body);

      res.cookie('creemy_refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
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
authRouter.post('/refresh', (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken =
      req.cookies?.creemy_refresh_token || req.body?.refreshToken;

    if (!refreshToken) {
      res.status(401).json({ success: false, error: 'Refresh token required' });
      return;
    }

    const tokens = AuthService.rotateRefreshToken(refreshToken);

    res.cookie('creemy_refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
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
});

// Logout
authRouter.post('/logout', authenticate, (req: Request, res: Response) => {
  const refreshToken = req.cookies?.creemy_refresh_token || req.body?.refreshToken;
  AuthService.logout(refreshToken, req.user?.userId);

  res.clearCookie('creemy_refresh_token');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Current Authenticated User (Me)
authRouter.get('/me', authenticate, (req: Request, res: Response) => {
  const user = db.findUserById(req.user!.userId);
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  const driver = user.role === 'DRIVER' ? db.findDriverByUserId(user.id) : undefined;
  const wallet = db.getOrCreateWallet(user.id);

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
});
