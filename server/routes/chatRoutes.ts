import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { io } from '../socket/socketHandler';
import { generateId } from '../utils/id';

export const chatRouter = Router();

chatRouter.use(authenticate);

// Get messages for a ride (with IDOR check)
chatRouter.get('/:rideId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rideId } = req.params;
    const ride = await db.findRideById(rideId);
    if (!ride) throw new AppError('Ride not found', 404, 'NOT_FOUND');

    const driver = await db.findDriverByUserId(req.user!.userId);
    const isRider = ride.riderId === req.user!.userId;
    const isDriver = Boolean(driver && ride.driverId === driver.id);
    const isAdmin = req.user!.role === 'ADMIN';

    if (!isRider && !isDriver && !isAdmin) {
      throw new AppError('Unauthorized to view chat messages for this ride', 403, 'FORBIDDEN_IDOR');
    }

    const messages = await db.getMessagesForRide(rideId);
    res.json({ success: true, data: messages });
  } catch (err) {
    next(err);
  }
});

// Send message for a ride
chatRouter.post('/:rideId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rideId } = req.params;
    const { text, content } = req.body;
    const rawText = typeof text === 'string' ? text : content;

    if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
      throw new AppError('Message text is required', 400, 'INVALID_INPUT');
    }

    if (rawText.trim().length > 1000) {
      throw new AppError('Message is too long (maximum 1000 characters)', 400, 'TEXT_TOO_LONG');
    }

    const ride = await db.findRideById(rideId);
    if (!ride) throw new AppError('Ride not found', 404, 'NOT_FOUND');

    if (ride.status === 'CANCELLED' || ride.status === 'NO_DRIVER_FOUND') {
      throw new AppError('Chat is closed for cancelled or unmatched rides.', 400, 'CHAT_CLOSED');
    }

    const driver = await db.findDriverByUserId(req.user!.userId);
    const isRider = ride.riderId === req.user!.userId;
    const isDriver = Boolean(driver && ride.driverId === driver.id);
    const isAdmin = req.user!.role === 'ADMIN';

    if (!isRider && !isDriver && !isAdmin) {
      throw new AppError('Unauthorized to send messages for this ride', 403, 'FORBIDDEN_IDOR');
    }

    const user = await db.findUserById(req.user!.userId);

    let recipientId = '';
    if (isRider && ride.driverId) {
      const assignedDriver = await db.findDriverById(ride.driverId);
      recipientId = assignedDriver?.userId || '';
    } else {
      recipientId = ride.riderId;
    }

    const message = await db.createMessage({
      id: generateId('msg'),
      rideId,
      senderId: req.user!.userId,
      senderName: user?.name || 'مستخدم',
      recipientId,
      content: rawText.trim(),
      createdAt: new Date().toISOString(),
      read: false,
    });

    if (io) {
      io.to(`ride:${rideId}`).emit('chat:message_received', message);
    }

    res.status(201).json({ success: true, data: message });
  } catch (err) {
    next(err);
  }
});
