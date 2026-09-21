import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { FareService } from '../services/fareService';
import { DispatchService } from '../services/dispatchService';
import { IRide, RideStatus, VehicleCategory } from '../types';
import { io } from '../socket/socketHandler';

export const rideRouter = Router();

rideRouter.use(authenticate);

// Estimate Fare
rideRouter.post('/estimate', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pickup, destination } = req.body;
    if (!pickup?.lat || !pickup?.lng || !destination?.lat || !destination?.lng) {
      throw new AppError('Valid pickup and destination coordinates are required', 400, 'INVALID_COORDINATES');
    }

    const distanceKm = FareService.calculateDistanceKm(
      pickup.lat,
      pickup.lng,
      destination.lat,
      destination.lng
    );
    const durationMinutes = FareService.estimateDurationMinutes(distanceKm);

    const categories: VehicleCategory[] = ['ECO', 'STANDARD', 'COMFORT', 'VIP'];
    const estimates = categories.map((cat) => {
      const fare = FareService.calculateFare(distanceKm, durationMinutes, cat);
      return {
        category: cat,
        distanceKm,
        durationMinutes,
        estimatedFare: fare.total,
        breakdown: fare,
      };
    });

    res.json({
      success: true,
      data: {
        distanceKm,
        durationMinutes,
        estimates,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Request Ride
rideRouter.post('/request', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pickup, destination, vehicleCategory = 'STANDARD', paymentMethod = 'WALLET' } = req.body;

    if (!pickup?.lat || !pickup?.lng || !destination?.lat || !destination?.lng) {
      throw new AppError('Pickup and destination locations are required', 400, 'INVALID_INPUT');
    }

    // Check if user already has an ongoing active ride
    const userRides = db.getRidesByRiderId(req.user!.userId);
    const activeRide = userRides.find((r) =>
      ['REQUESTED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'].includes(r.status)
    );
    if (activeRide) {
      throw new AppError('You already have an active ride in progress', 400, 'ACTIVE_RIDE_EXISTS');
    }

    const distanceKm = FareService.calculateDistanceKm(
      pickup.lat,
      pickup.lng,
      destination.lat,
      destination.lng
    );
    const durationMinutes = FareService.estimateDurationMinutes(distanceKm);
    const fare = FareService.calculateFare(distanceKm, durationMinutes, vehicleCategory as VehicleCategory);

    const ride: IRide = {
      id: 'ride_' + Math.random().toString(36).substring(2, 9),
      riderId: req.user!.userId,
      status: 'REQUESTED',
      vehicleCategory: vehicleCategory as VehicleCategory,
      pickup: {
        lat: pickup.lat,
        lng: pickup.lng,
        address: pickup.address || 'موقع الركوب',
      },
      destination: {
        lat: destination.lat,
        lng: destination.lng,
        address: destination.address || 'الوجهة',
      },
      estimatedFare: fare.total,
      distanceKm,
      durationMinutes,
      paymentMethod,
      paymentStatus: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.createRide(ride);
    db.logAudit(req.user!.userId, 'RIDE_REQUESTED', { rideId: ride.id, fare: fare.total });

    // Initiate dispatch
    DispatchService.dispatchRide(ride);

    res.status(201).json({ success: true, data: ride });
  } catch (err) {
    next(err);
  }
});

// Get Active Ride for current User or Driver
rideRouter.get('/active', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  let activeRide: IRide | undefined;

  if (req.user!.role === 'DRIVER') {
    const driver = db.findDriverByUserId(userId);
    if (driver) {
      const driverRides = db.getRidesByDriverId(driver.id);
      activeRide = driverRides.find((r) =>
        ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'].includes(r.status)
      );
    }
  } else {
    const userRides = db.getRidesByRiderId(userId);
    activeRide = userRides.find((r) =>
      ['REQUESTED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'].includes(r.status)
    );
  }

  if (!activeRide) {
    res.json({ success: true, data: null });
    return;
  }

  // Enrich with driver details if assigned
  let driverDetails = null;
  if (activeRide.driverId) {
    const driver = db.findDriverById(activeRide.driverId);
    if (driver) {
      const driverUser = db.findUserById(driver.userId);
      driverDetails = {
        id: driver.id,
        name: driverUser?.name,
        phone: driverUser?.phone,
        avatarUrl: driverUser?.avatarUrl,
        rating: driver.rating,
        vehicle: driver.vehicle,
        currentLocation: driver.currentLocation,
      };
    }
  }

  // Enrich with rider details if driver
  let riderDetails = null;
  const rider = db.findUserById(activeRide.riderId);
  if (rider) {
    riderDetails = {
      id: rider.id,
      name: rider.name,
      phone: rider.phone,
      avatarUrl: rider.avatarUrl,
    };
  }

  res.json({
    success: true,
    data: {
      ...activeRide,
      driver: driverDetails,
      rider: riderDetails,
    },
  });
});

