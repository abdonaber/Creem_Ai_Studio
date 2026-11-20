import { db } from '../db/store';
import { IRide, IDriver, VehicleCategory } from '../types';
import { io } from '../socket/socketHandler';
import { generateId } from '../utils/id';
import { logger } from '../utils/logger';
import { acquireLock, releaseLock } from '../redis/redisClient';
import { QueueManager, NotificationJobData } from '../queue/queueManager';

export class DispatchService {
  private static isInitialized = false;

  /**
   * Initializes the Dispatch Engine and connects BullMQ workers
   */
  public static async init(): Promise<void> {
    if (this.isInitialized) return;

    QueueManager.registerHandlers({
      onDispatch: async (rideId: string) => {
        await this.executeOfferCandidate(rideId);
      },
      onOfferTimeout: async (rideId: string, offerId: string) => {
        await this.handleOfferTimeout(rideId, offerId);
      },
      onSearchRetry: async (rideId: string) => {
        await this.offerNextCandidate(rideId);
      },
      onNotification: async (data: NotificationJobData) => {
        await this.processNotification(data);
      },
    });

    await QueueManager.init();
    this.isInitialized = true;
    logger.info('[Dispatch Engine] Initialized with BullMQ distributed queues & workers.');
  }

  /**
   * Stops background dispatch workers and releases queue resources gracefully
   */
  public static async stopWorker(): Promise<void> {
    await QueueManager.close();
    this.isInitialized = false;
    logger.info('[Dispatch Engine] Background workers stopped.');
  }

  /**
   * Backward-compatible start worker
   */
  public static startWorker(): void {
    this.init().catch((err) => {
      logger.error('[Dispatch Engine] Failed to initialize dispatch workers:', err);
    });
  }

  /**
   * Main Dispatch Entry Point
   * Transitions ride to SEARCHING_DRIVER and enqueues background dispatch job.
   */
  public static async dispatchRide(ride: IRide): Promise<void> {
    logger.info(`[Dispatch] Initiating dispatch for ride ${ride.id}`);

    await db.atomicTransitionRide(ride.id, 'SEARCHING_DRIVER', ['REQUESTED'], {
      searchRadiusKm: 5,
      retryCount: 0,
      offeredDriverIds: [],
    });

    if (io) {
      io.to(`ride:${ride.id}`).emit('ride:status_changed', {
        rideId: ride.id,
        status: 'SEARCHING_DRIVER',
      });
    }

    await QueueManager.enqueueRideDispatch(ride.id);
  }

  private static async executeOfferCandidate(rideId: string): Promise<void> {
    await this.offerNextCandidate(rideId);
  }

  /**
   * Locks ride dispatch and offers next closest eligible driver
   */
  public static async offerNextCandidate(rideId: string): Promise<void> {
    const lockKey = `dispatch_ride:${rideId}`;
    const lock = await acquireLock(lockKey, 15000);
    if (!lock.acquired) {
      logger.debug(`[Dispatch] Ride ${rideId} is currently being processed by another worker. Skipping.`);
      return;
    }

    try {
      await this.offerNextCandidateUnlocked(rideId);
    } finally {
      await releaseLock(lockKey, lock.token);
    }
  }

