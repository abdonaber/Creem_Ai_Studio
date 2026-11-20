import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
      auth: (cb) => cb({ token: getAccessToken() }),
      autoConnect: Boolean(getAccessToken()),
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on('connect_error', (err) => {
      console.warn('[Socket.IO] Connection error:', err.message);
    });
  }
  return socket;
}

export function reconnectSocketWithToken(token: string): Socket {
  if (socket) {
    socket.auth = { token };
    socket.disconnect().connect();
  } else {
    socket = io(window.location.origin, {
      auth: (cb) => cb({ token: getAccessToken() || token }),
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
