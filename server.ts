import http from 'http';
import path from 'path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createServer as createViteServer } from 'vite';

import { config } from './server/config';
import { connectDB, isDbConnected, closeDB } from './server/db/connection';
import { initSocketIO } from './server/socket/socketHandler';
import { errorHandler } from './server/middleware/errorHandler';

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// 2. Health & Readiness Probes
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    platform: 'CreemY',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.get('/ready', (req, res) => {
  const dbStatus = isDbConnected();
  if (!dbStatus && config.isProduction) {
    return res.status(503).json({
      status: 'unready',
      database: 'disconnected',
    });
  }
  res.json({
    status: 'ready',
    database: dbStatus ? 'connected' : 'connecting',
  });
});

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

  const PORT = config.port;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[CreemY] Server live on http://0.0.0.0:${PORT} (env: ${config.nodeEnv})`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`[CreemY] Received ${signal}. Closing gracefully...`);
    server.close(async () => {
      await closeDB();
      console.log('[CreemY] HTTP and DB connections closed.');
      process.exit(0);
    });
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
