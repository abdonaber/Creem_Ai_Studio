import http from 'http';
import path from 'path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createServer as createViteServer } from 'vite';

import { config } from './server/config';
import { connectDB, isDbConnected, closeDB } from './server/db/connection';
import { initSocketIO, closeSocketIO } from './server/socket/socketHandler';
import { errorHandler } from './server/middleware/errorHandler';
import { requestIdMiddleware } from './server/middleware/requestId';
import { DispatchService } from './server/services/dispatchService';
import { isRedisConnected, getRedisClient } from './server/redis/redisClient';

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

// 1. Global Security & Parsing Middlewares
app.use(
  helmet({
    contentSecurityPolicy: false, // Allows Vite inline scripts and styles in development & preview iframe
    crossOriginEmbedderPolicy: false,
  })
);
app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin,
    credentials: true,
  })
);
app.use(
  express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(requestIdMiddleware);

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// 2. Health (Liveness) & Readiness Probes
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    platform: 'CreemY',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsage: process.memoryUsage(),
  });
});

const checkReadiness = async (_req: express.Request, res: express.Response) => {
  const dbStatus = isDbConnected();
  const redisConfigured = Boolean(config.redisUrl);
  const redisStatus = redisConfigured ? isRedisConnected() : true;
  const configStatus = Boolean(config.jwtSecret && config.jwtSecret.length >= 8);

  const isReady = (dbStatus || !config.isProduction) && redisStatus && configStatus;

  const payload = {
    status: isReady ? 'ready' : 'unready',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbStatus ? 'connected' : 'disconnected',
      redis: redisConfigured ? (redisStatus ? 'connected' : 'disconnected') : 'not_configured',
      configuration: configStatus ? 'valid' : 'invalid',
    },
  };

  if (!isReady && config.isProduction) {
    return res.status(503).json(payload);
  }

  return res.status(isReady ? 200 : 503).json(payload);
};

app.get('/readiness', checkReadiness);
app.get('/ready', checkReadiness);

// 3. Mount REST API Routes (Version 1)
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
  // Database Initialization
  await connectDB();

  // Vite Middleware or Static Production File Serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Create HTTP Server & Attach Socket.IO
  const server = http.createServer(app);
  initSocketIO(server);

  // Start background dispatch engine
  DispatchService.startWorker();

  const PORT = config.port;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[CreemY] Server live on http://0.0.0.0:${PORT} (env: ${config.nodeEnv})`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`[CreemY] Received ${signal}. Initiating graceful shutdown...`);
    // 1. Stop background workers
    DispatchService.stopWorker();

    // 2. Stop accepting new HTTP requests
    server.close(async () => {
      try {
        // 3. Close real-time sockets
        await closeSocketIO();

        // 4. Close Redis connection if active
        const redis = getRedisClient();
        if (redis) {
          await redis.quit();
          console.log('[CreemY] Redis connection closed.');
        }

        // 5. Close MongoDB
        await closeDB();
        console.log('[CreemY] All resources cleanly released. Exiting.');
        process.exit(0);
      } catch (err) {
        console.error('[CreemY] Error during graceful teardown:', err);
        process.exit(1);
      }
    });

    // Force exit after 10s if shutdown hangs
    setTimeout(() => {
      console.error('[CreemY] Teardown timeout reached. Forcing exit.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Start only when run directly (not during vitest test runs)
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer().catch((err) => {
    console.error('[CreemY] Fatal startup failure:', err);
    process.exit(1);
  });
}
