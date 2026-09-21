import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db/store';
import { AuthPayload } from '../middleware/auth';
import { IMessage } from '../types';

export let io: SocketIOServer | null = null;

interface AuthenticatedSocket extends Socket {
  user?: AuthPayload;
}

export function initSocketIO(server: any): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: config.corsOrigin === '*' ? true : config.corsOrigin,
      credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

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

    console.log(`[Socket] Connected: user=${user.userId}, role=${user.role}, socket=${socket.id}`);

    // Join private personal user room
    socket.join(`user:${user.userId}`);

    // Role-based rooms
    if (user.role === 'DRIVER') {
      socket.join('role:drivers');
    } else if (user.role === 'ADMIN') {
      socket.join('role:admins');
    }

    // Join Ride Room (with IDOR authorization verification)
    socket.on('ride:join', async (data: { rideId: string }) => {
      try {
        const ride = await db.findRideById(data.rideId);
        if (!ride) {
          socket.emit('error', { message: 'Ride not found' });
          return;
        }

        // Check access permission
        const isRider = ride.riderId === user.userId;
        const driver = await db.findDriverByUserId(user.userId);
        const isDriver = driver && ride.driverId === driver.id;
        const isAdmin = user.role === 'ADMIN';

        if (!isRider && !isDriver && !isAdmin) {
          socket.emit('error', { message: 'Unauthorized to join ride room' });
          return;
        }

        socket.join(`ride:${data.rideId}`);
      } catch (err: any) {
        socket.emit('error', { message: err.message });
      }
    });

    // Leave Ride Room
    socket.on('ride:leave', (data: { rideId: string }) => {
      socket.leave(`ride:${data.rideId}`);
    });

    // Driver Location Update (Driver only, strictly authenticated)
    socket.on('driver:location_update', async (data: { lat: number; lng: number; heading?: number }) => {
      if (user.role !== 'DRIVER') {
        socket.emit('error', { message: 'Only drivers can publish location updates' });
        return;
      }

      const driver = await db.findDriverByUserId(user.userId);
      if (!driver || driver.approvalStatus !== 'APPROVED' || !driver.isOnline) {
        return;
      }

      // Payload coordinate bounds check
      if (
        typeof data.lat !== 'number' ||
        typeof data.lng !== 'number' ||
        data.lat < -90 ||
        data.lat > 90 ||
        data.lng < -180 ||
        data.lng > 180
      ) {
        return;
      }

      const updatedLoc = {
        lat: data.lat,
        lng: data.lng,
        heading: data.heading || 0,
        updatedAt: new Date().toISOString(),
      };

      await db.updateDriver(driver.id, { currentLocation: updatedLoc });

      // If driver is currently on an active ride, update and broadcast to the ride room
      const allDriverRides = await db.getRidesByDriverId(driver.id);
      const activeRides = allDriverRides.filter((r) =>
        ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'].includes(r.status)
      );

      for (const ride of activeRides) {
        await db.updateRide(ride.id, { currentDriverLocation: { lat: data.lat, lng: data.lng } });
        io?.to(`ride:${ride.id}`).emit('driver:moved', {
          rideId: ride.id,
          location: updatedLoc,
        });
      }

      // Broadcast to admins for live fleet map
      io?.to('role:admins').emit('driver:fleet_location', {
        driverId: driver.id,
        location: updatedLoc,
      });
    });

    // In-Ride Chat Messaging
    socket.on('chat:send_message', async (data: { rideId: string; content: string }) => {
      if (!data.content || !data.content.trim()) return;

      const ride = await db.findRideById(data.rideId);
      if (!ride) return;

      const driver = await db.findDriverByUserId(user.userId);
      const isRider = ride.riderId === user.userId;
      const isDriver = driver && ride.driverId === driver.id;

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
        id: 'msg_' + Math.random().toString(36).substring(2, 9),
        rideId: ride.id,
        senderId: user.userId,
        senderName: senderUser?.name || 'User',
        recipientId,
        content: data.content.trim().slice(0, 1000),
        createdAt: new Date().toISOString(),
        read: false,
      };

      await db.createMessage(message);

      // Broadcast to ride room
      io?.to(`ride:${ride.id}`).emit('chat:message_received', message);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: user=${user.userId}`);
    });
  });

  return io;
}
