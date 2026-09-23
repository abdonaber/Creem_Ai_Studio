import { db } from '../db/store';
import { IRide, IDriver, VehicleCategory } from '../types';
import { io } from '../socket/socketHandler';
import { generateId } from '../utils/id';
import { logger } from '../utils/logger';
import { acquireLock, releaseLock } from '../redis/redisClient';

export class DispatchService {
  private static workerTimer: NodeJS.Timeout | null = null;
  private static isWorkerRunning = false;

  /**
   * Initializes the Dispatch background worker that monitors expired offers
   * and self-heals orphaned ride dispatch requests.
   */
  public static startWorker(): void {
    if (this.workerTimer) return;

    logger.info('[Dispatch Engine] Background worker started.');
    this.workerTimer = setInterval(async () => {
      if (this.isWorkerRunning) return;
      this.isWorkerRunning = true;
      try {
        await this.sweepExpiredOffers();
      } catch (err: any) {
        logger.error('[Dispatch Worker] Error during sweep:', err);
      } finally {
        this.isWorkerRunning = false;
      }
    }, 4000);
  }

  public static stopWorker(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
      logger.info('[Dispatch Engine] Background worker stopped.');
    }
  }

  /**
   * Main Dispatch Entry Point
   * Transitions ride to SEARCHING_DRIVER and starts sequential offers.
   */
  public static async dispatchRide(ride: IRide): Promise<void> {
    logger.info(`[Dispatch] Initiating dispatch for ride ${ride.id}`);

    // Update ride to SEARCHING_DRIVER
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

    // Begin sequential candidate matching
    await this.offerNextCandidate(ride.id);
  }

  /**
   * Sequential Candidate Dispatch
   * Selects the nearest eligible candidate, creates a time-limited offer (25s),
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

      // Query nearest eligible drivers
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

        // Release lock before recursive call so next cycle can acquire
        await releaseLock(lockKey, lock.token);
        return this.offerNextCandidate(ride.id);
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

        await db.createNotification({
          id: generateId('notif'),
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

    // Immediately trigger next candidate offer without rider waiting
    await this.offerNextCandidate(rideId);
  }

  /**
   * Offer Timeout Handler
   * Called when driver didn't respond within 25 seconds.
   */
  public static async handleOfferTimeout(rideId: string, offerId: string): Promise<void> {
    logger.info(`[Dispatch] Offer ${offerId} for ride ${rideId} expired.`);
    await db.updateRideOfferStatus(offerId, 'EXPIRED');

    // Notify driver that offer expired
    const offer = await db.findOfferById(offerId);
    if (offer && io) {
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
   * Periodic sweep for expired offers and stuck searches across distributed instances
   */
  private static async sweepExpiredOffers(): Promise<void> {
    const sweepLock = await acquireLock('dispatch_sweep_leader', 3500);
    if (!sweepLock.acquired) {
      // Another instance is already handling the periodic sweep
      return;
    }

    try {
      const expiredOffers = await db.getPendingOffersExpiredBefore(new Date());
      for (const offer of expiredOffers) {
        await this.handleOfferTimeout(offer.rideId, offer.id);
      }
    } finally {
      await releaseLock('dispatch_sweep_leader', sweepLock.token);
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
          phone: driverUser?.phone || '+966 50 123 4567',
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

    await db.createNotification({
      id: generateId('notif'),
      userId: ride.riderId,
      title: 'تم قبول رحلتك! 🚗',
      body: `الكابتن ${driverUser?.name || ''} في طريقه إلى نقطة الالتقاء.`,
      type: 'RIDE_UPDATE',
      metadata: { rideId: ride.id, driverId: driver.id },
    });
  }
}
