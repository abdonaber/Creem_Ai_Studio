import dotenv from 'dotenv';
dotenv.config();

const rawAppEnv = process.env.APP_ENV?.trim().toLowerCase();
const rawNodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
const rawAppMode = process.env.APP_MODE?.trim().toLowerCase();

// Detect conflicting explicit environment flags (never silently enter wrong mode)
const isTestEnv = rawNodeEnv === 'test' || Boolean(process.env.VITEST) || Boolean(process.env.BUN_TEST);
if (!isTestEnv) {
  const explicitlyProd = rawAppEnv === 'production' || rawNodeEnv === 'production' || rawAppMode === 'production';
  const explicitlyDev = rawAppEnv === 'development' || rawNodeEnv === 'development' || rawAppMode === 'development';
  if (explicitlyProd && explicitlyDev) {
    throw new Error(
      `FATAL: Conflicting environment configuration (APP_ENV=${rawAppEnv || 'unset'}, NODE_ENV=${rawNodeEnv || 'unset'}, APP_MODE=${rawAppMode || 'unset'}).`
    );
  }
}

const resolvedEnv = isTestEnv
  ? 'test'
  : (rawAppEnv || rawNodeEnv || rawAppMode || 'development');

const isProduction = resolvedEnv === 'production';
const appMode = isProduction ? 'production' : 'development';

const DEV_JWT_FALLBACK = 'creem-dev-jwt-secret-key-not-for-production-use-32chars';
const DEV_REFRESH_FALLBACK = 'creem-dev-refresh-secret-key-not-for-production-32chars';
const DEV_COOKIE_FALLBACK = 'creem-dev-cookie-secret-key-not-for-production-32chars';

const KNOWN_DEV_SECRETS = new Set([
  DEV_JWT_FALLBACK,
  DEV_REFRESH_FALLBACK,
  DEV_COOKIE_FALLBACK,
  'creemy-secure-dev-jwt-key-2026-very-secret-token-32char',
  'creemy-secure-dev-refresh-key-2026-very-secret-token-32char',
  'creemy-cookie-dev-secret-key-2026-32chars-min',
]);

const rawJwtSecret = process.env.JWT_SECRET?.trim();
const rawRefreshSecret = process.env.JWT_REFRESH_SECRET?.trim();
const rawCookieSecret = process.env.COOKIE_SECRET?.trim();
const rawAppUrl = process.env.APP_URL?.trim();
const rawStripeSecret = process.env.STRIPE_SECRET_KEY?.trim();
const rawStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

// Parse allowed CORS origins
const rawCors = process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '';
const rawOrigins = rawCors
  ? rawCors.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

if (isProduction) {
  if (!rawJwtSecret || rawJwtSecret.length < 32 || KNOWN_DEV_SECRETS.has(rawJwtSecret)) {
    throw new Error('FATAL: JWT_SECRET must be set to a strong unique secret (>= 32 chars) in production!');
  }
  if (!rawRefreshSecret || rawRefreshSecret.length < 32 || KNOWN_DEV_SECRETS.has(rawRefreshSecret)) {
    throw new Error('FATAL: JWT_REFRESH_SECRET must be set to a strong unique secret (>= 32 chars) in production!');
  }
  if (!rawCookieSecret || rawCookieSecret.length < 32 || KNOWN_DEV_SECRETS.has(rawCookieSecret)) {
    throw new Error('FATAL: COOKIE_SECRET must be set to a strong unique secret (>= 32 chars) in production!');
  }
  if (!process.env.REDIS_URL || !process.env.REDIS_URL.trim()) {
    throw new Error('FATAL: REDIS_URL is strictly required in production!');
  }
  if (!process.env.MONGODB_URI || !process.env.MONGODB_URI.trim()) {
    throw new Error('FATAL: MONGODB_URI is strictly required in production!');
  }
  if (!rawAppUrl) {
    throw new Error('FATAL: APP_URL is strictly required in production!');
  }
  if (!rawStripeSecret || !rawStripeWebhookSecret) {
    throw new Error('FATAL: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are strictly required in production!');
  }
  if (rawOrigins.length === 0 || rawOrigins.includes('*')) {
    throw new Error('FATAL: CORS_ALLOWED_ORIGINS must specify explicit origins (no wildcard *) in production!');
  }
}

const port = Number(process.env.PORT) || 3000;
const appUrl = rawAppUrl || `http://localhost:${port}`;
const allowedOrigins = rawOrigins.length > 0 ? rawOrigins : [appUrl];
const driverLocationStaleMs = Number(process.env.DRIVER_LOCATION_STALE_MS) || 60000;
const parsedCommission = Number(process.env.PLATFORM_COMMISSION_RATE);
const commissionRate = Number.isFinite(parsedCommission) && parsedCommission >= 0 && parsedCommission <= 0.5
  ? parsedCommission
  : 0.2;

export const config = {
  port,
  appEnv: (resolvedEnv === 'production' || resolvedEnv === 'test' ? resolvedEnv : 'development') as
    | 'development'
    | 'test'
    | 'production',
  appMode: appMode as 'development' | 'production',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  appUrl,

  // Database & Cache
  mongodbUri: process.env.MONGODB_URI?.trim() || '',
  redisUrl: process.env.REDIS_URL?.trim() || '',

  // Operational & Geospatial Settings
  driverLocationStaleMs,
  commissionRate,
  refreshGraceWindowMs: 5000,

  // Authentication & Security
  jwtSecret: rawJwtSecret || DEV_JWT_FALLBACK,
  jwtRefreshSecret: rawRefreshSecret || DEV_REFRESH_FALLBACK,
  cookieSecret: rawCookieSecret || DEV_COOKIE_FALLBACK,
  jwtExpiresIn: '15m',
  jwtRefreshExpiresIn: '7d',
  cookieMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  metricsAuthToken: process.env.METRICS_AUTH_TOKEN?.trim() || '',

  // Payment Integration
  stripeSecretKey: rawStripeSecret || '',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim() || '',
  stripeWebhookSecret: rawStripeWebhookSecret || '',

  // Routing & Maps
  mapsApiKey: process.env.GOOGLE_MAPS_API_KEY?.trim() || '',
  mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN?.trim() || '',
  routingProvider: (process.env.ROUTING_PROVIDER || 'auto') as
    | 'google'
    | 'mapbox'
    | 'osrm'
    | 'haversine'
    | 'auto',

  // Operational Settings
  allowedOrigins,
  corsOrigin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
};
