import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { z } from 'zod';
import { createAdapter } from '@socket.io/redis-adapter';
import { config } from '../config';
import { db } from '../db/store';
import { AuthPayload } from '../middleware/auth';
import { IMessage } from '../types';
import { generateId } from '../utils/id';
import { LocationService } from '../services/locationService';
import { logger } from '../utils/logger';

export let io: SocketIOServer | null = null;
let redisPubClient: Redis | null = null;
let redisSubClient: Redis | null = null;

interface AuthenticatedSocket extends Socket {
  user?: AuthPayload;
}

const rideRoomSchema = z.object({
  rideId: z.string().min(1).max(120),
});

const driverLocationSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  heading: z.number().finite().min(0).max(360).optional(),
  timestamp: z.number().finite().optional(),
  rideId: z.string().min(1).max(120).optional(),
});

const sendMessageSchema = z.object({
  rideId: z.string().min(1).max(120),
  content: z.string().trim().min(1).max(1000),
});

export function initSocketIO(server: any): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (config.allowedOrigins.includes(origin)) return callback(null, true);
        if (!config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  // Attach Redis adapter for horizontal scaling if Redis is configured
  if (config.redisUrl) {
    try {
      redisPubClient = new Redis(config.redisUrl);
      redisSubClient = redisPubClient.duplicate();
      redisPubClient.on('error', (err) => {
        logger.warn('[Socket.IO] Redis pubClient warning:', { error: err.message });
      });
      redisSubClient.on('error', (err) => {
        logger.warn('[Socket.IO] Redis subClient warning:', { error: err.message });
      });
      io.adapter(createAdapter(redisPubClient, redisSubClient));
      logger.info('[Socket.IO] Attached Redis adapter for multi-instance scaling.');
    } catch (err: any) {
      logger.warn('[Socket.IO] Failed to attach Redis adapter:', { error: err.message });
    }
  }

  // Handshake authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;
      const user = await db.findUserById(decoded.userId);
      if (!user || user.status === 'SUSPENDED') {
        return next(new Error('Unauthorized or account suspended'));
      }

      socket.user = {
        userId: user.id,
        email: user.email,
        role: user.role,
      };

      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const user = socket.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    logger.info(`[Socket] Connected: user=${user.userId}, role=${user.role}, socket=${socket.id}`);

    // Join private personal user room
    socket.join(`user:${user.userId}`);

    // Role-based rooms
    if (user.role === 'DRIVER') {
      socket.join('role:drivers');
    } else if (user.role === 'ADMIN') {
      socket.join('role:admins');
    }

    // Join Ride Room (with IDOR authorization verification)
    socket.on('ride:join', async (rawData: unknown) => {
      try {
        const parsed = rideRoomSchema.safeParse(rawData);
        if (!parsed.success) {
          socket.emit('error', { message: 'Invalid ride room payload' });
          return;
        }
        const { rideId } = parsed.data;
        const ride = await db.findRideById(rideId);
        if (!ride) {
          socket.emit('error', { message: 'Ride not found' });
          return;
        }

        const isRider = ride.riderId === user.userId;
        const driver = await db.findDriverByUserId(user.userId);
        const isDriver = Boolean(driver && ride.driverId === driver.id);
        const isAdmin = user.role === 'ADMIN';

        if (!isRider && !isDriver && !isAdmin) {
          socket.emit('error', { message: 'Unauthorized to join ride room' });
          return;
        }

        socket.join(`ride:${rideId}`);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Failed to join ride room' });
      }
    });

    // Leave Ride Room
    socket.on('ride:leave', (rawData: unknown) => {
      try {
        const parsed = rideRoomSchema.safeParse(rawData);
        if (!parsed.success) return;
        socket.leave(`ride:${parsed.data.rideId}`);
      } catch {
        // ignore invalid payload
      }
    });

    // Driver Location Update (Driver only, validated + anti-spoofing)
    socket.on('driver:location_update', async (rawData: unknown) => {
      try {
        if (user.role !== 'DRIVER') {
          socket.emit('error', { message: 'Only drivers can publish location updates' });
          return;
        }

        const parsed = driverLocationSchema.safeParse(rawData);
        if (!parsed.success) {
          socket.emit('location:rejected', { reason: 'INVALID_LOCATION_PAYLOAD' });
          return;
        }

        const driver = await db.findDriverByUserId(user.userId);
        if (!driver || driver.approvalStatus !== 'APPROVED' || !driver.isOnline) {
          return;
        }

        const result = await LocationService.processDriverLocationUpdate({
          driverId: driver.id,
          userId: user.userId,
          lat: parsed.data.lat,
          lng: parsed.data.lng,
          heading: parsed.data.heading,
          timestamp: parsed.data.timestamp,
          rideId: parsed.data.rideId,
        });

        if (!result.accepted && result.reason) {
          socket.emit('location:rejected', { reason: result.reason });
        }
      } catch (err: any) {
        logger.warn('[Socket] driver:location_update failed:', { error: err?.message, userId: user.userId });
      }
    });

    // In-Ride Chat Messaging
    socket.on('chat:send_message', async (rawData: unknown) => {
      try {
        const parsed = sendMessageSchema.safeParse(rawData);
        if (!parsed.success) {
          socket.emit('error', { message: 'Invalid chat message payload' });
          return;
        }

        const { rideId, content } = parsed.data;
        const ride = await db.findRideById(rideId);
        if (!ride) {
          socket.emit('error', { message: 'Ride not found' });
          return;
        }

        if (ride.status === 'CANCELLED' || ride.status === 'NO_DRIVER_FOUND') {
          socket.emit('error', { message: 'Chat is closed for cancelled or unmatched rides.' });
          return;
        }

        const driver = await db.findDriverByUserId(user.userId);
        const isRider = ride.riderId === user.userId;
        const isDriver = Boolean(driver && ride.driverId === driver.id);

        if (!isRider && !isDriver) {
          socket.emit('error', { message: 'Unauthorized: cannot send messages for this ride' });
          return;
        }

        const senderUser = await db.findUserById(user.userId);
        let recipientId = '';
        if (isRider && ride.driverId) {
          const assignedDriver = await db.findDriverById(ride.driverId);
          recipientId = assignedDriver?.userId || '';
        } else {
          recipientId = ride.riderId;
        }

        const message: IMessage = {
          id: generateId('msg'),
          rideId: ride.id,
          senderId: user.userId,
          senderName: senderUser?.name || 'User',
          recipientId,
          content,
          createdAt: new Date().toISOString(),
          read: false,
        };

        await db.createMessage(message);

        // Unified event name across Socket.IO and REST API
        io?.to(`ride:${ride.id}`).emit('chat:message_received', message);
      } catch (err: any) {
        socket.emit('error', { message: err?.message || 'Failed to send chat message' });
      }
    });

    socket.on('disconnect', () => {
      logger.info(`[Socket] Disconnected: user=${user.userId}`);
    });
  });

  return io;
}

export async function closeSocketIO(): Promise<void> {
  if (io) {
    await new Promise<void>((resolve) => {
      io!.close(() => resolve());
    });
    io = null;
    logger.info('[Socket.IO] Server closed.');
  }

  for (const client of [redisPubClient, redisSubClient]) {
    if (client) {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }
  }
  redisPubClient = null;
  redisSubClient = null;
}
