import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { FareService } from '../services/fareService';
import { RoutingService } from '../services/routing/routingService';
import { DispatchService } from '../services/dispatchService';
import { PaymentService } from '../services/paymentService';
import { IRide, RideStatus, VehicleCategory } from '../types';
import { io } from '../socket/socketHandler';
import { generateId } from '../utils/id';

export const rideRouter = Router();

rideRouter.use(authenticate);

const coordSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  address: z.string().trim().max(300).optional(),
});

const estimateSchema = z.object({
  pickup: coordSchema,
  destination: coordSchema,
});

const requestRideSchema = z.object({
  pickup: coordSchema,
  destination: coordSchema,
  vehicleCategory: z.enum(['ECO', 'STANDARD', 'COMFORT', 'VIP']).default('STANDARD'),
  paymentMethod: z.enum(['WALLET', 'CASH', 'CREDIT_CARD']).default('WALLET'),
});

const transitionSchema = z.object({
  status: z.enum([
    'REQUESTED',
    'SEARCHING_DRIVER',
    'DRIVER_ASSIGNED',
    'DRIVER_ARRIVING',
    'DRIVER_ARRIVED',
    'RIDE_STARTED',
    'RIDE_COMPLETED',
    'CANCELLED',
    'NO_DRIVER_FOUND',
  ]),
});

// Estimate Fare
rideRouter.post('/estimate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = estimateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Valid pickup and destination coordinates are required', 400, 'INVALID_COORDINATES');
    }

    const { pickup, destination } = parsed.data;
    const route = await RoutingService.calculateRoute(
      { lat: pickup.lat, lng: pickup.lng },
      { lat: destination.lat, lng: destination.lng }
    );
    const distanceKm = route.distanceKm;
    const durationMinutes = route.durationMinutes;

    const categories: VehicleCategory[] = ['ECO', 'STANDARD', 'COMFORT', 'VIP'];
    const estimates = categories.map((cat) => {
      const fare = FareService.calculateFare(distanceKm, durationMinutes, cat);
      return {
        category: cat,
        distanceKm,
        durationMinutes,
        estimatedFare: fare.total,
        breakdown: fare,
        routePolyline: route.polyline,
        routingProvider: route.provider,
      };
    });

    res.json({
      success: true,
      data: {
        distanceKm,
        durationMinutes,
        estimates,
        routePolyline: route.polyline,
        routingProvider: route.provider,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Request Ride
rideRouter.post('/request', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = requestRideSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Pickup and destination coordinates are required', 400, 'INVALID_INPUT');
    }

    const { pickup, destination, vehicleCategory, paymentMethod } = parsed.data;

    const existingActive = await db.findActiveRideForUser(req.user!.userId);
    if (existingActive) {
      throw new AppError('You already have an active ride in progress', 400, 'ACTIVE_RIDE_EXISTS');
    }

    const route = await RoutingService.calculateRoute(
      { lat: pickup.lat, lng: pickup.lng },
      { lat: destination.lat, lng: destination.lng }
    );
    const distanceKm = route.distanceKm;
    const durationMinutes = route.durationMinutes;
    const fare = FareService.calculateFare(distanceKm, durationMinutes, vehicleCategory as VehicleCategory);

    const ride: IRide = {
      id: generateId('ride'),
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

    const createdRide = await db.createRide(ride);
    await db.logAudit(req.user!.userId, 'RIDE_REQUESTED', { rideId: createdRide.id, fare: fare.total });

    await DispatchService.dispatchRide(createdRide);

    res.status(201).json({ success: true, data: createdRide });
  } catch (err) {
    next(err);
  }
});

// Get Active Ride for current User or Driver
rideRouter.get('/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    let activeRide: IRide | null = null;

    if (req.user!.role === 'DRIVER') {
      const driver = await db.findDriverByUserId(userId);
      if (driver) {
        const driverRides = await db.getRidesByDriverId(driver.id);
        activeRide =
          driverRides.find((r) =>
            ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'].includes(
              r.status
            )
          ) || null;
      }
    } else {
      activeRide = await db.findActiveRideForUser(userId);
    }

    if (!activeRide) {
      res.json({ success: true, data: null });
      return;
    }

    let driverDetails = null;
    if (activeRide.driverId) {
      const driver = await db.findDriverById(activeRide.driverId);
      if (driver) {
        const driverUser = await db.findUserById(driver.userId);
        const vehicle = await db.findVehicleByDriverId(driver.id);
        driverDetails = {
          id: driver.id,
          name: driverUser?.name,
          phone: driverUser?.phone,
          avatarUrl: driverUser?.avatarUrl,
          rating: driver.rating,
          vehicle: vehicle || driver.vehicle,
          currentLocation: driver.currentLocation,
        };
      }
    }

    let riderDetails = null;
    const rider = await db.findUserById(activeRide.riderId);
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
  } catch (err) {
    next(err);
  }
});

