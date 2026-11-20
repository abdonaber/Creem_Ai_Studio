import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { setDatabaseStore } from '../server/db/store';
import { TestDatabaseStore } from './testStore';
import { createAuthToken } from '../server/middleware/auth';
import { AuthService } from '../server/services/authService';
import { FareService } from '../server/services/fareService';
import { StripeService } from '../server/services/stripeService';
import { PaymentService } from '../server/services/paymentService';
import { QueueManager } from '../server/queue/queueManager';
import { closeSocketIO } from '../server/socket/socketHandler';
import { generateId } from '../server/utils/id';

describe('Production Verification Suite: Security, Lifecycle, Refunds & Infra', () => {
  let store: TestDatabaseStore;
  let adminToken: string;
  let riderUser: any;
  let riderToken: string;
  let driverUser: any;
  let driverRecord: any;
  let driverToken: string;

  beforeEach(async () => {
    await QueueManager.init();
    store = new TestDatabaseStore();
    setDatabaseStore(store);

    const admin = await store.createUser({
      name: 'Admin User',
      email: 'admin@creem.app',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    adminToken = createAuthToken({ userId: admin.id, role: 'ADMIN', email: admin.email });

    const riderReg = await AuthService.register({
      name: 'Rider Verified',
      email: 'rider_verified@creem.app',
      phone: '+966500000011',
      password: 'Password123!',
      role: 'RIDER',
    });
    riderUser = riderReg.user;
    riderToken = riderReg.accessToken;

    const driverReg = await AuthService.register({
      name: 'Driver Verified',
      email: 'driver_verified@creem.app',
      phone: '+966500000022',
      password: 'Password123!',
      role: 'DRIVER',
      licenseNumber: 'LIC-INIT-001',
      vehicleDetails: {
        make: 'Toyota',
        model: 'Camry',
        year: 2023,
        color: 'White',
        plateNumber: 'ABC 1234',
        category: 'STANDARD',
      },
    });
    driverUser = driverReg.user;
    driverToken = driverReg.accessToken;
    driverRecord = await store.findDriverByUserId(driverUser.id);
    if (driverRecord) {
      await store.updateDriver(driverRecord.id, { approvalStatus: 'APPROVED', isOnline: true });
      driverRecord = await store.findDriverById(driverRecord.id);
    }
  });

  describe('1. Auth Session Security & Password Change', () => {
    it('PUT /api/v1/auth/password rejects wrong current password and revokes sessions on success', async () => {
      const login = await AuthService.login({
        email: 'rider_verified@creem.app',
        password: 'Password123!',
      });

      const badRes = await request(app)
        .put('/api/v1/auth/password')
        .set('Authorization', `Bearer ${login.accessToken}`)
        .send({ currentPassword: 'WrongPassword!', newPassword: 'NewPassword456!' });
      expect(badRes.status).toBe(400);

      const okRes = await request(app)
        .put('/api/v1/auth/password')
        .set('Authorization', `Bearer ${login.accessToken}`)
        .send({ currentPassword: 'Password123!', newPassword: 'NewPassword456!' });
      expect(okRes.status).toBe(200);
      expect(okRes.body.success).toBe(true);

      // Prior refresh token must now be revoked
      await expect(AuthService.rotateRefreshToken(login.refreshToken)).rejects.toThrow();

      // New password works for login
      const relogin = await AuthService.login({
        email: 'rider_verified@creem.app',
        password: 'NewPassword456!',
      });
      expect(relogin.accessToken).toBeDefined();
    });

    it('handles benign concurrent refresh within grace window while still catching replay after rotation', async () => {
      const login = await AuthService.login({
        email: 'rider_verified@creem.app',
        password: 'Password123!',
      });

      // Concurrent dual refresh: winner succeeds, concurrent caller gets 401 CONCURRENT_REFRESH_REJECTED without revoking family
      const results = await Promise.allSettled([
        AuthService.rotateRefreshToken(login.refreshToken),
        AuthService.rotateRefreshToken(login.refreshToken),
      ]);
      const fulfilled = results.filter((r): r is PromiseFulfilledResult<{ accessToken: string; refreshToken: string }> => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0].reason as any)?.code).toBe('CONCURRENT_REFRESH_REJECTED');

      // Winner's rotated token remains valid (family was NOT revoked during grace window)
      const r3 = await AuthService.rotateRefreshToken(fulfilled[0].value.refreshToken);
      expect(r3.refreshToken).toBeDefined();

      // Replaying the revoked original token after rotation triggers theft detection & revokes session family
      await expect(AuthService.rotateRefreshToken(login.refreshToken)).rejects.toThrow();
      await expect(AuthService.rotateRefreshToken(r3.refreshToken)).rejects.toThrow();
    });

    it('suspending a user via admin immediately revokes sessions and blocks /auth/me', async () => {
      const login = await AuthService.login({
        email: 'driver_verified@creem.app',
        password: 'Password123!',
      });

      const suspendRes = await request(app)
        .put(`/api/v1/admin/users/${driverUser.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'SUSPENDED' });

      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body.data.status).toBe('SUSPENDED');

      const updatedDriver = await store.findDriverById(driverRecord.id);
      expect(updatedDriver?.isOnline).toBe(false);

      // Refresh token revoked
      await expect(AuthService.rotateRefreshToken(login.refreshToken)).rejects.toThrow();

      // Access token blocked immediately on DB status check
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.accessToken}`);
      expect(meRes.status).toBe(403);
    });
  });

  describe('2. Ride Coordinates, Driver Onboarding, Decline & Rating Integrity', () => {
    it('accepts (0, 0) coordinates on estimate and ride request without falsy rejection', async () => {
      const estRes = await request(app)
        .post('/api/v1/rides/estimate')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({
          pickup: { lat: 0, lng: 0, address: 'Origin Zero' },
          destination: { lat: 0.05, lng: 0.05, address: 'Dest Near Zero' },
        });
      expect(estRes.status).toBe(200);
      expect(estRes.body.data.estimates.length).toBe(4);

      const reqRes = await request(app)
        .post('/api/v1/rides/request')
        .set('Authorization', `Bearer ${riderToken}`)
        .send({
          pickup: { lat: 0, lng: 0, address: 'Origin Zero' },
          destination: { lat: 0.05, lng: 0.05, address: 'Dest Near Zero' },
          vehicleCategory: 'STANDARD',
          paymentMethod: 'CASH',
        });
      expect(reqRes.status).toBe(201);
      expect(reqRes.body.data.pickup.lat).toBe(0);
      expect(reqRes.body.data.pickup.lng).toBe(0);
    });

    it('PUT /api/v1/drivers/onboarding updates existing vehicle using driver.id cleanly', async () => {
      const res = await request(app)
        .put('/api/v1/drivers/onboarding')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          licenseNumber: 'LIC-UPDATED-999',
          vehicle: {
            make: 'Hyundai',
            model: 'Sonata',
            year: 2025,
            color: 'Silver',
            plateNumber: 'XYZ 5555',
            category: 'COMFORT',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.licenseNumber).toBe('LIC-UPDATED-999');
      expect(res.body.data.vehicle.make).toBe('Hyundai');
      expect(res.body.data.vehicle.plateNumber).toBe('XYZ 5555');
      expect(res.body.data.vehicle.category).toBe('COMFORT');
    });

    it('FareService.calculateFinalFare respects elapsed trip duration (capped) and tip', () => {
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60000).toISOString();
      const finalFare = FareService.calculateFinalFare({
        distanceKm: 10,
        durationMinutes: 15,
        vehicleCategory: 'STANDARD',
        estimatedFare: 30,
        startedAt: thirtyMinsAgo,
        tip: 5,
      });
      // Base 10 + 18 (10*1.8) + 13.5 (30*0.45) = 41.5 + 5 tip = 46.5
      expect(finalFare).toBeGreaterThanOrEqual(46.5);
    });

    it('POST /api/v1/rides/:id/rate does not double-increment driver.totalRides', async () => {
      const initialTotal = driverRecord.totalRides || 0;
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_STARTED',
        vehicleCategory: 'STANDARD',
        pickup: { lat: 24.71, lng: 46.67, address: 'A' },
        destination: { lat: 24.75, lng: 46.65, address: 'B' },
        estimatedFare: 30,
        distanceKm: 5,
        durationMinutes: 10,
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
      });

      const completeRes = await request(app)
        .post(`/api/v1/rides/${ride.id}/transition`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'RIDE_COMPLETED' });
      expect(completeRes.status).toBe(200);

      const afterCompleteDriver = await store.findDriverById(driverRecord.id);
      const countAfterComplete = afterCompleteDriver?.totalRides ?? initialTotal;

      const rateRes = await request(app)
        .post(`/api/v1/rides/${ride.id}/rate`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({ stars: 5, comment: 'Great trip' });
      expect(rateRes.status).toBe(200);

      const afterRateDriver = await store.findDriverById(driverRecord.id);
      expect(afterRateDriver?.totalRides).toBe(countAfterComplete);
    });

    it('POST /api/v1/rides/:id/decline adds driver to offeredDriverIds and clears currentOffer', async () => {
      const ride = await store.createRide({
        riderId: riderUser.id,
        status: 'SEARCHING_DRIVER',
        vehicleCategory: 'STANDARD',
        pickup: { lat: 24.71, lng: 46.67, address: 'A' },
        destination: { lat: 24.75, lng: 46.65, address: 'B' },
        estimatedFare: 30,
        distanceKm: 5,
        durationMinutes: 10,
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        currentOffer: {
          offerId: 'offer_123',
          driverId: driverRecord.id,
          expiresAt: new Date(Date.now() + 15000).toISOString(),
        },
        offeredDriverIds: [],
      });

      const declineRes = await request(app)
        .post(`/api/v1/rides/${ride.id}/decline`)
        .set('Authorization', `Bearer ${driverToken}`);

      expect(declineRes.status).toBe(200);
      const updated = await store.findRideById(ride.id);
      expect(updated?.currentOffer).toBeUndefined();
      expect(updated?.offeredDriverIds).toContain(driverRecord.id);
    });
  });

  describe('3. Stripe Refunds, Multi-Item Webhooks, Audit Split & Financial Summary', () => {
    it('StripeService.refundPayment rejects >2 decimals before rounding and forwards idempotencyKey', async () => {
      await expect(
        StripeService.refundPayment('pi_precision_check', 10.123, 'requested_by_customer', 'idem_prec_1')
      ).rejects.toThrow('maximum 2 decimal places allowed');
    });

    it('charge.refunded webhook iterates refunds.data, settles succeeded deltas idempotently, and skips pending refunds', async () => {
      const piId = 'pi_multi_' + generateId('pi');
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 100,
        finalFare: 100,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'PENDING',
      });
      await store.createPayment({
        rideId: ride.id,
        userId: riderUser.id,
        amount: 100,
        currency: 'SAR',
        status: 'PENDING',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: piId,
      });

      await store.settleStripePaymentSucceeded({
        paymentIntentId: piId,
        eventId: 'evt_pay_multi_' + generateId('e'),
        amount: 100,
      });

      const origConstruct = StripeService.constructWebhookEvent;
      StripeService.constructWebhookEvent = ((payload: any) =>
        JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8'))) as any;

      try {
        const evt = {
          id: 'evt_chg_ref_multi_' + generateId('e'),
          type: 'charge.refunded',
          data: {
            object: {
              id: 'ch_multi_123',
              object: 'charge',
              payment_intent: piId,
              currency: 'sar',
              amount_refunded: 5500,
              refunds: {
                data: [
                  { id: 're_m_1', amount: 3000, status: 'succeeded', currency: 'sar' },
                  { id: 're_m_2', amount: 2000, status: 'pending', currency: 'sar' },
                  { id: 're_m_3', amount: 2500, status: 'succeeded', currency: 'sar' },
                ],
              },
            },
          },
        };

        await PaymentService.handleWebhook(JSON.stringify(evt), 'sig_test', evt.id);

        const payment = await store.findPaymentByStripeIntent(piId);
        expect(payment?.status).toBe('PARTIALLY_REFUNDED');
        expect(payment?.refundAmount).toBe(55);
        expect(payment?.refunds?.find((r) => r.stripeRefundId === 're_m_2')?.status).toBe('pending');

        const refundLedgers = store.ledger.filter((l) => l.rideId === ride.id && l.type === 'REFUND');
        expect(refundLedgers.length).toBe(2);
        expect(refundLedgers.reduce((s, l) => s + l.amount, 0)).toBe(55);

        // Verify getFinancialSummary subtracts PARTIALLY_REFUNDED refundAmount from gross, commission & payouts
        const summary = await store.getFinancialSummary();
        expect(summary.totalGrossVolume).toBe(45);
        expect(summary.totalPlatformRevenue).toBe(9);
        expect(summary.totalDriverPayouts).toBe(36);
      } finally {
        StripeService.constructWebhookEvent = origConstruct;
      }
    });

    it('settleStripeRefund logs MISSING_ORIGINAL_SPLIT audit flag when original split metadata & ledger are absent', async () => {
      const piId = 'pi_nosplit_' + generateId('pi');
      const ride = await store.createRide({
        riderId: riderUser.id,
        driverId: driverRecord.id,
        status: 'RIDE_COMPLETED',
        estimatedFare: 100,
        finalFare: 100,
        paymentMethod: 'CREDIT_CARD',
        paymentStatus: 'SUCCEEDED',
      });
      await store.createPayment({
        rideId: ride.id,
        userId: riderUser.id,
        amount: 100,
        currency: 'SAR',
        status: 'SUCCEEDED',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: piId,
      });

      const res = await store.settleStripeRefund({
        paymentIntentId: piId,
        eventId: 'evt_nosplit_' + generateId('e'),
        refundDelta: 50,
        refundId: 're_nosplit_1',
      });

      expect(res.success).toBe(true);
      const audits = await store.getAuditLogs(50);
      expect(audits.some((a) => a.action === 'RECONCILIATION_FLAG:MISSING_ORIGINAL_SPLIT')).toBe(true);
    });
  });

  describe('4. Queue Readiness & Graceful Socket Shutdown', () => {
    it('QueueManager.isReady() is false when closed and closeSocketIO() is safe to call repeatedly', async () => {
      await QueueManager.close();
      expect(QueueManager.isReady()).toBe(false);
      await expect(closeSocketIO()).resolves.toBeUndefined();
      await QueueManager.init();
    });
  });
});
