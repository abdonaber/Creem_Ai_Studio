import dotenv from 'dotenv';
dotenv.config();

const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();
const isProduction = appEnv === 'production';
const appMode = (process.env.APP_MODE || (isProduction ? 'production' : 'development')).toLowerCase();

const rawJwtSecret = process.env.JWT_SECRET;
const rawRefreshSecret = process.env.JWT_REFRESH_SECRET;
const rawCookieSecret = process.env.COOKIE_SECRET;

// In strict production, fail fast if required cryptographic secrets are missing or weak
if (isProduction) {
  if (!rawJwtSecret || rawJwtSecret.trim().length < 32) {
    throw new Error('FATAL: JWT_SECRET must be defined with at least 32 characters in production!');
  }
  if (!rawRefreshSecret || rawRefreshSecret.trim().length < 32) {
    throw new Error('FATAL: JWT_REFRESH_SECRET must be defined with at least 32 characters in production!');
  }
  if (appMode === 'demo') {
    throw new Error('FATAL: APP_MODE=demo is strictly forbidden in production!');
  }
}

// Parse allowed CORS origins
const rawCors = process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '';
const allowedOrigins = rawCors
  ? rawCors.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

export const config = {
  port: 3000,
  appEnv: appEnv as 'development' | 'test' | 'production',
  appMode: appMode as 'development' | 'production' | 'demo',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  // Database & Cache
  mongodbUri: process.env.MONGODB_URI || '',
  redisUrl: process.env.REDIS_URL || '',

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

  // Operational Settings
  allowedOrigins,
  corsOrigin: allowedOrigins.length > 0 ? (allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins) : '*',
  demoMode: appMode === 'demo' && !isProduction,
};