// Get Ride by ID (with IDOR Protection)
rideRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ride = await db.findRideById(req.params.id);
    if (!ride) throw new AppError('Ride not found', 404, 'NOT_FOUND');

    const driver = await db.findDriverByUserId(req.user!.userId);
    const isRider = ride.riderId === req.user!.userId;
    const isDriver = Boolean(driver && ride.driverId === driver.id);
    const isAdmin = req.user!.role === 'ADMIN';

    if (!isRider && !isDriver && !isAdmin) {
      throw new AppError('Access denied. You do not own this ride.', 403, 'FORBIDDEN_IDOR');
    }

    res.json({ success: true, data: ride });
  } catch (err) {
    next(err);
  }
});

// Accept Ride (Driver only with concurrency race protection)
rideRouter.post('/:id/accept', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const driver = await db.findDriverByUserId(req.user!.userId);
    if (!driver || driver.approvalStatus !== 'APPROVED') {
      throw new AppError('Only approved drivers can accept rides', 403, 'FORBIDDEN');
    }
    if (!driver.isOnline) {
      throw new AppError('Driver must be online to accept rides', 400, 'DRIVER_OFFLINE');
    }

    const result = await db.atomicAcceptRide(req.params.id, driver.id);
    if (!result.success || !result.ride) {
      throw new AppError(result.message || 'Ride claim failed', 409, 'RACE_CONDITION_LOST');
    }

    await DispatchService.notifyDriverAssigned(result.ride, driver);

    res.json({ success: true, data: result.ride });
  } catch (err) {
    next(err);
  }
});

// Decline Ride Offer
rideRouter.post('/:id/decline', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const driver = await db.findDriverByUserId(req.user!.userId);
    if (!driver) {
      throw new AppError('Only registered drivers can decline ride offers', 403, 'FORBIDDEN');
    }

    const { offerId } = req.body;
    await DispatchService.handleDriverReject(req.params.id, driver.id, offerId);

    res.json({ success: true, message: 'Offer declined. Next candidate being dispatched.' });
  } catch (err) {
    next(err);
  }
});

