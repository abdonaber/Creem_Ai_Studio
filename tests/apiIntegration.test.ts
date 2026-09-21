import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../server';
import { seedInitialData } from '../server/seed/seedData';

describe('End-to-End API Integration & RBAC Tests', () => {
  let riderToken: string;
  let driverToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await seedInitialData();

    // Login Rider
    const riderRes = await request(app).post('/api/v1/auth/login').send({
      email: 'rider@creemy.app',
      password: 'CreemY@2026',
    });
    riderToken = riderRes.body.data.accessToken;

    // Login Driver
    const driverRes = await request(app).post('/api/v1/auth/login').send({
      email: 'driver@creemy.app',
      password: 'CreemY@2026',
    });
    driverToken = driverRes.body.data.accessToken;

    // Login Admin
    const adminRes = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@creemy.app',
      password: 'CreemY@2026',
    });
    adminToken = adminRes.body.data.accessToken;
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
    expect(res.body.data.totalDriversCount).toBeGreaterThan(0);
    expect(res.body.data.totalUsersCount).toBeGreaterThan(0);
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
