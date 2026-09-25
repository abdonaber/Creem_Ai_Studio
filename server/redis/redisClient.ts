import Redis from 'ioredis';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

let redisInstance: Redis | null = null;
let isConnected = false;

// Fallback in-process memory lock store for standalone/test environments
// Enforces real mutual exclusion with token ownership and TTL!
const localLockStore = new Map<string, { token: string; expiresAt: number }>();
const localRateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function isCriticalOperationKey(key: string): boolean {
  return (
    key.startsWith('driver_reservation:') ||
    key.startsWith('ride_claim:') ||
    key.startsWith('ride_transition:') ||
    key.startsWith('financial:') ||
    key.startsWith('wallet:') ||
    key.startsWith('payment:') ||
    key.startsWith('stripe_webhook:') ||
    key.startsWith('idempotency:') ||
    key.startsWith('rate_limit_auth:') ||
    key.startsWith('rate_limit_login:') ||
    key.startsWith('rate_limit_register:')
  );
}

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

export interface LockOptions {
  token?: string;
  failClosed?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface LockAcquisitionResult {
  acquired: boolean;
  token?: string;
  reason?: string;
}

/**
 * Hardened Distributed Lock using Redis SET NX PX with unique ownership token.
 * For critical paths (financial settlement, driver reservation, atomic dispatch),
 * this strictly fails-closed to prevent split-brain race conditions when Redis is unavailable.
 */
export async function acquireLock(
  key: string,
  ttlMs: number = 8000,
  options?: LockOptions
): Promise<LockAcquisitionResult> {
  const lockKey = `lock:${key}`;
  const token = options?.token || crypto.randomUUID();
  const client = getRedisClient();

  // If Redis is configured in production or explicitly required
  const isCriticalKey = isCriticalOperationKey(key);
  const mustFailClosed = options?.failClosed ?? (Boolean(config.redisUrl) && isCriticalKey);

  if (client && isRedisConnected()) {
    try {
      const res = await client.set(lockKey, token, 'PX', ttlMs, 'NX');
      return {
        acquired: res === 'OK',
        token,
      };
    } catch (err: any) {
      logger.error(`[Redis Lock] Failed to acquire lock for ${key}`, err);
      if (mustFailClosed) {
        return { acquired: false, token };
      }
    }
  } else if (config.redisUrl && mustFailClosed) {
    // Redis is configured for distributed cluster but connection is down:
    // Strictly fail-closed for critical locks across instances to prevent double claims!
    logger.warn(`[Redis Lock] Redis cluster unavailable; failing closed for lock ${key}`);
    return { acquired: false, token, reason: 'REDIS_CLUSTER_UNAVAILABLE' };
  }

  // In production, localLockStore is strictly forbidden for critical operations to prevent split-brain states
  if (config.isProduction) {
    logger.error(`[Redis Lock] In-memory localLockStore fallback is strictly forbidden in production for key [${key}]`);
    return { acquired: false, token, reason: 'REDIS_REQUIRED_IN_PRODUCTION' };
  }

  // Fallback: in-process mutual exclusion lock store for isolated/unit test runtimes
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
 * Safe Lock Renewal using atomic Lua script
 * Extends the TTL only if current stored value matches the caller's token.
 */
export async function renewLock(
  key: string,
  token: string,
  additionalTtlMs: number = 5000
): Promise<boolean> {
  const lockKey = `lock:${key}`;
  const client = getRedisClient();

  if (client && isRedisConnected()) {
    try {
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("pexpire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      const result = await client.eval(luaScript, 1, lockKey, token, additionalTtlMs);
      return result === 1;
    } catch (err: any) {
      logger.warn(`[Redis Lock] Error during lock renewal for ${key}:`, { error: err.message });
      return false;
    }
  }

  const existing = localLockStore.get(lockKey);
  if (existing && existing.token === token) {
    existing.expiresAt = Date.now() + additionalTtlMs;
    return true;
  }

  return false;
}

/**
 * Acquire lock with automatic retries, exponential backoff, and random jitter
 */
export async function acquireLockWithRetry(
  key: string,
  ttlMs: number = 8000,
  maxRetries: number = 3,
  initialDelayMs: number = 100,
  options?: LockOptions
): Promise<LockAcquisitionResult> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    const result = await acquireLock(key, ttlMs, options);
    if (result.acquired) {
      return result;
    }
    attempt++;
    if (attempt <= maxRetries) {
      // Exponential backoff with random jitter between 0 and 50ms
      const jitter = crypto.randomInt(0, 50);
      const delay = initialDelayMs * Math.pow(2, attempt - 1) + jitter;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  return { acquired: false, token: options?.token || crypto.randomUUID() };
}

/**
 * Executes a critical async function exclusively within a distributed lock
 */
export async function executeWithLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  options?: LockOptions
): Promise<T> {
  const lock = await acquireLockWithRetry(
    key,
    ttlMs,
    options?.maxRetries ?? 2,
    options?.retryDelayMs ?? 100,
    options
  );

  if (!lock.acquired) {
    throw new Error(`CONCURRENCY_LOCK_FAILED: Unable to acquire distributed lock for resource [${key}].`);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(key, lock.token);
  }
}

/**
 * Safe Lock Release using atomic Lua script
 * Ensures a lock is ONLY deleted if the current stored token matches the caller's token.
 * Prevents releasing another worker's lock if TTL expired.
 */
export async function releaseLock(key: string, token?: string): Promise<boolean> {
  if (!token) return true;
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
 * Distributed Idempotency Key Claim
 * For critical financial and webhook operations:
 * Strictly fails closed if Redis is down in production or when failClosed is required.
 */
export async function claimIdempotencyKey(
  key: string,
  ttlSeconds: number = 300,
  options?: { failClosed?: boolean }
): Promise<{ claimed: boolean; reason?: string }> {
  const claimKey = `idempotency:${key}`;
  const client = getRedisClient();
  const mustFailClosed = options?.failClosed ?? (Boolean(config.redisUrl) && isCriticalOperationKey(claimKey));

  if (client && isRedisConnected()) {
    try {
      const res = await client.set(claimKey, 'CLAIMED', 'EX', ttlSeconds, 'NX');
      return { claimed: res === 'OK' };
    } catch (err: any) {
      logger.error(`[Redis Idempotency] Failed to claim key ${key}:`, err);
      if (mustFailClosed) {
        return { claimed: false, reason: 'REDIS_OUTAGE_FAIL_CLOSED' };
      }
    }
  } else if (config.redisUrl && mustFailClosed) {
    logger.warn(`[Redis Idempotency] Redis cluster down; failing closed for idempotency key ${key}`);
    return { claimed: false, reason: 'REDIS_OUTAGE_FAIL_CLOSED' };
  }

  // In production, local in-memory store is strictly forbidden
  if (config.isProduction) {
    logger.error(`[Redis Idempotency] In-memory idempotency claim forbidden in production for key [${key}]`);
    return { claimed: false, reason: 'REDIS_REQUIRED_IN_PRODUCTION' };
  }

  // Fallback for standalone/test environments: in-process memory store
  const now = Date.now();
  const existing = localLockStore.get(claimKey);
  if (existing && existing.expiresAt > now) {
    return { claimed: false, reason: 'ALREADY_CLAIMED' };
  }

  localLockStore.set(claimKey, { token: 'CLAIMED', expiresAt: now + ttlSeconds * 1000 });
  return { claimed: true };
}

/**
 * Distributed Rate Limiting backed by Redis with safe, controlled fallback
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options?: { isSecurityEndpoint?: boolean; failClosed?: boolean }
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const rateKey = `ratelimit:${key}`;
  const client = getRedisClient();
  const now = Date.now();
  const isSecurity = options?.isSecurityEndpoint ?? isCriticalOperationKey(key);
  const mustFailClosed = options?.failClosed ?? false;

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
      // If critical security endpoint (e.g. login brute force) and failClosed requested, fail closed
      if (isSecurity && mustFailClosed) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: now + windowSeconds * 1000,
        };
      }
    }
  } else if (config.redisUrl && isSecurity && mustFailClosed) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: now + windowSeconds * 1000,
    };
  }

  // In production, local rate limiting store fallback is forbidden for security endpoints
  if (config.isProduction && (isSecurity || mustFailClosed)) {
    logger.warn(`[Redis RateLimit] Redis cluster unavailable in production for security key [${key}]. Failing closed.`);
    return {
      allowed: false,
      remaining: 0,
      resetTime: now + windowSeconds * 1000,
    };
  }


  // Local in-memory bounded rate limiter fallback for testing and transient degraded states
  const local = localRateLimitStore.get(rateKey);
  if (!local || local.resetTime < now) {
    localRateLimitStore.set(rateKey, { count: 1, resetTime: now + windowSeconds * 1000 });
    return {
      allowed: true,
      remaining: limit - 1,
      resetTime: now + windowSeconds * 1000,
    };
  }

  local.count++;
  const allowed = local.count <= limit;
  const remaining = Math.max(0, limit - local.count);
  return {
    allowed,
    remaining,
    resetTime: local.resetTime,
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
