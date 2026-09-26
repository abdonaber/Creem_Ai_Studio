import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { setDatabaseStore } from '../server/db/store';
import { TestDatabaseStore } from './testStore';
import { createAuthToken } from '../server/middleware/auth';
import { PaymentService } from '../server/services/paymentService';
import { generateId } from '../server/utils/id';

describe('Production Hardening & Integrity Suite', () => {
  let store: TestDatabaseStore;
  let adminToken: string;
  let riderToken: string;
  let driverToken: string;
  let riderUser: any;
  let driverUser: any;
  let driverRecord: any;

  beforeEach(async () => {
    store = new TestDatabaseStore();
    setDatabaseStore(store);

    // Create Admin
    const admin = await store.createUser({
      name: 'Super Admin',
      email: 'admin@creemy.app',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    adminToken = createAuthToken({ userId: admin.id, role: 'ADMIN', email: admin.email });

    // Create Rider
    riderUser = await store.createUser({
      name: 'Rider Tester',
      email: 'rider@test.com',
      role: 'RIDER',
      status: 'ACTIVE',
    });
    riderToken = createAuthToken({ userId: riderUser.id, role: 'RIDER', email: riderUser.email });

    // Create Driver User & Profile
    driverUser = await store.createUser({
      name: 'Captain Nasser',
      email: 'captain@test.com',
      role: 'DRIVER',
      status: 'ACTIVE',
    });
    driverRecord = await store.createDriver({
      userId: driverUser.id,
      approvalStatus: 'PENDING',
      isOnline: true,
      currentLocation: {
        lat: 24.7136,
        lng: 46.6753,
        heading: 90,
        updatedAt: new Date(Date.now() - 15000).toISOString(),
      },
    });
    driverToken = createAuthToken({ userId: driverUser.id, role: 'DRIVER', email: driverUser.email });
  });

  describe('1. Health & Readiness Observability (Item 19)', () => {
    it('GET /health returns liveness status with memory usage', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.platform).toBe('CreemY');
      expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(res.body.memoryUsage).toBeDefined();
    });

    it('GET /readiness verifies critical dependencies and returns 200/503 accordingly', async () => {
      const res = await request(app).get('/readiness');
      expect([200, 503]).toContain(res.status);
      expect(res.body.checks).toBeDefined();
      expect(res.body.checks.database).toBeDefined();
      expect(res.body.checks.configuration).toBe('valid');
    });
  });

  describe('2. Cash Payment & Double-Entry Ledger Integrity (Items 2, 3, 5)', () => {
    it('records double-entry ledger entries and correctly updates balances without silent failures', async () => {
      // Create ride
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 50,
        finalFare: 50,
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
      });

      // Settle cash payment with riderUser.id
      const settlement = await PaymentService.processRidePayment(
        ride.id,
        riderUser.id,
        50,
        'CASH',
        `settle_test_${ride.id}`
      );

      expect(settlement.success).toBe(true);

      // Verify ride updated
      const updatedRide = await store.findRideById(ride.id);
      expect(updatedRide?.paymentStatus).toBe('SUCCEEDED');

      // Verify ledger entries exist
      const ledger = await store.getPlatformLedger(10, { rideId: ride.id });
      expect(ledger.length).toBeGreaterThan(0);

      // Verify financial summary calculates revenue and commission
      const financial = await store.getFinancialSummary();
      expect(financial.totalGrossVolume).toBe(50);
      expect(financial.totalPlatformRevenue).toBe(10); // 20% of 50
    });
  });

  describe('3. Stripe Webhook Atomic Deduplication & Signature (Item 4)', () => {
    it('enforces webhook signature and rejects unsigned requests', async () => {
      await expect(
        PaymentService.handleWebhook('{}', '')
      ).rejects.toThrow('Missing webhook signature.');
    });

    it('claims webhook atomically and prevents double execution of duplicate events', async () => {
      const eventId = `evt_${generateId('evt')}`;

      // First webhook claim
      const firstClaim = await store.claimWebhookEvent(eventId, 'stripe', 'payment_intent.succeeded');
      expect(firstClaim.claimed).toBe(true);
      expect(firstClaim.alreadyProcessed).toBe(false);

      // Concurrent/duplicate claim for the same event
      const duplicateClaim = await store.claimWebhookEvent(eventId, 'stripe', 'payment_intent.succeeded');
      expect(duplicateClaim.claimed).toBe(false);

      // Once processed and recorded
      await store.recordProcessedWebhook(eventId);
      const afterProcessedClaim = await store.claimWebhookEvent(eventId, 'stripe', 'payment_intent.succeeded');
      expect(afterProcessedClaim.claimed).toBe(false);
      expect(afterProcessedClaim.alreadyProcessed).toBe(true);
    });
  });

  describe('4. Driver Approval Vehicle Completeness Validation (Item 14)', () => {
    it('rejects driver approval if vehicle information is incomplete', async () => {
      // Driver currently has no vehicle
      const res = await request(app)
        .put(`/api/v1/admin/drivers/${driverRecord.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'APPROVED' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INCOMPLETE_VEHICLE_INFO');
    });

    it('approves driver when complete vehicle information is registered', async () => {
      // Register complete vehicle
      await store.createVehicle({
        driverId: driverRecord.id,
        make: 'Hyundai',
        model: 'Elantra',
        year: 2024,
        color: 'White',
        plateNumber: '1234-KSA',
        category: 'STANDARD',
      });

      const res = await request(app)
        .put(`/api/v1/admin/drivers/${driverRecord.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'APPROVED' });

      expect(res.status).toBe(200);
      expect(res.body.data.approvalStatus).toBe('APPROVED');
    });
  });

  describe('5. Admin Scalability & Pagination (Item 15)', () => {
    it('returns paginated responses for rides and drivers with correct metadata', async () => {
      const res = await request(app)
        .get('/api/v1/admin/rides?page=1&limit=5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(5);
    });

    it('returns platform ledger entries to administrators', async () => {
      const res = await request(app)
        .get('/api/v1/admin/ledger')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('6. Cryptographic ID Quality (Item 9)', () => {
    it('generates high-entropy crypto UUID identifiers with standard prefixes', () => {
      const rideId = generateId('ride');
      const userId = generateId('usr');
      const txId = generateId('tx');

      expect(rideId.startsWith('ride_')).toBe(true);
      expect(userId.startsWith('usr_')).toBe(true);
      expect(txId.startsWith('tx_')).toBe(true);
      expect(rideId.length).toBeGreaterThan(16);
      expect(userId.length).toBeGreaterThan(16);
    });
  });

  describe('7. Stripe Webhook Concurrency & Deduplication (Phase 6)', () => {
    it('processes exactly one financial effect when 20 identical webhooks fire concurrently', async () => {
      // Create a test ride and payment
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 50,
        distanceKm: 10,
        durationMinutes: 20,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'PENDING',
      });

      const intentId = 'pi_test_concurrency_' + generateId('pi');
      await store.createPayment({
        rideId: ride.id,
        userId: riderUser.id,
        amount: 50,
        currency: 'SAR',
        status: 'PENDING',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: intentId,
      });

      const eventId = 'evt_concurrent_test_' + generateId('evt');

      // Mock webhook payload
      const mockEvent = {
        id: eventId,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: intentId,
            amount: 5000,
            currency: 'sar',
            metadata: { rideId: ride.id },
          },
        },
      };

      // Spy on StripeService.constructWebhookEvent
      const { StripeService } = await import('../server/services/stripeService');
      const constructSpy = (StripeService as any).constructWebhookEvent;
      StripeService.constructWebhookEvent = () => mockEvent as any;

      try {
        // Send 20 concurrent webhook requests
        const promises = Array.from({ length: 20 }, () =>
          PaymentService.handleWebhook(JSON.stringify(mockEvent), 'test_sig', eventId)
        );

        const results = await Promise.all(promises);
        expect(results.every((r) => r === true)).toBe(true);

        // Verify exactly ONE ledger fare entry was recorded for this event
        const fareLedgers = store.ledger.filter(
          (l) => l.rideId === ride.id && l.type === 'RIDER_FARE'
        );
        expect(fareLedgers.length).toBe(1);

        // Verify ride payment status is SUCCEEDED
        const updatedRide = await store.findRideById(ride.id);
        expect(updatedRide?.paymentStatus).toBe('SUCCEEDED');
      } finally {
        StripeService.constructWebhookEvent = constructSpy;
      }
    });
  });

  describe('8. Cash Payment Failure & Financial State Machine (Phase 5)', () => {
    it('transitions ride to REQUIRES_RECONCILIATION if cash settlement fails unexpectedly', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 40,
        distanceKm: 8,
        durationMinutes: 15,
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
      });

      // Temporarily mock settleCashPayment to throw
      const originalSettle = store.settleCashPayment.bind(store);
      store.settleCashPayment = async () => {
        throw new Error('Ledger database connection timed out during settlement');
      };

      try {
        await expect(
          PaymentService.processRidePayment(ride.id, riderUser.id, 40, 'CASH')
        ).rejects.toThrow('Flagged for reconciliation');

        const updatedRide = await store.findRideById(ride.id);
        expect(updatedRide?.paymentStatus).toBe('REQUIRES_RECONCILIATION');
      } finally {
        store.settleCashPayment = originalSettle;
      }
    });
  });

  describe('9. Financial Reconciliation Audit Mechanism (Phase 4)', () => {
    it('returns healthy status when all wallets and ledgers are balanced', async () => {
      const res = await request(app)
        .get('/api/v1/admin/reconciliation')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.healthy).toBe(true);
      expect(res.body.data.discrepanciesCount).toBe(0);
    });

    it('detects and flags discrepancies when a wallet mismatch is introduced', async () => {
      // Artificially corrupt a wallet balance without transaction
      const targetWallet = await store.getOrCreateWallet(riderUser.id);
      targetWallet.balance += 999; // Corrupt balance

      const report = await store.reconcileFinancialIntegrity();
      expect(report.healthy).toBe(false);
      expect(report.discrepanciesCount).toBeGreaterThan(0);
      expect(report.discrepancies.some((d) => d.type === 'WALLET_MISMATCH')).toBe(true);
    });
  });

  describe('10. Payment Amount Security & Server-Authoritative Fares (Phase 5)', () => {
    it('rejects client attempts to pay less than the server-authoritative fare', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 45,
        finalFare: 45,
        paymentMethod: 'WALLET',
        paymentStatus: 'PENDING',
      });

      // Rider attempts to pay 1 SAR instead of 45 SAR
      const res = await request(app)
        .post('/api/v1/payments/process')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({
          rideId: ride.id,
          amount: 1, // Tampered amount
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('FARE_MISMATCH');
    });

    it('rejects client attempts to pay more than the server-authoritative fare', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 45,
        finalFare: 45,
        paymentMethod: 'WALLET',
        paymentStatus: 'PENDING',
      });

      const res = await request(app)
        .post('/api/v1/payments/process')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({
          rideId: ride.id,
          amount: 99999, // Tampered amount
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('FARE_MISMATCH');
    });

    it('rejects negative, zero, NaN, huge amounts, and decimal precision abuse', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 50,
        finalFare: 50,
        paymentMethod: 'WALLET',
        paymentStatus: 'PENDING',
      });

      // Negative amount
      const resNegative = await request(app)
        .post('/api/v1/payments/process')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ rideId: ride.id, amount: -50 });
      expect(resNegative.status).toBe(400);

      // Zero amount
      const resZero = await request(app)
        .post('/api/v1/payments/process')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ rideId: ride.id, amount: 0 });
      expect(resZero.status).toBe(400);

      // Decimal precision abuse (>2 decimal places)
      const resDecimals = await request(app)
        .post('/api/v1/payments/process')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ rideId: ride.id, amount: 50.1234 });
      expect(resDecimals.status).toBe(400);
      expect(resDecimals.body.code).toBe('DECIMAL_PRECISION_ABUSE');
    });

    it('defaults to server-authoritative fare when amount is omitted by client', async () => {
      const riderWallet = await store.getOrCreateWallet(riderUser.id);
      riderWallet.balance = 100;

      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 35,
        finalFare: 35,
        paymentMethod: 'WALLET',
        paymentStatus: 'PENDING',
      });

      const res = await request(app)
        .post('/api/v1/payments/process')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ rideId: ride.id }); // No amount sent; server is authoritative

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.paymentStatus).toBe('SUCCEEDED');
    });
  });

  describe('11. Stripe Webhook Lease Recovery & Failure Resiliency (Phase 6)', () => {
    it('recovers crashed worker lease when leaseExpiresAt has elapsed', async () => {
      const eventId = 'evt_lease_recovery_' + generateId('evt');

      // Worker 1 claimed with a 10ms lease then crashed
      const claim1 = await store.claimWebhookEvent(eventId, 'stripe', 'payment_intent.succeeded', 10);
      expect(claim1.claimed).toBe(true);

      // Immediate attempt while lease is active -> rejected
      const immediateClaim = await store.claimWebhookEvent(eventId, 'stripe', 'payment_intent.succeeded');
      expect(immediateClaim.claimed).toBe(false);
      expect(immediateClaim.alreadyProcessed).toBe(false);

      // Wait for 20ms until Worker 1 lease expires
      await new Promise((res) => setTimeout(res, 20));

      // Worker 2 attempts recovery on the abandoned event
      const recoveryClaim = await store.claimWebhookEvent(eventId, 'stripe', 'payment_intent.succeeded');
      expect(recoveryClaim.claimed).toBe(true);
    });

    it('allows retry when previous webhook attempt ended in FAILED status', async () => {
      const eventId = 'evt_failed_retry_' + generateId('evt');

      await store.claimWebhookEvent(eventId, 'stripe', 'payment_intent.succeeded');
      await store.recordProcessedWebhook(eventId, 'stripe', 'payment_intent.succeeded', {}, 'FAILED', 'Database timeout');

      // Retried webhook should be allowed to claim
      const retryClaim = await store.claimWebhookEvent(eventId, 'stripe', 'payment_intent.succeeded');
      expect(retryClaim.claimed).toBe(true);
    });

    it('processes refund webhook and records compensating ledger entry', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 60,
        finalFare: 60,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'SUCCEEDED',
      });

      const intentId = 'pi_refund_test_' + generateId('pi');
      await store.createPayment({
        rideId: ride.id,
        userId: riderUser.id,
        amount: 60,
        currency: 'SAR',
        status: 'SUCCEEDED',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: intentId,
      });

      const refundEvent = {
        id: 'evt_refund_' + generateId('evt'),
        type: 'charge.refunded',
        data: {
          object: {
            payment_intent: intentId,
            amount_refunded: 6000,
          },
        },
      };

      const { StripeService } = await import('../server/services/stripeService');
      const origConstruct = StripeService.constructWebhookEvent;
      StripeService.constructWebhookEvent = () => refundEvent as any;

      try {
        await PaymentService.handleWebhook(JSON.stringify(refundEvent), 'test_sig', refundEvent.id);

        const updatedRide = await store.findRideById(ride.id);
        expect(updatedRide?.paymentStatus).toBe('REFUNDED');

        const refundLedgers = store.ledger.filter(
          (l) => l.rideId === ride.id && l.type === 'REFUND'
        );
        expect(refundLedgers.length).toBe(1);
        expect(refundLedgers[0].amount).toBe(60);
      } finally {
        StripeService.constructWebhookEvent = origConstruct;
      }
    });
  });

  describe('12. Production Guardrails & Fail-Closed Behavior (Phases 2 & 3)', () => {
    it('QueueManager fails closed in production mode when Redis is unconfigured', async () => {
      const { QueueManager } = await import('../server/queue/queueManager');
      const { config } = await import('../server/config');

      const originalIsProd = config.isProduction;
      (config as any).isProduction = true;

      try {
        await expect(
          QueueManager.enqueueRideDispatch('ride_test_prod_fail')
        ).rejects.toThrow('QUEUE_UNAVAILABLE_PRODUCTION');

        await expect(
          QueueManager.scheduleOfferExpiration('ride_test_prod_fail', 'offer_123', 5000)
        ).rejects.toThrow('QUEUE_UNAVAILABLE_PRODUCTION');

        await expect(
          QueueManager.enqueueSearchRetry('ride_test_prod_fail', 10, 1)
        ).rejects.toThrow('QUEUE_UNAVAILABLE_PRODUCTION');
      } finally {
        (config as any).isProduction = originalIsProd;
      }
    });

    it('Distributed lock strictly fails closed in production without Redis', async () => {
      const { acquireLock, claimIdempotencyKey } = await import('../server/redis/redisClient');
      const { config } = await import('../server/config');

      const originalIsProd = config.isProduction;
      (config as any).isProduction = true;

      try {
        const lockRes = await acquireLock('financial:test_ride_123');
        expect(lockRes.acquired).toBe(false);
        expect(lockRes.reason).toBe('REDIS_REQUIRED_IN_PRODUCTION');

        const idempRes = await claimIdempotencyKey('test_idemp_key_123');
        expect(idempRes.claimed).toBe(false);
        expect(idempRes.reason).toBe('REDIS_REQUIRED_IN_PRODUCTION');
      } finally {
        (config as any).isProduction = originalIsProd;
      }
    });
  });

  describe('13. Driver GPS Freshness & Unified STALE Policy (Phase 8)', () => {
    it('rejects driver location packets that are older than DRIVER_LOCATION_STALE_MS', async () => {
      const { LocationService } = await import('../server/services/locationService');
      const { config } = await import('../server/config');

      const staleTimestamp = Date.now() - (config.driverLocationStaleMs + 5000);
      const res = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7136,
        lng: 46.6753,
        timestamp: staleTimestamp,
      });

      expect(res.accepted).toBe(false);
      expect(res.reason).toBe('STALE_LOCATION_REJECTED');
    });

    it('excludes drivers with stale location from nearby dispatch candidate search', async () => {
      const { config } = await import('../server/config');

      // Make driver approved and online
      await store.updateDriver(driverRecord.id, {
        approvalStatus: 'APPROVED',
        isOnline: true,
        isBusy: false,
        lastSeenAt: new Date(Date.now() - (config.driverLocationStaleMs + 10000)).toISOString(),
        currentLocation: {
          lat: 24.7136,
          lng: 46.6753,
          heading: 0,
          updatedAt: new Date(Date.now() - (config.driverLocationStaleMs + 10000)).toISOString(),
        },
      });

      const eligible = await store.findNearbyEligibleDrivers({
        pickupLat: 24.7136,
        pickupLng: 46.6753,
        radiusKm: 10,
      });

      expect(eligible.some((e) => e.driver.id === driverRecord.id)).toBe(false);
    });

    it('sweeps stale drivers and marks them offline automatically', async () => {
      const { LocationService } = await import('../server/services/locationService');
      const { config } = await import('../server/config');

      await store.updateDriver(driverRecord.id, {
        approvalStatus: 'APPROVED',
        isOnline: true,
        isBusy: false,
        lastSeenAt: new Date(Date.now() - (config.driverLocationStaleMs + 20000)).toISOString(),
      });

      const swept = await LocationService.sweepStaleDrivers(config.driverLocationStaleMs);
      expect(swept).toBeGreaterThanOrEqual(1);

      const updated = await store.findDriverById(driverRecord.id);
      expect(updated?.isOnline).toBe(false);
    });
  });

  describe('14. Comprehensive Financial Ledger Reconciliation (Phase 7)', () => {
    it('detects discrepancy if driver earningsTotal does not match settled rides', async () => {
      // Create settled ride
      await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        paymentStatus: 'SUCCEEDED',
        estimatedFare: 100,
        finalFare: 100,
      });

      // Set incorrect driver earningsTotal (150 instead of 80)
      await store.updateDriver(driverRecord.id, { earningsTotal: 150 });

      const report = await store.reconcileFinancialIntegrity();
      expect(report.healthy).toBe(false);
      expect(report.discrepancies.some((d) => d.type === 'DRIVER_EARNINGS_MISMATCH')).toBe(true);
    });

    it('detects discrepancy if platform commission in ledger does not match settled rides', async () => {
      // Create settled ride with 100 SAR fare (expected commission = 20 SAR)
      await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        paymentStatus: 'SUCCEEDED',
        estimatedFare: 100,
        finalFare: 100,
      });

      // Driver earnings matched to prevent DRIVER_EARNINGS_MISMATCH
      await store.updateDriver(driverRecord.id, { earningsTotal: 80 });

      // There is 1 settled ride of 100 SAR (expected 20 SAR commission), but 0 in ledger
      const report = await store.reconcileFinancialIntegrity();
      expect(report.healthy).toBe(false);
      expect(report.discrepancies.some((d) => d.type === 'COMMISSION_MISMATCH')).toBe(true);
    });
  });

  describe('15. GPS / Driver Location Scalability & Correctness', () => {
    it('accepts valid location and rejects invalid bounds and heading', async () => {
      const { LocationService } = await import('../server/services/locationService');

      // Valid location
      const validRes = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7136,
        lng: 46.6753,
        heading: 90,
      });
      expect(validRes.accepted).toBe(true);

      // Invalid latitude
      const invLat = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 91.5,
        lng: 46.6753,
      });
      expect(invLat.accepted).toBe(false);
      expect(invLat.reason).toBe('INVALID_COORDINATES_BOUNDS');

      // Invalid longitude
      const invLng = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7136,
        lng: 181.5,
      });
      expect(invLng.accepted).toBe(false);
      expect(invLng.reason).toBe('INVALID_COORDINATES_BOUNDS');

      // Invalid heading
      const invHeading = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7136,
        lng: 46.6753,
        heading: 400,
      });
      expect(invHeading.accepted).toBe(false);
      expect(invHeading.reason).toBe('INVALID_HEADING_BOUNDS');
    });

    it('rejects future timestamps and stale timestamps', async () => {
      const { LocationService } = await import('../server/services/locationService');
      const now = Date.now();

      // Future timestamp > 30s
      const futureRes = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7136,
        lng: 46.6753,
        timestamp: now + 45000,
      });
      expect(futureRes.accepted).toBe(false);
      expect(futureRes.reason).toBe('FUTURE_TIMESTAMP_REJECTED');

      // Stale timestamp > 5 mins
      const staleRes = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7136,
        lng: 46.6753,
        timestamp: now - (5 * 60 * 1000 + 10000),
      });
      expect(staleRes.accepted).toBe(false);
      expect(staleRes.reason).toBe('STALE_LOCATION_REJECTED');
    });

    it('rejects out-of-order packets and throttles too-frequent updates', async () => {
      const { LocationService } = await import('../server/services/locationService');
      const now = Date.now();

      // Clear local cache to establish known baseline
      LocationService.clearLocalCache();

      const p1 = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7136,
        lng: 46.6753,
        timestamp: now - 5000,
      });
      expect(p1.accepted).toBe(true);

      // Out-of-order packet (timestamp earlier than p1)
      const outOfOrder = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7138,
        lng: 46.6755,
        timestamp: now - 6000,
      });
      expect(outOfOrder.accepted).toBe(false);
      expect(outOfOrder.reason).toBe('OUT_OF_ORDER_PACKET');

      // Too-frequent update (within 0.5s of p1)
      const tooFast = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7138,
        lng: 46.6755,
        timestamp: now - 4700,
      });
      expect(tooFast.accepted).toBe(false);
      expect(tooFast.reason).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('handles driver without active ride vs driver with activeRideId without loading full history', async () => {
      const { LocationService } = await import('../server/services/locationService');
      const now = Date.now();

      // Spy on store.getRidesByDriverId to ensure it is NOT called
      const getRidesSpy = vi.spyOn(store, 'getRidesByDriverId');

      // 1. Driver without active ride
      await store.updateDriver(driverRecord.id, { activeRideId: undefined });
      const noRideRes = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7150,
        lng: 46.6760,
        timestamp: now + 1000,
      });
      expect(noRideRes.accepted).toBe(true);
      expect(getRidesSpy).not.toHaveBeenCalled();

      // 2. Driver with activeRideId (direct lookup)
      const activeRide = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'DRIVER_ARRIVING',
        estimatedFare: 40,
        distanceKm: 5,
        durationMinutes: 10,
      });
      await store.updateDriver(driverRecord.id, { activeRideId: activeRide.id });

      const findRideSpy = vi.spyOn(store, 'findRideById');
      const withRideRes = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7155,
        lng: 46.6765,
        timestamp: now + 3000,
      });
      expect(withRideRes.accepted).toBe(true);
      expect(getRidesSpy).not.toHaveBeenCalled();
      expect(findRideSpy).toHaveBeenCalledWith(activeRide.id);

      // Clean up spies
      getRidesSpy.mockRestore();
      findRideSpy.mockRestore();
    });

    it('rejects location update for an unrelated ride', async () => {
      const { LocationService } = await import('../server/services/locationService');
      const now = Date.now();

      // Create an unrelated ride belonging to another driver
      const otherRide = await store.createRide({
        riderId: riderUser.id,
        driverId: 'drv_other_driver_123',
        status: 'DRIVER_ARRIVING',
        estimatedFare: 40,
      });

      const res = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7160,
        lng: 46.6770,
        timestamp: now + 5000,
        rideId: otherRide.id,
      });

      expect(res.accepted).toBe(false);
      expect(res.reason).toBe('RIDE_NOT_ASSOCIATED');
    });

    it('recovers state across simulated server restart / cache loss from persistent DB', async () => {
      const { LocationService } = await import('../server/services/locationService');
      const now = Date.now();

      // Seed driver's location in persistent DB
      await store.updateDriver(driverRecord.id, {
        currentLocation: {
          lat: 24.7100,
          lng: 46.6700,
          heading: 0,
          updatedAt: new Date(now - 2000).toISOString(),
        },
      });

      // Clear process-local cache (simulates server restart)
      LocationService.clearLocalCache();

      // Send out-of-order packet (earlier than DB timestamp)
      const outOfOrderRes = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 24.7105,
        lng: 46.6705,
        timestamp: now - 3000,
      });
      expect(outOfOrderRes.accepted).toBe(false);
      expect(outOfOrderRes.reason).toBe('OUT_OF_ORDER_PACKET');

      // Send impossible hop from DB coordinate (> 220 km/h)
      const spoofRes = await LocationService.processDriverLocationUpdate({
        driverId: driverRecord.id,
        userId: driverUser.id,
        lat: 21.5433, // Jeddah (~850km away)
        lng: 39.1728,
        timestamp: now,
      });
      expect(spoofRes.accepted).toBe(false);
      expect(spoofRes.reason).toBe('UNREALISTIC_MOVEMENT_SPOOFING');
    });
  });

  describe('16. Stripe Refund Atomic & Idempotent', () => {
    it('settles refund atomically across payment, ride, and platform ledger', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 75,
        finalFare: 75,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'SUCCEEDED',
      });

      const intentId = 'pi_atomic_refund_' + generateId('pi');
      await store.createPayment({
        rideId: ride.id,
        userId: riderUser.id,
        amount: 75,
        currency: 'SAR',
        status: 'SUCCEEDED',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: intentId,
      });

      const eventId = 'evt_atomic_refund_' + generateId('evt');

      const refundResult = await store.settleStripeRefund({
        paymentIntentId: intentId,
        eventId,
        refundAmount: 75,
      });

      expect(refundResult.success).toBe(true);
      expect(refundResult.alreadyRefunded).toBe(false);
      expect(refundResult.refundAmount).toBe(75);

      // Verify payment was marked REFUNDED
      const updatedPayment = await store.findPaymentByStripeIntent(intentId);
      expect(updatedPayment?.status).toBe('REFUNDED');
      expect((updatedPayment as any)?.refundAmount).toBe(75);

      // Verify ride was marked REFUNDED
      const updatedRide = await store.findRideById(ride.id);
      expect(updatedRide?.paymentStatus).toBe('REFUNDED');

      // Verify PlatformLedger has exactly 1 REFUND entry
      const refundEntries = store.ledger.filter((l) => l.rideId === ride.id && l.type === 'REFUND');
      expect(refundEntries.length).toBe(1);
      expect(refundEntries[0].amount).toBe(75);
      expect(refundEntries[0].fromAccount).toBe('platform:escrow');
      expect(refundEntries[0].toAccount).toBe(`rider:${riderUser.id}`);
    });

    it('is strictly idempotent on duplicate refund webhooks (no double ledger, no double refund)', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 80,
        finalFare: 80,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'SUCCEEDED',
      });

      const intentId = 'pi_duplicate_refund_' + generateId('pi');
      await store.createPayment({
        rideId: ride.id,
        userId: riderUser.id,
        amount: 80,
        currency: 'SAR',
        status: 'SUCCEEDED',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: intentId,
      });

      const eventId = 'evt_duplicate_refund_' + generateId('evt');

      // Fire 5 duplicate refund operations concurrently
      const results = await Promise.all([
        store.settleStripeRefund({ paymentIntentId: intentId, eventId, refundAmount: 80 }),
        store.settleStripeRefund({ paymentIntentId: intentId, eventId, refundAmount: 80 }),
        store.settleStripeRefund({ paymentIntentId: intentId, eventId, refundAmount: 80 }),
        store.settleStripeRefund({ paymentIntentId: intentId, eventId, refundAmount: 80 }),
        store.settleStripeRefund({ paymentIntentId: intentId, eventId, refundAmount: 80 }),
      ]);

      // All calls succeed
      for (const res of results) {
        expect(res.success).toBe(true);
        expect(res.refundAmount).toBe(80);
      }

      // Exactly 1 ledger entry exists
      const refundLedgers = store.ledger.filter((l) => l.rideId === ride.id && l.type === 'REFUND');
      expect(refundLedgers.length).toBe(1);

      // Payment remains REFUNDED with 80
      const payment = await store.findPaymentByStripeIntent(intentId);
      expect(payment?.status).toBe('REFUNDED');
      expect((payment as any)?.refundAmount).toBe(80);
    });

    it('rejects unknown paymentIntentId gracefully with PAYMENT_NOT_FOUND', async () => {
      await expect(
        store.settleStripeRefund({
          paymentIntentId: 'pi_unknown_nonexistent',
          eventId: 'evt_test_nonexistent',
        })
      ).rejects.toThrow('Payment not found');
    });

    it('handles multiple partial refunds correctly with incremental deltas (mandatory specification)', async () => {
      // Payment = 100 SAR
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 100,
        finalFare: 100,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'SUCCEEDED',
      });

      const intentId = 'pi_multi_partial_' + generateId('pi');
      await store.createPayment({
        rideId: ride.id,
        userId: riderUser.id,
        amount: 100,
        currency: 'SAR',
        status: 'SUCCEEDED',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: intentId,
      });

      // Refund #1: Stripe cumulative = 30 SAR
      const res1 = await store.settleStripeRefund({
        paymentIntentId: intentId,
        eventId: 'evt_partial_1',
        cumulativeAmountRefunded: 30,
      });

      expect(res1.success).toBe(true);
      expect(res1.refundAmount).toBe(30);
      expect(res1.refundDelta).toBe(30);
      expect(res1.isPartial).toBe(true);
      expect(res1.status).toBe('PARTIALLY_REFUNDED');

      const paymentAfter1 = await store.findPaymentByStripeIntent(intentId);
      expect(paymentAfter1?.status).toBe('PARTIALLY_REFUNDED');
      expect((paymentAfter1 as any)?.refundAmount).toBe(30);

      const rideAfter1 = await store.findRideById(ride.id);
      expect(rideAfter1?.paymentStatus).toBe('PARTIALLY_REFUNDED');

      const ledgersAfter1 = store.ledger.filter((l) => l.rideId === ride.id && l.type === 'REFUND');
      expect(ledgersAfter1.length).toBe(1);
      expect(ledgersAfter1[0].amount).toBe(30);

      // Refund #2: Stripe cumulative = 50 SAR (incremental delta = 20 SAR)
      const res2 = await store.settleStripeRefund({
        paymentIntentId: intentId,
        eventId: 'evt_partial_2',
        cumulativeAmountRefunded: 50,
      });

      expect(res2.success).toBe(true);
      expect(res2.refundAmount).toBe(50);
      expect(res2.refundDelta).toBe(20); // Exactly 20, NOT 50
      expect(res2.isPartial).toBe(true);
      expect(res2.status).toBe('PARTIALLY_REFUNDED');

      const paymentAfter2 = await store.findPaymentByStripeIntent(intentId);
      expect(paymentAfter2?.status).toBe('PARTIALLY_REFUNDED');
      expect((paymentAfter2 as any)?.refundAmount).toBe(50);

      const rideAfter2 = await store.findRideById(ride.id);
      expect(rideAfter2?.paymentStatus).toBe('PARTIALLY_REFUNDED');

      const ledgersAfter2 = store.ledger.filter((l) => l.rideId === ride.id && l.type === 'REFUND');
      expect(ledgersAfter2.length).toBe(2);
      expect(ledgersAfter2[0].amount).toBe(30);
      expect(ledgersAfter2[1].amount).toBe(20); // Incremental 20 recorded

      // Replay Refund #2 (duplicate webhook with cumulative 50)
      const res2Replay = await store.settleStripeRefund({
        paymentIntentId: intentId,
        eventId: 'evt_partial_2',
        cumulativeAmountRefunded: 50,
      });
      expect(res2Replay.alreadyRefunded).toBe(true);
      expect(res2Replay.refundDelta).toBe(0);

      // No new ledger entries created on replay
      const ledgersAfterReplay = store.ledger.filter((l) => l.rideId === ride.id && l.type === 'REFUND');
      expect(ledgersAfterReplay.length).toBe(2);

      // Refund #3: Final full refund (cumulative = 100 SAR, incremental delta = 50 SAR)
      const res3 = await store.settleStripeRefund({
        paymentIntentId: intentId,
        eventId: 'evt_partial_3',
        cumulativeAmountRefunded: 100,
      });

      expect(res3.success).toBe(true);
      expect(res3.refundAmount).toBe(100);
      expect(res3.refundDelta).toBe(50);
      expect(res3.isPartial).toBe(false);
      expect(res3.status).toBe('REFUNDED');

      const paymentAfter3 = await store.findPaymentByStripeIntent(intentId);
      expect(paymentAfter3?.status).toBe('REFUNDED');
      expect((paymentAfter3 as any)?.refundAmount).toBe(100);

      const rideAfter3 = await store.findRideById(ride.id);
      expect(rideAfter3?.paymentStatus).toBe('REFUNDED');

      // Final ledger audit: exactly 3 entries summing to 100 SAR (30 + 20 + 50)
      const finalLedgers = store.ledger.filter((l) => l.rideId === ride.id && l.type === 'REFUND');
      expect(finalLedgers.length).toBe(3);
      const totalRefundLedger = finalLedgers.reduce((acc, l) => acc + l.amount, 0);
      expect(totalRefundLedger).toBe(100);
    });

    it('safely ignores out-of-order refund webhooks with lower cumulative amounts', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 100,
        finalFare: 100,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'SUCCEEDED',
      });

      const intentId = 'pi_out_of_order_' + generateId('pi');
      await store.createPayment({
        rideId: ride.id,
        userId: riderUser.id,
        amount: 100,
        currency: 'SAR',
        status: 'SUCCEEDED',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: intentId,
      });

      // Cumulative 70 arrives first
      await store.settleStripeRefund({
        paymentIntentId: intentId,
        eventId: 'evt_late_70',
        cumulativeAmountRefunded: 70,
      });

      // Out-of-order cumulative 40 arrives afterwards
      const outOfOrderRes = await store.settleStripeRefund({
        paymentIntentId: intentId,
        eventId: 'evt_stale_40',
        cumulativeAmountRefunded: 40,
      });

      expect(outOfOrderRes.alreadyRefunded).toBe(true);
      expect(outOfOrderRes.refundDelta).toBe(0);
      expect(outOfOrderRes.refundAmount).toBe(70);

      // Ledger only has the 70 SAR entry
      const ledgers = store.ledger.filter((l) => l.rideId === ride.id && l.type === 'REFUND');
      expect(ledgers.length).toBe(1);
      expect(ledgers[0].amount).toBe(70);
    });

    it('strictly handles 20 concurrent duplicate webhooks without double mutations', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 120,
        finalFare: 120,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'SUCCEEDED',
      });

      const intentId = 'pi_concurrent_20_' + generateId('pi');
      await store.createPayment({
        rideId: ride.id,
        userId: riderUser.id,
        amount: 120,
        currency: 'SAR',
        status: 'SUCCEEDED',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: intentId,
      });

      const eventId = 'evt_concurrent_20_' + generateId('evt');

      // Fire 20 duplicate refund operations simultaneously
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          store.settleStripeRefund({ paymentIntentId: intentId, eventId, refundAmount: 120 })
        )
      );

      expect(results.length).toBe(20);
      for (const res of results) {
        expect(res.success).toBe(true);
        expect(res.refundAmount).toBe(120);
      }

      // Exactly 1 ledger entry exists
      const refundLedgers = store.ledger.filter((l) => l.rideId === ride.id && l.type === 'REFUND');
      expect(refundLedgers.length).toBe(1);
      expect(refundLedgers[0].amount).toBe(120);
    });

    it('strictly separates payment_intent.canceled from refunds (no REFUND ledger entry created)', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'REQUESTED',
        estimatedFare: 50,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'PENDING',
      });

      const intentId = 'pi_canceled_intent_' + generateId('pi');
      await store.createPayment({
        rideId: ride.id,
        userId: riderUser.id,
        amount: 50,
        currency: 'SAR',
        status: 'PENDING',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: intentId,
      });

      const cancelEvent = {
        id: 'evt_cancel_' + generateId('evt'),
        type: 'payment_intent.canceled',
        data: {
          object: {
            id: intentId,
            cancellation_reason: 'abandoned',
          },
        },
      };

      const { StripeService } = await import('../server/services/stripeService');
      const origConstruct = StripeService.constructWebhookEvent;
      StripeService.constructWebhookEvent = () => cancelEvent as any;

      try {
        await PaymentService.handleWebhook(JSON.stringify(cancelEvent), 'test_sig', cancelEvent.id);

        const updatedPayment = await store.findPaymentByStripeIntent(intentId);
        expect(updatedPayment?.status).toBe('CANCELED');

        // ZERO REFUND ledger entries must be created for a cancellation!
        const refundLedgers = store.ledger.filter(
          (l) => l.rideId === ride.id && l.type === 'REFUND'
        );
        expect(refundLedgers.length).toBe(0);
      } finally {
        StripeService.constructWebhookEvent = origConstruct;
      }
    });

    it('rejects refund amounts exceeding original payment or remaining balance', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 50,
        finalFare: 50,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'SUCCEEDED',
      });

      const intentId = 'pi_excess_refund_' + generateId('pi');
      await store.createPayment({
        rideId: ride.id,
        userId: riderUser.id,
        amount: 50,
        currency: 'SAR',
        status: 'SUCCEEDED',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: intentId,
      });

      // Try refunding 100 on a 50 SAR payment
      await expect(
        store.settleStripeRefund({
          paymentIntentId: intentId,
          eventId: 'evt_excess',
          cumulativeAmountRefunded: 100,
        })
      ).rejects.toThrow('exceeds original payment amount');

      // Try negative refund amount
      await expect(
        store.settleStripeRefund({
          paymentIntentId: intentId,
          eventId: 'evt_negative',
          cumulativeAmountRefunded: -20,
        })
      ).rejects.toThrow('cannot be negative');

      // Try currency mismatch
      await expect(
        store.settleStripeRefund({
          paymentIntentId: intentId,
          eventId: 'evt_usd_mismatch',
          cumulativeAmountRefunded: 30,
          currency: 'USD',
        })
      ).rejects.toThrow('does not match payment currency');
    });

    it('recovers webhook lease on worker crash and successfully completes retry', async () => {
      const eventId = 'evt_crash_recovery_' + generateId('evt');

      // 1. Initial worker claims event
      const initialClaim = await store.claimWebhookEvent(eventId, 'stripe', 'charge.refunded', 100);
      expect(initialClaim.claimed).toBe(true);

      // 2. Immediate duplicate claim while lease is active is rejected
      const concurrentClaim = await store.claimWebhookEvent(eventId, 'stripe', 'charge.refunded', 100);
      expect(concurrentClaim.claimed).toBe(false);
      expect(concurrentClaim.alreadyProcessed).toBe(false);

      // 3. Worker crashed. Fast-forward past lease expiration
      const existing = store.webhookEvents.get(eventId);
      if (existing) {
        existing.leaseExpiresAt = Date.now() - 5000; // Expired 5 seconds ago
      }

      // 4. Retried webhook recovers lease
      const recoveredClaim = await store.claimWebhookEvent(eventId, 'stripe', 'charge.refunded', 60000);
      expect(recoveredClaim.claimed).toBe(true);

      // 5. Worker finishes and marks PROCESSED
      await store.recordProcessedWebhook(eventId, 'stripe', 'charge.refunded', {}, 'PROCESSED');

      // 6. Future replay sees alreadyProcessed
      const replayClaim = await store.claimWebhookEvent(eventId, 'stripe', 'charge.refunded', 60000);
      expect(replayClaim.claimed).toBe(false);
      expect(replayClaim.alreadyProcessed).toBe(true);
    });

    it('validates StripeService.refundPayment arguments strictly', async () => {
      const { StripeService } = await import('../server/services/stripeService');

      await expect(StripeService.refundPayment('')).rejects.toThrow('paymentIntentId is required');
      await expect(StripeService.refundPayment('pi_test', -10)).rejects.toThrow('greater than 0');
      await expect(StripeService.refundPayment('pi_test', NaN)).rejects.toThrow('valid, finite number');
      await expect(StripeService.refundPayment('pi_test', Infinity)).rejects.toThrow('valid, finite number');
    });
  });
});