// Transition Ride Status (State Machine Enforcement)
rideRouter.post('/:id/transition', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Invalid target ride status', 400, 'INVALID_STATUS');
    }

    const { status } = parsed.data as { status: RideStatus };
    const ride = await db.findRideById(req.params.id);
    if (!ride) throw new AppError('Ride not found', 404, 'NOT_FOUND');

    const driver = await db.findDriverByUserId(req.user!.userId);
    const isDriver = Boolean(driver && ride.driverId === driver.id);
    const isAdmin = req.user!.role === 'ADMIN';

    if (!isDriver && !isAdmin) {
      throw new AppError('Only the assigned driver or admin can update ride status', 403, 'FORBIDDEN');
    }

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
      additionalUpdates.finalFare = FareService.calculateFinalFare(ride);
    }

    const transitionResult = await db.atomicTransitionRide(
      req.params.id,
      status,
      allowed,
      additionalUpdates
    );

    if (!transitionResult.success || !transitionResult.ride) {
      throw new AppError(
        transitionResult.message || 'Illegal state transition',
        400,
        'ILLEGAL_TRANSITION'
      );
    }

    if (status === 'RIDE_COMPLETED') {
      try {
        await PaymentService.processRidePayment(
          ride.id,
          ride.riderId,
          transitionResult.ride.finalFare || ride.estimatedFare,
          ride.paymentMethod
        );
      } catch (payErr: any) {
        console.warn(`[Payment] Auto-settlement note for ride ${ride.id}:`, payErr.message);
      }
    }

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
rideRouter.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body;
    const ride = await db.findRideById(req.params.id);
    if (!ride) throw new AppError('Ride not found', 404, 'NOT_FOUND');

    const driver = await db.findDriverByUserId(req.user!.userId);
    const isRider = ride.riderId === req.user!.userId;
    const isDriver = Boolean(driver && ride.driverId === driver.id);
    const isAdmin = req.user!.role === 'ADMIN';

    if (!isRider && !isDriver && !isAdmin) {
      throw new AppError('Unauthorized to cancel this ride', 403, 'FORBIDDEN');
    }

    if (['RIDE_COMPLETED', 'CANCELLED', 'NO_DRIVER_FOUND'].includes(ride.status)) {
      throw new AppError(`Cannot cancel a ride that is already ${ride.status}`, 400, 'CANNOT_CANCEL');
    }

    const cancelledBy = isRider ? 'RIDER' : isDriver ? 'DRIVER' : isAdmin ? 'ADMIN' : 'SYSTEM';

    const result = await db.atomicTransitionRide(
      ride.id,
      'CANCELLED',
      ['REQUESTED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'],
      {
        cancellationReason: reason ? String(reason).slice(0, 300) : 'Cancelled by user',
        cancelledBy,
        byUserId: req.user!.userId,
      } as any
    );

    if (!result.success || !result.ride) {
      throw new AppError(result.message || 'Failed to cancel ride', 400, 'CANNOT_CANCEL');
    }

    if (io) {
      io.to(`ride:${ride.id}`).emit('ride:status_changed', {
        rideId: ride.id,
        status: 'CANCELLED',
        cancelledBy,
        reason,
        ride: result.ride,
      });
    }

    res.json({ success: true, data: result.ride });
  } catch (err) {
    next(err);
  }
});

// Rate Ride
rideRouter.post('/:id/rate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stars, comment } = req.body;
    const numericStars = Number(stars);
    if (!Number.isFinite(numericStars) || numericStars < 1 || numericStars > 5) {
      throw new AppError('Rating must be between 1 and 5 stars', 400, 'INVALID_RATING');
    }

    const ride = await db.findRideById(req.params.id);
    if (!ride) throw new AppError('Ride not found', 404, 'NOT_FOUND');

    if (ride.riderId !== req.user!.userId) {
      throw new AppError('Only the rider can submit rating for this ride', 403, 'FORBIDDEN');
    }

    if (ride.status !== 'RIDE_COMPLETED') {
      throw new AppError('Can only rate completed rides', 400, 'RIDE_NOT_COMPLETED');
    }

    const existingRating = await db.findRatingByRideAndFromUser(ride.id, req.user!.userId);
    if (existingRating) {
      throw new AppError('You have already submitted a rating for this ride.', 400, 'ALREADY_RATED');
    }

    const driver = ride.driverId ? await db.findDriverById(ride.driverId) : null;
    const toUserId = driver ? driver.userId : '';

    const rating = await db.createRating({
      id: generateId('rat'),
      rideId: ride.id,
      fromUserId: req.user!.userId,
      toUserId,
      stars: numericStars,
      comment: comment ? String(comment).trim().slice(0, 500) : undefined,
      createdAt: new Date().toISOString(),
    });

    if (driver) {
      const allRatings = await db.getRatingsForUser(driver.userId);
      if (allRatings.length > 0) {
        const avg = allRatings.reduce((acc, curr) => acc + curr.stars, 0) / allRatings.length;
        await db.updateDriver(driver.id, {
          rating: Math.round(avg * 10) / 10,
        });
      }
    }

    res.json({ success: true, data: rating });
  } catch (err) {
    next(err);
  }
});

// List rides for current user
rideRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let rides: IRide[];
    if (req.user!.role === 'DRIVER') {
      const driver = await db.findDriverByUserId(req.user!.userId);
      rides = driver ? await db.getRidesByDriverId(driver.id) : [];
    } else {
      rides = await db.getRidesByRiderId(req.user!.userId);
    }

    res.json({ success: true, data: rides });
  } catch (err) {
    next(err);
  }
});
