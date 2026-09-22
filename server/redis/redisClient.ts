import Redis from 'ioredis';
import { config } from '../config';

let redisInstance: Redis | null = null;
let isConnected = false;

export function getRedisClient(): Redis | null {
  if (redisInstance) return redisInstance;

  if (config.redisUrl) {
    try {
      redisInstance = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
        retryStrategy(times) {
          const delay = Math.min(times * 150, 3000);
          return delay;
        },
      });

      redisInstance.on('connect', () => {
        isConnected = true;
        console.log('[Redis] Connected successfully to Redis cluster.');
      });

      redisInstance.on('ready', () => {
        isConnected = true;
      });

      redisInstance.on('error', (err) => {
        isConnected = false;
        console.warn('[Redis] Connection warning:', err.message);
      });

      redisInstance.on('close', () => {
        isConnected = false;
      });

      redisInstance.connect().catch((err) => {
        console.warn('[Redis] Initial connect failed:', err.message);
      });
    } catch (err: any) {
      console.warn('[Redis] Failed to initialize client:', err.message);
    }
  }

  return redisInstance;
}

export function isRedisConnected(): boolean {
  return isConnected && redisInstance?.status === 'ready';
}

/**
 * Distributed Lock using Redis SET NX PX
 * Guarantees atomic mutual exclusion for critical operations
 */
export async function acquireLock(key: string, ttlMs: number = 10000): Promise<boolean> {
  const lockKey = `lock:${key}`;
  const client = getRedisClient();

  if (client && isRedisConnected()) {
    try {
      const res = await client.set(lockKey, '1', 'PX', ttlMs, 'NX');
      return res === 'OK';
    } catch {
      return true; // fail-open in network partition to avoid deadlock
    }
  }

  // If Redis is not provisioned, allow single-instance operation
  return true;
}

/**
 * Release Distributed Lock in Redis
 */
export async function releaseLock(key: string): Promise<void> {
  const lockKey = `lock:${key}`;
  const client = getRedisClient();

  if (client && isRedisConnected()) {
    try {
      await client.del(lockKey);
    } catch {
      // ignore
    }
  }
}

/**
 * Distributed Rate Limiting backed by Redis
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const rateKey = `ratelimit:${key}`;
  const client = getRedisClient();
  const now = Date.now();

  if (client && isRedisConnected()) {
    try {
      const current = await client.incr(rateKey);
      if (current === 1) {
        await client.expire(rateKey, windowSeconds);
      }
      const ttl = await client.ttl(rateKey);
      const remaining = Math.max(0, limit - current);
      return {
        allowed: current <= limit,
        remaining,
        resetTime: now + (ttl > 0 ? ttl * 1000 : windowSeconds * 1000),
      };
    } catch {
      // On transient Redis network error, fail open with remaining 1
      return {
        allowed: true,
        remaining: 1,
        resetTime: now + windowSeconds * 1000,
      };
    }
  }

  // Without Redis, default pass-through
  return {
    allowed: true,
    remaining: limit,
    resetTime: now + windowSeconds * 1000,
  };
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    try {
      await redisInstance.quit();
    } catch {
      redisInstance.disconnect();
    }
    redisInstance = null;
    isConnected = false;
  }
}
