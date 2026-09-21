import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../server/db/store';
import { IRide } from '../server/types';

describe('Ride State Machine & Concurrency Tests', () => {
  beforeEach(() => {
    db.clearAll();
  });

  it('enforces atomic transition along the valid ride lifecycle', async () => {
    const ride: IRide = {
      id: 'ride_test_1',
      riderId: 'rider_1',
      status: 'REQUESTED',
      vehicleCategory: 'STANDARD',
      pickup: { lat: 24.71, lng: 46.67, address: 'Origin' },
      destination: { lat: 24.75, lng: 46.65, address: 'Destination' },
      estimatedFare: 25,
      distanceKm: 5,
      durationMinutes: 10,
      paymentMethod: 'WALLET',
      paymentStatus: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.createRide(ride);

    // Transition 1: REQUESTED -> DRIVER_ASSIGNED
    const t1 = await db.atomicTransitionRide('ride_test_1', 'DRIVER_ASSIGNED', ['REQUESTED', 'SEARCHING_DRIVER']);
    expect(t1.success).toBe(true);
    expect(t1.ride?.status).toBe('DRIVER_ASSIGNED');

    // Transition 2: DRIVER_ASSIGNED -> DRIVER_ARRIVING
    const t2 = await db.atomicTransitionRide('ride_test_1', 'DRIVER_ARRIVING', ['DRIVER_ASSIGNED']);
    expect(t2.success).toBe(true);
    expect(t2.ride?.status).toBe('DRIVER_ARRIVING');

    // Transition 3: DRIVER_ARRIVING -> DRIVER_ARRIVED
    const t3 = await db.atomicTransitionRide('ride_test_1', 'DRIVER_ARRIVED', ['DRIVER_ARRIVING']);
    expect(t3.success).toBe(true);
    expect(t3.ride?.status).toBe('DRIVER_ARRIVED');

    // Transition 4: DRIVER_ARRIVED -> RIDE_STARTED
    const t4 = await db.atomicTransitionRide('ride_test_1', 'RIDE_STARTED', ['DRIVER_ARRIVED']);
    expect(t4.success).toBe(true);
    expect(t4.ride?.status).toBe('RIDE_STARTED');

    // Transition 5: RIDE_STARTED -> RIDE_COMPLETED
    const t5 = await db.atomicTransitionRide('ride_test_1', 'RIDE_COMPLETED', ['RIDE_STARTED']);
    expect(t5.success).toBe(true);
    expect(t5.ride?.status).toBe('RIDE_COMPLETED');
  });

  it('rejects illegal transitions (e.g. COMPLETED -> REQUESTED or CANCELLED -> RIDE_STARTED)', async () => {
    const ride: IRide = {
      id: 'ride_test_illegal',
      riderId: 'rider_1',
      status: 'RIDE_COMPLETED',
      vehicleCategory: 'STANDARD',
      pickup: { lat: 24.71, lng: 46.67, address: 'Origin' },
      destination: { lat: 24.75, lng: 46.65, address: 'Destination' },
      estimatedFare: 25,
      distanceKm: 5,
      durationMinutes: 10,
      paymentMethod: 'WALLET',
      paymentStatus: 'SUCCEEDED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.createRide(ride);

    // Attempt illegal transition COMPLETED -> REQUESTED
    const result = await db.atomicTransitionRide('ride_test_illegal', 'REQUESTED', ['SEARCHING_DRIVER']);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot transition ride');
  });

  it('concurrency test: ensures only ONE driver can accept a ride when multiple attempt simultaneously', async () => {
    const ride: IRide = {
      id: 'ride_race_condition',
      riderId: 'rider_1',
      status: 'SEARCHING_DRIVER',
      vehicleCategory: 'VIP',
      pickup: { lat: 24.71, lng: 46.67, address: 'Origin' },
      destination: { lat: 24.75, lng: 46.65, address: 'Destination' },
      estimatedFare: 40,
      distanceKm: 8,
      durationMinutes: 15,
      paymentMethod: 'WALLET',
      paymentStatus: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.createRide(ride);

    // Simultaneous acceptance attempts by Driver A and Driver B
    const driverA = 'drv_alpha';
    const driverB = 'drv_beta';

    const [attemptA, attemptB] = await Promise.all([
      db.atomicAcceptRide('ride_race_condition', driverA),
      db.atomicAcceptRide('ride_race_condition', driverB),
    ]);

    // Exactly one driver must succeed, and one must fail
    const successes = [attemptA.success, attemptB.success].filter(Boolean);
    const failures = [attemptA.success, attemptB.success].filter((s) => !s);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const updatedRide = await db.findRideById('ride_race_condition');
    expect(updatedRide?.status).toBe('DRIVER_ASSIGNED');
    expect(updatedRide?.driverId).toBe(attemptA.success ? driverA : driverB);
  });
});
