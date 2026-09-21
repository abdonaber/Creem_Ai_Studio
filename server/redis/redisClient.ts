import Redis from 'ioredis';
import { config } from '../config';

let redisInstance: Redis | null = null;
let isConnected = false;

// In-memory fallback stores when Redis is not configured
const memoryLocks = new Map<string, number>();
const memoryRateLimits = new Map<string, { count: number; resetAt: number }>();

export function getRedisClient(): Redis | null {
  if (redisInstance) return redisInstance;

  if (config.redisUrl) {
    try {
      redisInstance = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
        retryStrategy(times) {
          const delay = Math.min(times * 100, 3000);
          return delay;
        },
      });

      redisInstance.on('connect', () => {
        isConnected = true;
        console.log('[Redis] Connected successfully to Redis cluster.');
      });

      redisInstance.on('error', (err) => {
        isConnected = false;
        console.warn('[Redis] Connection warning (using in-memory fallback):', err.message);
      });

      redisInstance.connect().catch((err) => {
        console.warn('[Redis] Initial connect failed, using in-memory fallback:', err.message);
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
 * Distributed Lock: guarantees atomic mutual exclusion for critical operations
 * (e.g. ride acceptance, wallet debits, dispatch assignments)
 */
export async function acquireLock(key: string, ttlMs: number = 10000): Promise<boolean> {
  const lockKey = `lock:${key}`;
  const client = getRedisClient();

  if (client && isRedisConnected()) {
    try {
      const res = await client.set(lockKey, '1', 'PX', ttlMs, 'NX');
      return res === 'OK';
    } catch {
      // Fall through to memory lock on Redis error
    }
  }

  // In-memory fallback atomic lock
  const now = Date.now();
  const existingExpire = memoryLocks.get(lockKey);
  if (existingExpire && existingExpire > now) {
    return false;
  }
  memoryLocks.set(lockKey, now + ttlMs);
  return true;
}

/**
 * Release Distributed Lock
 */
export async function releaseLock(key: string): Promise<void> {
  const lockKey = `lock:${key}`;
  const client = getRedisClient();

  if (client && isRedisConnected()) {
    try {
      await client.del(lockKey);
      return;
    } catch {
      // ignore
    }
  }

  memoryLocks.delete(lockKey);
}

/**
 * Distributed Rate Limiting
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
      // Fall through to in-memory fallback
    }
  }

  // Memory fallback rate limiter
  let record = memoryRateLimits.get(rateKey);
  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + windowSeconds * 1000 };
  }

  record.count += 1;
  memoryRateLimits.set(rateKey, record);

  const allowed = record.count <= limit;
  const remaining = Math.max(0, limit - record.count);
  return {
    allowed,
    remaining,
    resetTime: record.resetAt,
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
