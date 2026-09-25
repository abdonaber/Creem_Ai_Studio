import dotenv from 'dotenv';
dotenv.config();

const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();
const isProduction = appEnv === 'production';
const appMode = (process.env.APP_MODE || (isProduction ? 'production' : 'development')).toLowerCase();

const rawJwtSecret = process.env.JWT_SECRET;
const rawRefreshSecret = process.env.JWT_REFRESH_SECRET;
const rawCookieSecret = process.env.COOKIE_SECRET;

// In strict production, fail fast if required cryptographic secrets or infrastructure URLs are missing or weak
if (isProduction) {
  if (!rawJwtSecret || rawJwtSecret.trim().length < 32) {
    throw new Error('FATAL: JWT_SECRET must be defined with at least 32 characters in production!');
  }
  if (!rawRefreshSecret || rawRefreshSecret.trim().length < 32) {
    throw new Error('FATAL: JWT_REFRESH_SECRET must be defined with at least 32 characters in production!');
  }
  if (!process.env.REDIS_URL || !process.env.REDIS_URL.trim()) {
    throw new Error('FATAL: REDIS_URL is strictly required in production for distributed locks, BullMQ queues, rate limiting, and critical concurrency!');
  }
  if (!process.env.MONGODB_URI || !process.env.MONGODB_URI.trim()) {
    throw new Error('FATAL: MONGODB_URI is strictly required in production environment!');
  }
}

// Parse allowed CORS origins
const rawCors = process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '';
const rawOrigins = rawCors
  ? rawCors.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

// Determine safe CORS origins
const appUrl = process.env.APP_URL || 'http://localhost:3000';
const allowedOrigins = rawOrigins.length > 0 ? rawOrigins : [appUrl];

// Unified driver location freshness threshold (Phase 8 Production Hardening)
const driverLocationStaleMs = Number(process.env.DRIVER_LOCATION_STALE_MS) || 60000; // 60 seconds default

export const config = {
  port: 3000,
  appEnv: appEnv as 'development' | 'test' | 'production',
  appMode: (appMode === 'production' ? 'production' : 'development') as 'development' | 'production',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  appUrl,

  // Database & Cache
  mongodbUri: process.env.MONGODB_URI || '',
  redisUrl: process.env.REDIS_URL || '',

  // Operational & Geospatial Settings
  driverLocationStaleMs,

  // Authentication & Security
  jwtSecret: rawJwtSecret || 'creemy-secure-dev-jwt-key-2026-very-secret-token-32char',
  jwtRefreshSecret: rawRefreshSecret || 'creemy-secure-dev-refresh-key-2026-very-secret-token-32char',
  cookieSecret: rawCookieSecret || 'creemy-cookie-dev-secret-key-2026-32chars-min',
  jwtExpiresIn: '15m',
  jwtRefreshExpiresIn: '7d',
  cookieMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days

  // Payment Integration
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',

  // Routing & Maps
  mapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN || '',
  routingProvider: (process.env.ROUTING_PROVIDER || 'auto') as 'google' | 'mapbox' | 'osrm' | 'haversine' | 'auto',

  // Operational Settings
  allowedOrigins,
  corsOrigin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
};

