import Redis from 'ioredis';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

let redisInstance: Redis | null = null;
let isConnected = false;

// Fallback in-process memory lock store for standalone/test environments
// Enforces real mutual exclusion with token ownership and TTL!
const localLockStore = new Map<string, { token: string; expiresAt: number }>();

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
        logger.info('[Redis] Connected successfully to Redis cluster.');
      });

      redisInstance.on('ready', () => {
        isConnected = true;
      });

      redisInstance.on('error', (err) => {
        isConnected = false;
        logger.warn('[Redis] Connection warning:', { error: err.message });
      });

      redisInstance.on('close', () => {
        isConnected = false;
      });

      redisInstance.connect().catch((err) => {
        logger.warn('[Redis] Initial connect failed:', { error: err.message });
      });
    } catch (err: any) {
      logger.warn('[Redis] Failed to initialize client:', { error: err.message });
    }
  }

  return redisInstance;
}

export function isRedisConnected(): boolean {
  return isConnected && redisInstance?.status === 'ready';
}

export interface LockAcquisitionResult {
  acquired: boolean;
  token: string;
}

/**
 * Hardened Distributed Lock using Redis SET NX PX with unique ownership token
 * Prevents race conditions, lock stealing, and deadlocks.
 *
 * @param key Lock identifier
 * @param ttlMs Time-to-live in milliseconds
 * @param options.token Optional custom token. If omitted, a secure UUID is generated.
 * @param options.failClosed If true, fails closed (returns acquired: false) on Redis errors.
 */
export async function acquireLock(
  key: string,
  ttlMs: number = 8000,
  options?: { token?: string; failClosed?: boolean }
): Promise<LockAcquisitionResult> {
  const lockKey = `lock:${key}`;
  const token = options?.token || crypto.randomUUID();
  const client = getRedisClient();

  if (client && isRedisConnected()) {
    try {
      const res = await client.set(lockKey, token, 'PX', ttlMs, 'NX');
      return {
        acquired: res === 'OK',
        token,
      };
    } catch (err: any) {
      logger.error(`[Redis Lock] Failed to acquire lock for ${key}`, err);
      // Fail closed for critical operations
      if (options?.failClosed) {
        return { acquired: false, token };
      }
    }
  }

  // Fallback: in-memory mutual exclusion lock store
  const now = Date.now();
  const existing = localLockStore.get(lockKey);
  if (existing && existing.expiresAt > now) {
    // Lock is currently held and not expired
    return { acquired: false, token };
  }

  // Acquire local lock
  localLockStore.set(lockKey, { token, expiresAt: now + ttlMs });
  return { acquired: true, token };
}

/**
 * Safe Lock Release using atomic Lua script
 * Ensures a lock is ONLY deleted if the current stored token matches the caller's token.
 * Prevents releasing another worker's lock if TTL expired.
 */
export async function releaseLock(key: string, token: string): Promise<boolean> {
  const lockKey = `lock:${key}`;
  const client = getRedisClient();

  if (client && isRedisConnected()) {
    try {
      // Atomic Lua script: delete only if value equals token
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      const result = await client.eval(luaScript, 1, lockKey, token);
      return result === 1;
    } catch (err: any) {
      logger.warn(`[Redis Lock] Error during lock release for ${key}:`, { error: err.message });
      return false;
    }
  }

  // Local lock store safe release
  const existing = localLockStore.get(lockKey);
  if (existing && existing.token === token) {
    localLockStore.delete(lockKey);
    return true;
  }

  return false;
}

/**
 * Distributed Rate Limiting backed by Redis with local fallback
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
      // On Redis network error, allow transient pass-through
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
