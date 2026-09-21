import { db } from '../db/store';
import { FareService } from './fareService';
import { IRide, IDriver, LocationCoordinate } from '../types';
import { io } from '../socket/socketHandler';

export class DispatchService {
  /**
   * Finds nearby online approved drivers within a given radius in km
   */
  public static findNearbyDrivers(
    location: LocationCoordinate,
    radiusKm: number = 15,
    category?: string
  ): Array<{ driver: IDriver; distanceKm: number }> {
    const onlineDrivers = db.getOnlineApprovedDrivers();

    const matched = onlineDrivers
      .filter((d) => {
        if (category && d.vehicle && d.vehicle.category !== category) {
          return false;
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
  public static dispatchRide(ride: IRide): void {
    const nearby = this.findNearbyDrivers(ride.pickup, 20, ride.vehicleCategory);

    // Update ride to SEARCHING_DRIVER
    db.updateRide(ride.id, { status: 'SEARCHING_DRIVER' });

    if (io) {
      // Notify rider
      io.to(`ride:${ride.id}`).emit('ride:status_changed', {
        rideId: ride.id,
        status: 'SEARCHING_DRIVER',
      });

      // Broadcast ride offer to driver channel
      io.to('role:drivers').emit('ride:new_offer', {
        rideId: ride.id,
        pickup: ride.pickup,
        destination: ride.destination,
        estimatedFare: ride.estimatedFare,
        distanceKm: ride.distanceKm,
        durationMinutes: ride.durationMinutes,
        vehicleCategory: ride.vehicleCategory,
      });

      // Also notify individual nearby drivers directly
      const socketServer = io;
      if (socketServer) {
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
    }

    // In demo / simulation mode, if no driver accepts within 4 seconds,
    // let an online demo driver accept automatically so the tester sees the live journey!
    if (process.env.ENABLE_SIMULATION !== 'false' && nearby.length > 0) {
      setTimeout(() => {
        const currentRide = db.findRideById(ride.id);
        if (currentRide && currentRide.status === 'SEARCHING_DRIVER') {
          const autoDriver = nearby[0].driver;
          const acceptResult = db.atomicAcceptRide(currentRide.id, autoDriver.id);
          if (acceptResult.success && acceptResult.ride) {
            this.notifyDriverAssigned(acceptResult.ride, autoDriver);
          }
        }
      }, 3500);
    }
  }

  public static notifyDriverAssigned(ride: IRide, driver: IDriver): void {
    const driverUser = db.findUserById(driver.userId);

    // Transition state
    db.updateRide(ride.id, {
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
  }
}
