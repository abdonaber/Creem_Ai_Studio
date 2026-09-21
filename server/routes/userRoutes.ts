import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';

export const userRouter = Router();

userRouter.use(authenticate);

// Get Profile
userRouter.get('/profile', (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = db.findUserById(req.user!.userId);
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

    const { passwordHash: _, ...safeUser } = user;
    const wallet = db.getOrCreateWallet(user.id);
    const driver = user.role === 'DRIVER' ? db.findDriverByUserId(user.id) : null;

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
userRouter.put('/profile', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, phone, avatarUrl } = req.body;
    const updated = db.updateUser(req.user!.userId, {
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
userRouter.get('/notifications', (req: Request, res: Response) => {
  const notifications = db.getUserNotifications(req.user!.userId);
  res.json({ success: true, data: notifications });
});

// Mark Notification as read
userRouter.put('/notifications/:id/read', (req: Request, res: Response) => {
  const success = db.markNotificationAsRead(req.params.id, req.user!.userId);
  res.json({ success });
});