// Get Ride by ID (with IDOR Protection)
rideRouter.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const ride = db.findRideById(req.params.id);
    if (!ride) throw new AppError('Ride not found', 404, 'NOT_FOUND');

    const driver = db.findDriverByUserId(req.user!.userId);
    const isRider = ride.riderId === req.user!.userId;
    const isDriver = driver && ride.driverId === driver.id;
    const isAdmin = req.user!.role === 'ADMIN';

    // IDOR verification
    if (!isRider && !isDriver && !isAdmin) {
      throw new AppError('Access denied. You do not own this ride.', 403, 'FORBIDDEN_IDOR');
    }

    res.json({ success: true, data: ride });
  } catch (err) {
    next(err);
  }
});

// Accept Ride (Driver only with concurrency race protection)
rideRouter.post('/:id/accept', (req: Request, res: Response, next: NextFunction) => {
  try {
    const driver = db.findDriverByUserId(req.user!.userId);
    if (!driver || driver.approvalStatus !== 'APPROVED') {
      throw new AppError('Only approved drivers can accept rides', 403, 'FORBIDDEN');
    }

    const result = db.atomicAcceptRide(req.params.id, driver.id);
    if (!result.success || !result.ride) {
      throw new AppError(result.message, 409, 'RACE_CONDITION_LOST');
    }

    DispatchService.notifyDriverAssigned(result.ride, driver);

    res.json({ success: true, data: result.ride });
  } catch (err) {
    next(err);
  }
});

// Transition Ride Status (State Machine Enforcement)
rideRouter.post('/:id/transition', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body as { status: RideStatus };
    const ride = db.findRideById(req.params.id);
    if (!ride) throw new AppError('Ride not found', 404, 'NOT_FOUND');

    const driver = db.findDriverByUserId(req.user!.userId);
    const isDriver = driver && ride.driverId === driver.id;
    const isAdmin = req.user!.role === 'ADMIN';

    if (!isDriver && !isAdmin) {
      throw new AppError('Only the assigned driver or admin can update ride status', 403, 'FORBIDDEN');
    }

    // State machine legal transition map
    const transitions: Record<RideStatus, RideStatus[]> = {
      REQUESTED: [],
      SEARCHING_DRIVER: ['DRIVER_ASSIGNED', 'NO_DRIVER_FOUND', 'CANCELLED'],
      DRIVER_ASSIGNED: ['DRIVER_ARRIVING', 'CANCELLED'],
      DRIVER_ARRIVING: ['DRIVER_ARRIVED', 'CANCELLED'],
      DRIVER_ARRIVED: ['RIDE_STARTED', 'CANCELLED'],
      RIDE_STARTED: ['RIDE_COMPLETED'],
      RIDE_COMPLETED: [],
      CANCELLED: [],
      NO_DRIVER_FOUND: [],
    };

    const allowed = Object.entries(transitions)
      .filter(([_, nexts]) => nexts.includes(status))
      .map(([prev]) => prev as RideStatus);

    const additionalUpdates: Partial<IRide> = {};
    if (status === 'RIDE_STARTED') {
      additionalUpdates.startedAt = new Date().toISOString();
    } else if (status === 'RIDE_COMPLETED') {
      additionalUpdates.completedAt = new Date().toISOString();
      additionalUpdates.finalFare = ride.estimatedFare;
    }

    const transitionResult = db.atomicTransitionRide(
      req.params.id,
      status,
      allowed,
      additionalUpdates
    );

    if (!transitionResult.success || !transitionResult.ride) {
      throw new AppError(transitionResult.error || 'Illegal state transition', 400, 'ILLEGAL_TRANSITION');
    }

    // Broadcast update via Socket.IO
    if (io) {
      io.to(`ride:${ride.id}`).emit('ride:status_changed', {
        rideId: ride.id,
        status,
        ride: transitionResult.ride,
      });
    }

    res.json({ success: true, data: transitionResult.ride });
  } catch (err) {
    next(err);
  }
});

