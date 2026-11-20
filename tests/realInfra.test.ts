import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoDatabaseStore } from '../server/db/store';
import { acquireLock, releaseLock, closeRedis } from '../server/redis/redisClient';
import { QueueManager } from '../server/queue/queueManager';
import { generateId } from '../server/utils/id';

const runRealInfra = process.env.RUN_REAL_INFRA_TESTS === 'true';

describe.skipIf(!runRealInfra)('Real Infrastructure Integration Tests (MongoDB RS + Redis)', () => {
  let mongoStore: MongoDatabaseStore;

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/creem_ci?replicaSet=rs0';
    await mongoose.connect(uri);
    mongoStore = new MongoDatabaseStore();
  });

  afterAll(async () => {
    await QueueManager.close();
    await closeRedis();
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  });

  it('acquires and releases real Redis distributed locks safely', async () => {
    const lockKey = `ci_test_lock:${generateId('lk')}`;
    const lock1 = await acquireLock(lockKey, 5000);
    expect(lock1.acquired).toBe(true);

    const lock2 = await acquireLock(lockKey, 5000);
    expect(lock2.acquired).toBe(false);

    await releaseLock(lockKey, lock1.token);

    const lock3 = await acquireLock(lockKey, 5000);
    expect(lock3.acquired).toBe(true);
    await releaseLock(lockKey, lock3.token);
  });

  it('initializes QueueManager against real Redis and reports ready', async () => {
    await QueueManager.init();
    expect(QueueManager.isReady()).toBe(true);
    const metrics = await QueueManager.getQueueMetrics();
    expect(metrics.status).toBe('active');
  });

  it('executes MongoDB multi-document replica-set transaction for ride payment and verifies reconciliation', async () => {
    const rider = await mongoStore.createUser({
      name: 'CI Rider',
      email: `ci_rider_${Date.now()}@creem.app`,
      role: 'RIDER',
      status: 'ACTIVE',
    });
    const driverUser = await mongoStore.createUser({
      name: 'CI Driver',
      email: `ci_driver_${Date.now()}@creem.app`,
      role: 'DRIVER',
      status: 'ACTIVE',
    });
    const driver = await mongoStore.createDriver({
      userId: driverUser.id,
      approvalStatus: 'APPROVED',
      isOnline: true,
    });

    await mongoStore.creditWallet(rider.id, 150, 'CI_SEED', 'ci_seed_ref', `ci_topup_${Date.now()}`);

    const ride = await mongoStore.createRide({
      riderId: rider.id,
      driverId: driver.id,
      status: 'RIDE_COMPLETED',
      vehicleCategory: 'STANDARD',
      pickup: { lat: 24.7136, lng: 46.6753, address: 'Pickup' },
      destination: { lat: 24.7743, lng: 46.7386, address: 'Destination' },
      estimatedFare: 100,
      finalFare: 100,
      distanceKm: 10,
      durationMinutes: 15,
      paymentMethod: 'WALLET',
      paymentStatus: 'PENDING',
    });

    const settle = await mongoStore.settleRidePaymentWallet({
      rideId: ride.id,
      riderId: rider.id,
      driverId: driver.id,
      amount: 100,
      idempotencyKey: `ci_settle_${ride.id}`,
    });

    expect(settle.success).toBe(true);

    const riderWallet = await mongoStore.getOrCreateWallet(rider.id);
    const driverWallet = await mongoStore.getOrCreateWallet(driverUser.id);
    expect(riderWallet.balance).toBe(50);
    expect(driverWallet.balance).toBe(80);

    const recon = await mongoStore.reconcileFinancialIntegrity();
    expect(recon.healthy).toBe(true);
    expect(recon.discrepanciesCount).toBe(0);
  });
});
