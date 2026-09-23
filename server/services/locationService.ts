import { db } from '../db/store';
import { io } from '../socket/socketHandler';
import { logger } from '../utils/logger';

interface LastDriverState {
  lat: number;
  lng: number;
  heading: number;
  timestamp: number;
  lastDbPersistedAt: number;
  lastPersistedLat: number;
  lastPersistedLng: number;
}

export class LocationService {
  // In-memory cache for high-frequency location updates
  private static driverStates = new Map<string, LastDriverState>();

  /**
   * Calculates Haversine distance in meters
   */
  private static getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Validates and ingests a driver location update with GPS sanity checks,
   * rate-limiting, and throttled DB writes.
   */
  public static async processDriverLocationUpdate(params: {
    driverId: string;
    userId: string;
    lat: number;
    lng: number;
    heading?: number;
  }): Promise<{ accepted: boolean; reason?: string }> {
    const { driverId, userId, lat, lng, heading = 0 } = params;
    const now = Date.now();

    // 1. Geographic Coordinate Bounds Check
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      isNaN(lat) ||
      isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return { accepted: false, reason: 'INVALID_COORDINATES_BOUNDS' };
    }

    const headingNum = typeof heading === 'number' && !isNaN(heading) ? (heading % 360 + 360) % 360 : 0;
    const previous = this.driverStates.get(driverId);

    if (previous) {
      const elapsedSeconds = (now - previous.timestamp) / 1000;

      // 2. High-Frequency Rate Limiting (Minimum 0.8 seconds between updates)
      if (elapsedSeconds < 0.8) {
        return { accepted: false, reason: 'RATE_LIMIT_EXCEEDED' };
      }

      // 3. Unrealistic Movement / GPS Spoofing Detection
      const distanceMeters = this.getDistanceMeters(previous.lat, previous.lng, lat, lng);
      const speedKmH = (distanceMeters / 1000 / elapsedSeconds) * 3600;

      // Speed threshold: 220 km/h (or impossible teleport > 3000m in < 5 seconds)
      if (speedKmH > 220 || (distanceMeters > 3000 && elapsedSeconds < 5)) {
        logger.warn(
          `[LocationTracker] Unrealistic movement detected for driver ${driverId}: speed=${speedKmH.toFixed(
            1
          )} km/h, distance=${distanceMeters.toFixed(0)}m in ${elapsedSeconds.toFixed(1)}s`
        );
        return { accepted: false, reason: 'UNREALISTIC_MOVEMENT_SPOOFING' };
      }
    }

    // 4. Update in-memory real-time state
    const lastDbPersistedAt = previous ? previous.lastDbPersistedAt : 0;
    const lastPersistedLat = previous ? previous.lastPersistedLat : lat;
    const lastPersistedLng = previous ? previous.lastPersistedLng : lng;

    const state: LastDriverState = {
      lat,
      lng,
      heading: headingNum,
      timestamp: now,
      lastDbPersistedAt,
      lastPersistedLat,
      lastPersistedLng,
    };
    this.driverStates.set(driverId, state);

    const updatedLoc = {
      lat,
      lng,
      heading: headingNum,
      updatedAt: new Date(now).toISOString(),
    };

    // 5. Real-time broadcast to active rides and admin fleet map (Zero DB latency)
    try {
      const allDriverRides = await db.getRidesByDriverId(driverId);
      const activeRides = allDriverRides.filter((r) =>
        ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'].includes(r.status)
      );

      for (const ride of activeRides) {
        if (io) {
          io.to(`ride:${ride.id}`).emit('driver:moved', {
            rideId: ride.id,
            location: updatedLoc,
          });
        }
      }

      if (io) {
        io.to('role:admins').emit('driver:fleet_location', {
          driverId,
          location: updatedLoc,
        });
      }
    } catch (broadcastErr: any) {
      logger.warn(`[LocationTracker] Broadcast error for driver ${driverId}: ${broadcastErr.message}`);
    }

    // 6. Throttled Database Persistence (every 5 seconds or moved > 60m)
    const timeSinceLastDb = now - state.lastDbPersistedAt;
    const distanceSinceLastDb = this.getDistanceMeters(
      state.lastPersistedLat,
      state.lastPersistedLng,
      lat,
      lng
    );

    if (timeSinceLastDb >= 5000 || distanceSinceLastDb >= 60 || !previous) {
      state.lastDbPersistedAt = now;
      state.lastPersistedLat = lat;
      state.lastPersistedLng = lng;

      // Async DB write without blocking caller
      db.updateDriver(driverId, { currentLocation: updatedLoc }).catch((err: any) => {
        logger.error(`[LocationTracker] Failed to persist driver ${driverId} location to DB:`, err);
      });
    }

    return { accepted: true };
  }
}
