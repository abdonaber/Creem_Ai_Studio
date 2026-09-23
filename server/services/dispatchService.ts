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

    // Register queue job handlers
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

    // Atomically transition ride to SEARCHING_DRIVER
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

    // Hand off dispatch work to BullMQ queue
    await QueueManager.enqueueRideDispatch(ride.id);
  }

  /**
   * Worker handler that initiates candidate matching
   */
  private static async executeOfferCandidate(rideId: string): Promise<void> {
    await this.offerNextCandidate(rideId);
  }

  /**
   * Sequential Candidate Dispatch
   * Selects nearest eligible candidate using MongoDB geospatial aggregation,
   * creates time-limited offer (25s), schedules delayed BullMQ expiration,
   * or expands search radius, or transitions to NO_DRIVER_FOUND.
   */
  public static async offerNextCandidate(rideId: string): Promise<void> {
    const lockKey = `dispatch_ride:${rideId}`;
    const lock = await acquireLock(lockKey, 15000);
    if (!lock.acquired) {
      logger.debug(`[Dispatch] Ride ${rideId} is currently being processed by another worker. Skipping.`);
      return;
    }

    try {
      const ride = await db.findRideById(rideId);
      if (!ride || ride.status !== 'SEARCHING_DRIVER') {
        logger.debug(`[Dispatch] Ride ${rideId} is not in SEARCHING_DRIVER state. Aborting offer.`);
        return;
      }

      const currentRadius = ride.searchRadiusKm || 5;
      const retryCount = ride.retryCount || 0;
      const excludedDriverIds = ride.offeredDriverIds || [];

      // Query nearest eligible drivers with MongoDB $geoNear server-side aggregation
      const candidates = await db.findNearbyEligibleDrivers({
        pickupLat: ride.pickup.lat,
        pickupLng: ride.pickup.lng,
        radiusKm: currentRadius,
        category: ride.vehicleCategory as VehicleCategory,
        excludedDriverIds,
      });

      if (candidates.length > 0) {
        // Pick closest available candidate
        const target = candidates[0];
        const driver = target.driver;
        const driverUser = await db.findUserById(driver.userId);

        const offerTtlMs = 25000; // 25 seconds for driver to respond
        const expiresAt = new Date(Date.now() + offerTtlMs).toISOString();

        // Create persistent RideOffer in database
        const offer = await db.createRideOffer({
          rideId: ride.id,
          driverId: driver.id,
          status: 'PENDING',
          expiresAt,
          distanceKm: target.distanceKm,
          estimatedFare: ride.estimatedFare,
        });

        // Update ride with current offer and record driver in offered list
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
          `[Dispatch] Dispatched offer ${offer.id} for ride ${ride.id} to driver ${driver.id} (${driverUser?.name}). Distance: ${target.distanceKm}km. Expires in 25s.`
        );

        // Schedule delayed BullMQ offer expiration job
        await QueueManager.scheduleOfferExpiration(ride.id, offer.id, offerTtlMs);

        // Targeted socket notification to the selected driver
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

          // Inform rider that search is active
          io.to(`ride:${ride.id}`).emit('ride:searching_progress', {
            rideId: ride.id,
            status: 'SEARCHING_DRIVER',
            attempt: updatedOffered.length,
            radiusKm: currentRadius,
          });
        }
        return;
      }

      // No candidates found in current radius -> Check for radius expansion
      if (currentRadius < 15) {
        const nextRadius = currentRadius === 5 ? 10 : 15;
        logger.info(
          `[Dispatch] Expanding search radius for ride ${ride.id} from ${currentRadius}km to ${nextRadius}km.`
        );

        await db.updateRide(ride.id, {
          searchRadiusKm: nextRadius,
          retryCount: retryCount + 1,
        });

        // Enqueue search retry job via BullMQ
        await QueueManager.enqueueSearchRetry(ride.id, nextRadius, retryCount + 1, 300);
        return;
      }

      // Max radius reached and no candidates found -> NO_DRIVER_FOUND
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
    } finally {
      await releaseLock(lockKey, lock.token);
    }
  }

  /**
   * Driver explicitly declines the offer
   * Immediately marks offer REJECTED and advances to the next closest candidate.
   */
  public static async handleDriverReject(
    rideId: string,
    driverId: string,
    offerId?: string
  ): Promise<void> {
    logger.info(`[Dispatch] Driver ${driverId} rejected offer for ride ${rideId}`);

    if (offerId) {
      await db.updateRideOfferStatus(offerId, 'REJECTED');
    } else {
      const activeOffer = await db.findActiveOfferForRide(rideId);
      if (activeOffer && activeOffer.driverId === driverId) {
        await db.updateRideOfferStatus(activeOffer.id, 'REJECTED');
      }
    }

    // Immediately trigger next candidate offer without waiting
    await this.offerNextCandidate(rideId);
  }

  /**
   * Offer Timeout Handler
   * Called by delayed BullMQ job when driver didn't respond within 25 seconds.
   */
  public static async handleOfferTimeout(rideId: string, offerId: string): Promise<void> {
    const offer = await db.findOfferById(offerId);
    if (!offer || offer.status !== 'PENDING') {
      // Offer already accepted or rejected; idempotent no-op
      return;
    }

    logger.info(`[Dispatch] Offer ${offerId} for ride ${rideId} expired.`);
    await db.updateRideOfferStatus(offerId, 'EXPIRED');

    // Notify driver that offer expired
    if (io) {
      const driver = await db.findDriverById(offer.driverId);
      if (driver) {
        io.to(`user:${driver.userId}`).emit('ride:offer_expired', {
          offerId,
          rideId,
        });
      }
    }

    // Advance to next candidate
    await this.offerNextCandidate(rideId);
  }

  /**
   * Handles notification delivery and DB persistence
   */
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

  /**
   * Notifies rider and driver when ride is assigned
   */
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
