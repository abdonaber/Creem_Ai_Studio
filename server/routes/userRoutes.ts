import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';

export const userRouter = Router();

userRouter.use(authenticate);

// Get Profile
userRouter.get('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await db.findUserById(req.user!.userId);
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

    const { passwordHash: _, ...safeUser } = user;
    const wallet = await db.getOrCreateWallet(user.id);
    const driver = user.role === 'DRIVER' ? await db.findDriverByUserId(user.id) : null;

    res.json({
      success: true,
      data: {
        ...safeUser,
        wallet,
        driver,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Update Profile
userRouter.put('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, phone, avatarUrl } = req.body;
    const updated = await db.updateUser(req.user!.userId, {
      ...(name ? { name: String(name).trim() } : {}),
      ...(phone ? { phone: String(phone).trim() } : {}),
      ...(avatarUrl ? { avatarUrl: String(avatarUrl) } : {}),
    });

    if (!updated) throw new AppError('User not found', 404, 'NOT_FOUND');
    const { passwordHash: _, ...safeUser } = updated;

    res.json({ success: true, data: safeUser });
  } catch (err) {
    next(err);
  }
});

// Get Notifications
userRouter.get('/notifications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notifications = await db.getNotificationsForUser(req.user!.userId);
    res.json({ success: true, data: notifications });
  } catch (err) {
    next(err);
  }
});

// Mark Notification as read
userRouter.put('/notifications/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notif = await db.findNotificationById(req.params.id);
    if (notif && notif.userId === req.user!.userId) {
      await db.markNotificationRead(req.params.id);
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
