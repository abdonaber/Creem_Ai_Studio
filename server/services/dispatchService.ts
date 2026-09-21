import { db } from '../db/store';
import { FareService } from './fareService';
import { IRide, IDriver, LocationCoordinate } from '../types';
import { io } from '../socket/socketHandler';
import { config } from '../config';

export class DispatchService {
  /**
   * Finds nearby online approved drivers within a given radius in km
   * Filters out:
   * - Unapproved or offline drivers
   * - Drivers currently engaged in an active ride
   * - Incompatible vehicle categories
   * - Drivers with stale GPS location (> 5 minutes old)
   */
  public static async findNearbyDrivers(
    location: LocationCoordinate,
    radiusKm: number = 15,
    category?: string
  ): Promise<Array<{ driver: IDriver; distanceKm: number }>> {
    const onlineDrivers = await db.getOnlineApprovedDrivers();
    const allRides = await db.getAllRides();

    // Set of driver IDs currently on active rides
    const busyDriverIds = new Set(
      allRides
        .filter(
          (r) =>
            r.driverId &&
            ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'].includes(
              r.status
            )
        )
        .map((r) => r.driverId!)
    );

    const now = Date.now();
    const STALE_LOCATION_MS = 5 * 60 * 1000; // 5 minutes

    const matched = onlineDrivers
      .filter((d) => {
        // Driver must not be currently in a ride
        if (busyDriverIds.has(d.id)) {
          return false;
        }

        // Vehicle category matching
        if (category && d.vehicle && d.vehicle.category !== category) {
          return false;
        }

        // Stale location check
        if (d.currentLocation?.updatedAt) {
          const updatedTime = new Date(d.currentLocation.updatedAt).getTime();
          if (now - updatedTime > STALE_LOCATION_MS) {
            return false;
          }
        }

        return true;
      })
      .map((driver) => {
        const distanceKm = FareService.calculateDistanceKm(
          location.lat,
          location.lng,
          driver.currentLocation.lat,
          driver.currentLocation.lng
        );
        return { driver, distanceKm };
      })
      .filter((item) => item.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return matched;
  }

  /**
   * Broadcasts a new ride offer to eligible drivers
   */
  public static async dispatchRide(ride: IRide): Promise<void> {
    const nearby = await this.findNearbyDrivers(ride.pickup, 25, ride.vehicleCategory);

    // Update ride to SEARCHING_DRIVER
    await db.updateRide(ride.id, { status: 'SEARCHING_DRIVER' });

    const socketServer = io;
    if (socketServer) {
      // Notify rider
      socketServer.to(`ride:${ride.id}`).emit('ride:status_changed', {
        rideId: ride.id,
        status: 'SEARCHING_DRIVER',
      });

      // Broadcast ride offer to driver channel
      socketServer.to('role:drivers').emit('ride:new_offer', {
        rideId: ride.id,
        pickup: ride.pickup,
        destination: ride.destination,
        estimatedFare: ride.estimatedFare,
        distanceKm: ride.distanceKm,
        durationMinutes: ride.durationMinutes,
        vehicleCategory: ride.vehicleCategory,
      });

      // Also notify individual nearby drivers directly
      nearby.forEach(({ driver }) => {
        socketServer.to(`user:${driver.userId}`).emit('ride:incoming_request', {
          rideId: ride.id,
          pickup: ride.pickup,
          destination: ride.destination,
          estimatedFare: ride.estimatedFare,
          distanceKm: ride.distanceKm,
          durationMinutes: ride.durationMinutes,
          vehicleCategory: ride.vehicleCategory,
        });
      });
    }

    // In non-production Demo / Simulation mode only, simulate driver acceptance
    // strictly when config.demoMode is enabled
    if (config.demoMode && nearby.length > 0) {
      setTimeout(async () => {
        const currentRide = await db.findRideById(ride.id);
        if (currentRide && currentRide.status === 'SEARCHING_DRIVER') {
          const autoDriver = nearby[0].driver;
          const acceptResult = await db.atomicAcceptRide(currentRide.id, autoDriver.id);
          if (acceptResult.success && acceptResult.ride) {
            await this.notifyDriverAssigned(acceptResult.ride, autoDriver);
          }
        }
      }, 3500);
    }
  }

  public static async notifyDriverAssigned(ride: IRide, driver: IDriver): Promise<void> {
    const driverUser = await db.findUserById(driver.userId);

    // Transition state
    await db.updateRide(ride.id, {
      status: 'DRIVER_ASSIGNED',
      driverId: driver.id,
      currentDriverLocation: {
        lat: driver.currentLocation.lat,
        lng: driver.currentLocation.lng,
      },
    });

    if (io) {
      io.to(`ride:${ride.id}`).emit('ride:status_changed', {
        rideId: ride.id,
        status: 'DRIVER_ASSIGNED',
        driver: {
          id: driver.id,
          name: driverUser?.name || 'CreemY Captain',
          phone: driverUser?.phone || '+966 50 123 4567',
          rating: driver.rating,
          vehicle: driver.vehicle,
          currentLocation: driver.currentLocation,
        },
      });

      io.to(`user:${ride.riderId}`).emit('notification:new', {
        title: 'تم العثور على سائق! 🚗',
        body: `الكابتن ${driverUser?.name || ''} في طريقه إليك.`,
        type: 'RIDE_UPDATE',
      });
    }

    // Also persist notification in database
    await db.createNotification({
      id: 'notif_' + Math.random().toString(36).substring(2, 9),
      userId: ride.riderId,
      title: 'تم العثور على سائق! 🚗',
      body: `الكابتن ${driverUser?.name || ''} قبل رحلتك وهو في الطريق إليك.`,
      type: 'RIDE_UPDATE',
      metadata: { rideId: ride.id, driverId: driver.id },
      read: false,
      createdAt: new Date().toISOString(),
    });
  }
}
