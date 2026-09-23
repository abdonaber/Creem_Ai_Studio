import { describe, it, expect, beforeEach } from 'vitest';
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
      currentLocation: { lat: 24.7136, lng: 46.6753, heading: 90, updatedAt: new Date().toISOString() },
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
});