  private static async offerNextCandidateUnlocked(rideId: string): Promise<void> {
    const ride = await db.findRideById(rideId);
    if (!ride || ride.status !== 'SEARCHING_DRIVER' || ride.driverId) {
      logger.debug(`[Dispatch] Ride ${rideId} is not eligible for offer dispatch. Aborting.`);
      return;
    }

    const currentRadius = ride.searchRadiusKm || 5;
    const retryCount = ride.retryCount || 0;
    const excludedDriverIds = ride.offeredDriverIds || [];

    const candidates = await db.findNearbyEligibleDrivers({
      pickupLat: ride.pickup.lat,
      pickupLng: ride.pickup.lng,
      radiusKm: currentRadius,
      category: ride.vehicleCategory as VehicleCategory,
      excludedDriverIds,
    });

    if (candidates.length > 0) {
      const target = candidates[0];
      const driver = target.driver;
      const driverUser = await db.findUserById(driver.userId);

      const offerTtlMs = 25000;
      const expiresAt = new Date(Date.now() + offerTtlMs).toISOString();

      const offer = await db.createRideOffer({
        rideId: ride.id,
        driverId: driver.id,
        status: 'PENDING',
        expiresAt,
        distanceKm: target.distanceKm,
        estimatedFare: ride.estimatedFare,
      });

      const updatedOffered = Array.from(new Set([...excludedDriverIds, driver.id]));
      await db.updateRide(ride.id, {
        offeredDriverIds: updatedOffered,
        currentOffer: {
          driverId: driver.id,
          offerId: offer.id,
          expiresAt,
        },
      });

      logger.info(
        `[Dispatch] Dispatched offer ${offer.id} for ride ${ride.id} to driver ${driver.id} (${driverUser?.name}). Distance: ${target.distanceKm}km.`
      );

      await QueueManager.scheduleOfferExpiration(ride.id, offer.id, offerTtlMs);

      if (io) {
        io.to(`user:${driver.userId}`).emit('ride:incoming_request', {
          offerId: offer.id,
          rideId: ride.id,
          pickup: ride.pickup,
          destination: ride.destination,
          estimatedFare: ride.estimatedFare,
          distanceKm: ride.distanceKm,
          durationMinutes: ride.durationMinutes,
          vehicleCategory: ride.vehicleCategory,
          driverDistanceKm: target.distanceKm,
          expiresAt,
          countdownSeconds: 25,
        });

        io.to(`ride:${ride.id}`).emit('ride:searching_progress', {
          rideId: ride.id,
          status: 'SEARCHING_DRIVER',
          attempt: updatedOffered.length,
          radiusKm: currentRadius,
        });
      }
      return;
    }

    if (currentRadius < 15) {
      const nextRadius = currentRadius === 5 ? 10 : 15;
      logger.info(
        `[Dispatch] Expanding search radius for ride ${ride.id} from ${currentRadius}km to ${nextRadius}km.`
      );

      await db.updateRide(ride.id, {
        searchRadiusKm: nextRadius,
        retryCount: retryCount + 1,
      });

      await QueueManager.enqueueSearchRetry(ride.id, nextRadius, retryCount + 1, 300);
      return;
    }

    logger.warn(`[Dispatch] No drivers found for ride ${ride.id} within 15km.`);
    const transition = await db.atomicTransitionRide(ride.id, 'NO_DRIVER_FOUND', ['SEARCHING_DRIVER'], {
      cancellationReason: 'No captain accepted within radius',
      cancelledBy: 'SYSTEM',
    });

    if (transition.success && io) {
      io.to(`ride:${ride.id}`).emit('ride:status_changed', {
        rideId: ride.id,
        status: 'NO_DRIVER_FOUND',
        message: 'عذراً، لم نتمكن من العثور على كابتن قريب حالياً. يرجى المحاولة بعد قليل.',
      });

      await QueueManager.enqueueNotification({
        userId: ride.riderId,
        title: 'لم يتم العثور على كابتن',
        body: 'نعتذر، جميع الكباتن في منطقتك مشغولون حالياً. حاول مجدداً بعد بضع دقائق.',
        type: 'RIDE_UPDATE',
        metadata: { rideId: ride.id },
      });
    }
  }

