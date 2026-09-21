import dotenv from 'dotenv';
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

// In production, refuse to run if JWT_SECRET is missing or default
const rawJwtSecret = process.env.JWT_SECRET;
const rawRefreshSecret = process.env.JWT_REFRESH_SECRET;

if (isProduction && (!rawJwtSecret || rawJwtSecret.trim().length < 16)) {
  throw new Error('FATAL: JWT_SECRET must be set to a secure string in production!');
}

export const config = {
  port: 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  mongodbUri: process.env.MONGODB_URI || '',
  jwtSecret: rawJwtSecret || 'creemy-secure-dev-jwt-key-2026-very-secret-token',
  jwtRefreshSecret: rawRefreshSecret || 'creemy-secure-dev-refresh-key-2026-very-secret-token',
  jwtExpiresIn: '15m',
  jwtRefreshExpiresIn: '7d',
  demoMode: process.env.DEMO_MODE !== 'false',
  enableSimulation: process.env.ENABLE_SIMULATION !== 'false',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
};
