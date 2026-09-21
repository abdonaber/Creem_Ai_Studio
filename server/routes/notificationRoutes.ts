import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';

export const notificationRouter = Router();

notificationRouter.use(authenticate);

// Get Notifications for Current User
notificationRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notifications = await db.getNotificationsForUser(req.user!.userId);
    res.json({ success: true, data: notifications });
  } catch (err) {
    next(err);
  }
});

// Mark single notification as read
notificationRouter.put('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notif = await db.findNotificationById(req.params.id);
    if (!notif) throw new AppError('Notification not found', 404, 'NOT_FOUND');

    if (notif.userId !== req.user!.userId) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    const updated = await db.updateNotification(req.params.id, { read: true });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// Mark all as read
notificationRouter.put('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db.markAllNotificationsRead(req.user!.userId);
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
});