  /**
   * Driver explicitly declines the offer
   */
  public static async handleDriverReject(
    rideId: string,
    driverId: string,
    offerId?: string
  ): Promise<void> {
    const lockKey = `dispatch_ride:${rideId}`;
    const lock = await acquireLock(lockKey, 15000);
    if (!lock.acquired) {
      logger.debug(`[Dispatch] Reject skipped: ride ${rideId} dispatch lock busy.`);
      return;
    }

    try {
      const ride = await db.findRideById(rideId);
      if (!ride || ride.status !== 'SEARCHING_DRIVER' || ride.driverId) {
        return;
      }

      logger.info(`[Dispatch] Driver ${driverId} rejected offer for ride ${rideId}`);

      if (offerId) {
        const offer = await db.findOfferById(offerId);
        if (offer && offer.rideId === rideId && offer.driverId === driverId && offer.status === 'PENDING') {
          await db.updateRideOfferStatus(offerId, 'REJECTED');
        }
      } else {
        const activeOffer = await db.findActiveOfferForRide(rideId);
        if (activeOffer && activeOffer.driverId === driverId) {
          await db.updateRideOfferStatus(activeOffer.id, 'REJECTED');
        }
      }

      await db.updateRide(rideId, {
        currentOffer: undefined,
        offeredDriverIds: Array.from(new Set([...(ride.offeredDriverIds || []), driverId])),
      });

      await this.offerNextCandidateUnlocked(rideId);
    } finally {
      await releaseLock(lockKey, lock.token);
    }
  }

  /**
   * Atomic Offer Timeout Handler (guards against concurrent driver accept / ride cancel)
   */
  public static async handleOfferTimeout(rideId: string, offerId: string): Promise<void> {
    const lockKey = `dispatch_ride:${rideId}`;
    const lock = await acquireLock(lockKey, 15000);
    if (!lock.acquired) {
      logger.debug(`[Dispatch] Timeout skipped for offer ${offerId}: ride ${rideId} locked.`);
      return;
    }

    try {
      const [offer, ride] = await Promise.all([
        db.findOfferById(offerId),
        db.findRideById(rideId),
      ]);

      if (
        !offer ||
        offer.status !== 'PENDING' ||
        !ride ||
        ride.status !== 'SEARCHING_DRIVER' ||
        Boolean(ride.driverId)
      ) {
        return;
      }

      logger.info(`[Dispatch] Offer ${offerId} for ride ${rideId} expired.`);
      await db.updateRideOfferStatus(offerId, 'EXPIRED');
      await db.updateRide(rideId, { currentOffer: undefined });

      if (io) {
        const driver = await db.findDriverById(offer.driverId);
        if (driver) {
          io.to(`user:${driver.userId}`).emit('ride:offer_expired', {
            offerId,
            rideId,
          });
        }
      }

      await this.offerNextCandidateUnlocked(rideId);
    } finally {
      await releaseLock(lockKey, lock.token);
    }
  }

  private static async processNotification(data: NotificationJobData): Promise<void> {
    await db.createNotification({
      id: generateId('notif'),
      userId: data.userId,
      title: data.title,
      body: data.body,
      type: data.type as any,
      metadata: data.metadata,
    });

    if (io) {
      io.to(`user:${data.userId}`).emit('notification:new', {
        title: data.title,
        body: data.body,
        type: data.type,
      });
    }
  }

  public static async notifyDriverAssigned(ride: IRide, driver: IDriver): Promise<void> {
    const driverUser = await db.findUserById(driver.userId);
    const vehicle = await db.findVehicleByDriverId(driver.id);

    if (io) {
      io.to(`ride:${ride.id}`).emit('ride:status_changed', {
        rideId: ride.id,
        status: 'DRIVER_ASSIGNED',
        driver: {
          id: driver.id,
          name: driverUser?.name || 'كابتن معتمد',
          phone: driverUser?.phone || '',
          rating: driver.rating,
          vehicle: vehicle || driver.vehicle,
          currentLocation: driver.currentLocation,
        },
      });

      io.to(`user:${ride.riderId}`).emit('notification:new', {
        title: 'تم قبول رحلتك! 🚗',
        body: `الكابتن ${driverUser?.name || ''} في طريقه إلى نقطة الالتقاء.`,
        type: 'RIDE_UPDATE',
      });
    }

    await QueueManager.enqueueNotification({
      userId: ride.riderId,
      title: 'تم قبول رحلتك! 🚗',
      body: `الكابتن ${driverUser?.name || ''} في طريقه إلى نقطة الالتقاء.`,
      type: 'RIDE_UPDATE',
      metadata: { rideId: ride.id, driverId: driver.id },
    });
  }
}
