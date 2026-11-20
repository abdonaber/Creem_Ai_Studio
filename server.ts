import http from 'http';
import path from 'path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { createServer as createViteServer } from 'vite';

import { config } from './server/config';
import { connectDB, isDbConnected, closeDB } from './server/db/connection';
import { initSocketIO, closeSocketIO } from './server/socket/socketHandler';
import { errorHandler } from './server/middleware/errorHandler';
import { requestIdMiddleware } from './server/middleware/requestId';
import { rateLimit } from './server/middleware/rateLimiter';
import { AuthPayload } from './server/middleware/auth';
import { DispatchService } from './server/services/dispatchService';
import { isRedisConnected, closeRedis } from './server/redis/redisClient';
import { QueueManager } from './server/queue/queueManager';
import { metrics } from './server/utils/metrics';

// Route Handlers
import { authRouter } from './server/routes/authRoutes';
import { userRouter } from './server/routes/userRoutes';
import { driverRouter } from './server/routes/driverRoutes';
import { rideRouter } from './server/routes/rideRoutes';
import { walletRouter } from './server/routes/walletRoutes';
import { paymentRouter } from './server/routes/paymentRoutes';
import { chatRouter } from './server/routes/chatRoutes';
import { adminRouter } from './server/routes/adminRoutes';
import { notificationRouter } from './server/routes/notificationRoutes';

export const app = express();

// Trust reverse proxy headers when deployed behind load balancer / TLS terminator
app.set('trust proxy', 1);

// 1. Global Security & Parsing Middlewares
app.use(
  helmet({
    contentSecurityPolicy: config.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: [
              "'self'",
              'data:',
              'blob:',
              'https://*.tile.openstreetmap.org',
              'https://*.basemaps.cartocdn.com',
            ],
            connectSrc: ["'self'", 'https://nominatim.openstreetmap.org', 'ws:', 'wss:'],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (config.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (!config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);

app.use(
  express.json({
    limit: '1mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(requestIdMiddleware);

// Security Headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Helper for verifying metrics/diagnostics authorization in production
function isAuthorizedOpsRequest(req: express.Request): boolean {
  if (!config.isProduction) return true;

  const tokenHeader = req.headers['x-metrics-token'];
  const authHeader = req.headers.authorization;
  const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (config.metricsAuthToken && (tokenHeader === config.metricsAuthToken || bearer === config.metricsAuthToken)) {
    return true;
  }

  if (bearer) {
    try {
      const decoded = jwt.verify(bearer, config.jwtSecret) as AuthPayload;
      if (decoded?.role === 'ADMIN') {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

// 2. Health (Liveness), Readiness & Metrics Probes
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    platform: 'Creem',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsage: process.memoryUsage(),
  });
});

const checkReadiness = async (req: express.Request, res: express.Response) => {
  const dbStatus = isDbConnected();
  const redisConfigured = Boolean(config.redisUrl);
  const redisStatus = redisConfigured ? isRedisConnected() : !config.isProduction;
  const queueReady = QueueManager.isReady();
  const configStatus = Boolean(config.jwtSecret && config.jwtSecret.length >= 32);
  const queueHealth = await QueueManager.getQueueMetrics();

  const isReady = (dbStatus || !config.isProduction) && redisStatus && queueReady && configStatus;

  if (config.isProduction && !isAuthorizedOpsRequest(req)) {
    return res.status(isReady ? 200 : 503).json({
      status: isReady ? 'ready' : 'unready',
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'unready',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbStatus ? 'connected' : 'disconnected',
      redis: redisConfigured ? (redisStatus ? 'connected' : 'disconnected') : 'not_configured',
      queue: queueHealth,
      configuration: configStatus ? 'valid' : 'invalid',
    },
  });
};

app.get('/readiness', checkReadiness);
app.get('/ready', checkReadiness);

app.get('/metrics', (req, res) => {
  if (!isAuthorizedOpsRequest(req)) {
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED_METRICS',
      message: 'Authentication required for metrics endpoint in production.',
    });
  }
  return res.json(metrics.getSnapshot());
});

// 3. Global API Rate Limiter & REST API Routes (Version 1)
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: 'Too many requests from this IP. Please try again shortly.',
});

app.use('/api/v1', globalApiLimiter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/drivers', driverRouter);
app.use('/api/v1/rides', rideRouter);
app.use('/api/v1/wallet', walletRouter);
app.use('/api/v1/payments', paymentRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/notifications', notificationRouter);

// 4. Centralized Error Handler (must be mounted after API routes)
app.use(errorHandler);

async function startServer() {
  // 1. Connect Database
  await connectDB();

  // 2. Vite Middleware (non-production) or Static Production Serving
  if (!config.isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // 3. Create HTTP Server & Attach Socket.IO
  const server = http.createServer(app);
  initSocketIO(server);

  // 4. Initialize background dispatch queues & workers before accepting traffic
  await DispatchService.init();

  const PORT = config.port;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Creem] Server live on http://0.0.0.0:${PORT} (env: ${config.appEnv})`);
  });

  // 5. Idempotent Graceful Shutdown Handling
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Creem] Received ${signal}. Initiating graceful shutdown...`);

    const forceTimer = setTimeout(() => {
      console.error('[Creem] Teardown timeout reached. Forcing exit.');
      process.exit(1);
    }, 10000);
    forceTimer.unref();

    try {
      await DispatchService.stopWorker();

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });

      await closeSocketIO();
      await closeRedis();
      await closeDB();

      clearTimeout(forceTimer);
      console.log('[Creem] All resources cleanly released. Exiting.');
      process.exit(0);
    } catch (err) {
      console.error('[Creem] Error during graceful teardown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// Start only when run as entrypoint (never during Vitest or Bun test runs)
const isTestRunner =
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.VITEST) ||
  Boolean(process.env.BUN_TEST) ||
  process.argv.some((arg) => arg === 'test' || arg.includes('.test.'));

if (!isTestRunner) {
  startServer().catch((err) => {
    console.error('[Creem] Fatal startup failure:', err);
    process.exit(1);
  });
}
