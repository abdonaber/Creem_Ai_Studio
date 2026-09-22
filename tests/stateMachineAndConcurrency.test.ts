import { describe, it, expect, beforeEach } from 'vitest';
import { db, setDatabaseStore } from '../server/db/store';
import { IRide } from '../server/types';
import { TestDatabaseStore } from './testStore';

describe('Ride State Machine & Concurrency Tests', () => {
  let testStore: TestDatabaseStore;

  beforeEach(() => {
    testStore = new TestDatabaseStore();
    setDatabaseStore(testStore);
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

    const illegal = await db.atomicTransitionRide('ride_test_illegal', 'REQUESTED', ['REQUESTED', 'SEARCHING_DRIVER']);
    expect(illegal.success).toBe(false);
  });

  it('handles race condition when two captains claim the same ride', async () => {
    const ride: IRide = {
      id: 'ride_race_test',
      riderId: 'rider_test',
      status: 'REQUESTED',
      vehicleCategory: 'STANDARD',
      pickup: { lat: 24.71, lng: 46.67, address: 'Origin' },
      destination: { lat: 24.75, lng: 46.65, address: 'Destination' },
      estimatedFare: 30,
      distanceKm: 8,
      durationMinutes: 15,
      paymentMethod: 'WALLET',
      paymentStatus: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.createRide(ride);

    // Two simultaneous accept calls
    const [claimA, claimB] = await Promise.all([
      db.atomicAcceptRide('ride_race_test', 'driver_captain_A'),
      db.atomicAcceptRide('ride_race_test', 'driver_captain_B'),
    ]);

    // Exactly one must succeed
    const successes = [claimA.success, claimB.success].filter(Boolean);
    expect(successes.length).toBe(1);

    const finalRide = await db.findRideById('ride_race_test');
    expect(finalRide?.status).toBe('DRIVER_ASSIGNED');
    expect(['driver_captain_A', 'driver_captain_B']).toContain(finalRide?.driverId);
  });
});
