import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { setDatabaseStore } from '../server/db/store';
import { TestDatabaseStore } from './testStore';
import { createAuthToken } from '../server/middleware/auth';

describe('End-to-End API Integration & RBAC Tests', () => {
  let riderToken: string;
  let driverToken: string;
  let adminToken: string;
  let testStore: TestDatabaseStore;

  beforeAll(async () => {
    testStore = new TestDatabaseStore();
    setDatabaseStore(testStore);

    // Register Rider
    const riderReg = await request(app).post('/api/v1/auth/register').send({
      name: 'Test Rider',
      email: 'rider_test@creemy.app',
      phone: '+966511111111',
      password: 'TestPassword123!',
      role: 'RIDER',
    });
    riderToken = riderReg.body.data.accessToken;

    // Register Driver
    const driverReg = await request(app).post('/api/v1/auth/register').send({
      name: 'Test Driver',
      email: 'driver_test@creemy.app',
      phone: '+966522222222',
      password: 'TestPassword123!',
      role: 'DRIVER',
    });
    driverToken = driverReg.body.data.accessToken;

    // Approve driver and create vehicle in test store
    const driver = await testStore.findDriverByUserId(driverReg.body.data.user.id);
    if (driver) {
      await testStore.updateDriver(driver.id, { approvalStatus: 'APPROVED', isOnline: true });
      await testStore.createVehicle({
        driverId: driver.id,
        make: 'Lexus',
        model: 'ES350',
        year: 2024,
        color: 'Black',
        plateNumber: 'KSA 9999',
        category: 'VIP',
      });
    }

    // Create Admin directly in database (public registration cannot create ADMIN)
    const admin = await testStore.createUser({
      name: 'Test Admin',
      email: 'admin_test@creemy.app',
      phone: '+966533333333',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    adminToken = createAuthToken({ userId: admin.id, role: 'ADMIN', email: admin.email });
  });

  it('GET /health returns healthy system status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.platform).toBe('CreemY');
  });

  it('POST /api/v1/rides/estimate returns fares across categories for Riyadh coordinates', async () => {
    const res = await request(app)
      .post('/api/v1/rides/estimate')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({
        pickup: { lat: 24.7112, lng: 46.6744, address: 'Kingdom Tower' },
        destination: { lat: 24.7743, lng: 46.6386, address: 'KAFD' },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.estimates.length).toBe(4);
    expect(res.body.data.distanceKm).toBeGreaterThan(5);
  });

  it('POST /api/v1/wallet/topup credits rider wallet with promo code bonus', async () => {
    const res = await request(app)
      .post('/api/v1/wallet/topup')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({
        amount: 50,
        promoCode: 'CREEMY2026',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transaction.amount).toBe(75); // 50 + 25 bonus
  });

  it('RBAC enforcement: Rider is strictly FORBIDDEN (403) from accessing admin endpoints', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${riderToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('RBAC authorized: Admin successfully accesses /api/v1/admin/stats', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalDriversCount).toBeGreaterThanOrEqual(1);
    expect(res.body.data.totalUsersCount).toBeGreaterThanOrEqual(1);
  });

  it('Full ride creation flow by rider', async () => {
    const res = await request(app)
      .post('/api/v1/rides/request')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({
        pickup: { lat: 24.7136, lng: 46.6753, address: 'Al Olaya Main Street' },
        destination: { lat: 24.755, lng: 46.643, address: 'Riyadh Front' },
        vehicleCategory: 'VIP',
        paymentMethod: 'WALLET',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('REQUESTED');
    expect(res.body.data.vehicleCategory).toBe('VIP');
  });
});
