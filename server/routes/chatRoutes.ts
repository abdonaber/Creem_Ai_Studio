import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';

export const chatRouter = Router();

chatRouter.use(authenticate);

// Get messages for a ride (with IDOR check)
chatRouter.get('/:rideId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rideId } = req.params;
    const ride = db.findRideById(rideId);
    if (!ride) throw new AppError('Ride not found', 404, 'NOT_FOUND');

    const driver = db.findDriverByUserId(req.user!.userId);
    const isRider = ride.riderId === req.user!.userId;
    const isDriver = driver && ride.driverId === driver.id;
    const isAdmin = req.user!.role === 'ADMIN';

    if (!isRider && !isDriver && !isAdmin) {
      throw new AppError('Unauthorized to view chat messages for this ride', 403, 'FORBIDDEN_IDOR');
    }

    const messages = db.getRideMessages(rideId);
    res.json({ success: true, data: messages });
  } catch (err) {
    next(err);
  }
});