// Cancel Ride
rideRouter.post('/:id/cancel', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body;
    const ride = db.findRideById(req.params.id);
    if (!ride) throw new AppError('Ride not found', 404, 'NOT_FOUND');

    const driver = db.findDriverByUserId(req.user!.userId);
    const isRider = ride.riderId === req.user!.userId;
    const isDriver = driver && ride.driverId === driver.id;
    const isAdmin = req.user!.role === 'ADMIN';

    if (!isRider && !isDriver && !isAdmin) {
      throw new AppError('Unauthorized to cancel this ride', 403, 'FORBIDDEN');
    }

    if (['RIDE_COMPLETED', 'CANCELLED'].includes(ride.status)) {
      throw new AppError(`Cannot cancel a ride that is already ${ride.status}`, 400, 'CANNOT_CANCEL');
    }

    const cancelledBy = isRider ? 'RIDER' : isDriver ? 'DRIVER' : 'SYSTEM';

    const updated = db.updateRide(ride.id, {
      status: 'CANCELLED',
      cancellationReason: reason || 'Cancelled by user',
      cancelledBy,
    });

    if (io) {
      io.to(`ride:${ride.id}`).emit('ride:status_changed', {
        rideId: ride.id,
        status: 'CANCELLED',
        cancelledBy,
        reason,
      });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// Rate Ride
rideRouter.post('/:id/rate', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stars, comment } = req.body;
    if (!stars || stars < 1 || stars > 5) {
      throw new AppError('Rating must be between 1 and 5 stars', 400, 'INVALID_RATING');
    }

    const ride = db.findRideById(req.params.id);
    if (!ride) throw new AppError('Ride not found', 404, 'NOT_FOUND');

    if (ride.riderId !== req.user!.userId) {
      throw new AppError('Only the rider can submit rating for this ride', 403, 'FORBIDDEN');
    }

    const driver = ride.driverId ? db.findDriverById(ride.driverId) : null;
    const toUserId = driver ? driver.userId : '';

    const rating = db.addRating({
      id: 'rat_' + Math.random().toString(36).substring(2, 9),
      rideId: ride.id,
      fromUserId: req.user!.userId,
      toUserId,
      stars: Number(stars),
      comment: comment ? String(comment).trim() : undefined,
      createdAt: new Date().toISOString(),
    });

    // Recalculate driver rating average
    if (driver) {
      const allRatings = db.getUserRatings(driver.userId);
      const avg = allRatings.reduce((acc, curr) => acc + curr.stars, 0) / allRatings.length;
      db.updateDriver(driver.id, {
        rating: Math.round(avg * 10) / 10,
        totalRides: (driver.totalRides || 0) + 1,
      });
    }

    res.json({ success: true, data: rating });
  } catch (err) {
    next(err);
  }
});

// List rides for current user
rideRouter.get('/', (req: Request, res: Response) => {
  const rides =
    req.user!.role === 'DRIVER'
      ? db.getRidesByDriverId(db.findDriverByUserId(req.user!.userId)?.id || '')
      : db.getRidesByRiderId(req.user!.userId);

  res.json({ success: true, data: rides });
});
