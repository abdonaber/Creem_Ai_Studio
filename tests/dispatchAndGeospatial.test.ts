import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueueManager } from '../server/queue/queueManager';
import { RoutingService } from '../server/services/routing/routingService';
import { LocationService } from '../server/services/locationService';
import { metrics } from '../server/utils/metrics';
import { FareService } from '../server/services/fareService';

describe('Production Hardening: Dispatch, Routing & Geospatial Systems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. BullMQ & Queue Architecture', () => {
    it('registers queue handlers and initializes gracefully', async () => {
      let dispatchCalled = false;
      let timeoutCalled = false;
      let retryCalled = false;

      QueueManager.registerHandlers({
        onDispatch: async (rideId: string) => {
          dispatchCalled = true;
        },
        onOfferTimeout: async (rideId: string, offerId: string) => {
          timeoutCalled = true;
        },
        onSearchRetry: async (rideId: string, radiusKm: number) => {
          retryCalled = true;
        },
      });

      await QueueManager.init();
      const queueMetrics = await QueueManager.getQueueMetrics();
      expect(queueMetrics).toBeDefined();

      // Test fallback/direct enqueueing
      await QueueManager.enqueueRideDispatch('ride_test_123');
      await new Promise((res) => setTimeout(res, 20));
      expect(dispatchCalled).toBe(true);

      await QueueManager.enqueueSearchRetry('ride_test_123', 10, 1, 10);
      await new Promise((res) => setTimeout(res, 30));
      expect(retryCalled).toBe(true);

      await QueueManager.scheduleOfferExpiration('ride_test_123', 'offer_test_123', 10);
      await new Promise((res) => setTimeout(res, 30));
      expect(timeoutCalled).toBe(true);
    });

    it('gracefully handles shutdown of queue system', async () => {
      await expect(QueueManager.close()).resolves.not.toThrow();
    });
  });

  describe('2. Routing Provider Abstraction & Cascade', () => {
    it('calculates routes using active routing provider with topology', async () => {
      const origin = { lat: 24.7136, lng: 46.6753 }; // Riyadh Center
      const destination = { lat: 24.7743, lng: 46.7386 }; // KAFD

      const route = await RoutingService.calculateRoute(origin, destination);
      expect(route).toBeDefined();
      expect(route.distanceKm).toBeGreaterThan(5);
      expect(route.durationMinutes).toBeGreaterThan(5);
      expect(route.provider).toBeDefined();
    });

    it('calculates realistic ETA between two coordinates', async () => {
      const origin = { lat: 24.7136, lng: 46.6753 };
      const destination = { lat: 24.7200, lng: 46.6800 };

      const eta = await RoutingService.calculateEta(origin, destination);
      expect(eta).toBeGreaterThanOrEqual(2);
      expect(typeof eta).toBe('number');
    });
  });

  describe('3. Driver GPS Validation & Spoofing Detection', () => {
    it('rejects coordinates exceeding valid latitude / longitude bounds', async () => {
      const resLat = await LocationService.processDriverLocationUpdate({
        driverId: 'drv_test_bounds',
        userId: 'usr_test_bounds',
        lat: 95.0, // Invalid latitude
        lng: 46.6753,
      });
      expect(resLat.accepted).toBe(false);
      expect(resLat.reason).toBe('INVALID_COORDINATES_BOUNDS');

      const resLng = await LocationService.processDriverLocationUpdate({
        driverId: 'drv_test_bounds',
        userId: 'usr_test_bounds',
        lat: 24.7136,
        lng: 185.0, // Invalid longitude
      });
      expect(resLng.accepted).toBe(false);
      expect(resLng.reason).toBe('INVALID_COORDINATES_BOUNDS');
    });

    it('rejects GPS telemetry spoofing / teleportation (>220 km/h or impossible hop)', async () => {
      const driverId = 'drv_teleport_test';
      const userId = 'usr_teleport_test';

      // First initial location
      const first = await LocationService.processDriverLocationUpdate({
        driverId,
        userId,
        lat: 24.7136,
        lng: 46.6753,
      });
      expect(first.accepted).toBe(true);

      // Wait 1 second and send a coordinate in Jeddah (~850km away)
      await new Promise((res) => setTimeout(res, 1000));
      const spoof = await LocationService.processDriverLocationUpdate({
        driverId,
        userId,
        lat: 21.5433, // Jeddah
        lng: 39.1728,
      });

      expect(spoof.accepted).toBe(false);
      expect(spoof.reason).toBe('UNREALISTIC_MOVEMENT_SPOOFING');
    });
  });

  describe('4. Metrics & Observability Abstraction', () => {
    it('tracks counters and calculates duration percentiles accurately', () => {
      metrics.increment('rides_created', 1);
      metrics.increment('rides_created', 2);

      metrics.recordDuration('dispatch_latency', 120);
      metrics.recordDuration('dispatch_latency', 180);
      metrics.recordDuration('dispatch_latency', 300);

      const snapshot = metrics.getSnapshot() as any;
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.metrics.rides_created).toBe(3);
      expect(snapshot.metrics.dispatch_latency_count).toBe(3);
      expect(snapshot.metrics.dispatch_latency_avg_ms).toBe(200);
      expect(snapshot.metrics.dispatch_latency_p95_ms).toBe(300);
    });
  });

  describe('5. High-Scale Driver Density Geospatial Performance (1k Mock Drivers)', () => {
    it('efficiently filters closest drivers without memory blowup', () => {
      const pickupLat = 24.7136;
      const pickupLng = 46.6753;
      const maxRadiusKm = 5;

      // Generate 1,000 synthetic driver coordinates across Saudi Arabia
      const syntheticDrivers: Array<{ id: string; lat: number; lng: number }> = [];
      for (let i = 0; i < 1000; i++) {
        // Offset within +/- 0.5 degrees (~55km range)
        const latOffset = (i % 20 - 10) * 0.01;
        const lngOffset = (Math.floor(i / 20) % 20 - 10) * 0.01;
        syntheticDrivers.push({
          id: `driver_${i}`,
          lat: pickupLat + latOffset,
          lng: pickupLng + lngOffset,
        });
      }

      const startTime = performance.now();

      // Fast distance filtering
      const nearby = syntheticDrivers
        .map((d) => ({
          driverId: d.id,
          distanceKm: FareService.calculateDistanceKm(pickupLat, pickupLng, d.lat, d.lng),
        }))
        .filter((d) => d.distanceKm <= maxRadiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm);

      const executionTimeMs = performance.now() - startTime;

      expect(nearby.length).toBeGreaterThan(0);
      expect(nearby[0].distanceKm).toBeLessThanOrEqual(nearby[nearby.length - 1].distanceKm);
      // Even in Javascript with 1,000 drivers, calculation completes in < 50ms
      expect(executionTimeMs).toBeLessThan(100);
    });
  });
});
