import { Queue, Worker, Job, UnrecoverableError } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

export { UnrecoverableError };

export interface RideDispatchJobData {
  rideId: string;
}

export interface OfferExpirationJobData {
  rideId: string;
  offerId: string;
}

export interface SearchRetryJobData {
  rideId: string;
  radiusKm: number;
  retryCount: number;
}

export interface NotificationJobData {
  userId: string;
  title: string;
  body: string;
  type: string;
  metadata?: Record<string, unknown>;
}

// Queue Names
export const QUEUE_RIDE_DISPATCH = 'ride-dispatch';
export const QUEUE_OFFER_EXPIRATION = 'ride-offer-expiration';
export const QUEUE_SEARCH_RETRY = 'ride-search-retry';
export const QUEUE_NOTIFICATION_DISPATCH = 'notification-dispatch';

export class QueueManager {
  private static sharedRedisConnection: Redis | null = null;
  private static isInitialized = false;
  private static isRedisAvailable = false;
  private static isShuttingDown = false;

  // Queues
  public static rideDispatchQueue: Queue<RideDispatchJobData> | null = null;
  public static offerExpirationQueue: Queue<OfferExpirationJobData> | null = null;
  public static searchRetryQueue: Queue<SearchRetryJobData> | null = null;
  public static notificationQueue: Queue<NotificationJobData> | null = null;

  // Workers
  private static rideDispatchWorker: Worker<RideDispatchJobData> | null = null;
  private static offerExpirationWorker: Worker<OfferExpirationJobData> | null = null;
  private static searchRetryWorker: Worker<SearchRetryJobData> | null = null;
  private static notificationWorker: Worker<NotificationJobData> | null = null;

  // Worker handlers injected from DispatchService
  private static dispatchHandler?: (rideId: string) => Promise<void>;
  private static offerTimeoutHandler?: (rideId: string, offerId: string) => Promise<void>;
  private static searchRetryHandler?: (rideId: string, radiusKm: number) => Promise<void>;
  private static notificationHandler?: (data: NotificationJobData) => Promise<void>;

  /**
   * Registers processing handlers for queues
   */
  public static registerHandlers(handlers: {
    onDispatch: (rideId: string) => Promise<void>;
    onOfferTimeout: (rideId: string, offerId: string) => Promise<void>;
    onSearchRetry: (rideId: string, radiusKm: number) => Promise<void>;
    onNotification?: (data: NotificationJobData) => Promise<void>;
  }): void {
    this.dispatchHandler = handlers.onDispatch;
    this.offerTimeoutHandler = handlers.onOfferTimeout;
    this.searchRetryHandler = handlers.onSearchRetry;
    this.notificationHandler = handlers.onNotification;
  }

  /**
   * Returns BullMQ-compatible Redis connection options or null if unconfigured
   */
  private static getRedisConnection(): Redis | null {
    if (this.sharedRedisConnection) {
      return this.sharedRedisConnection;
    }

    if (!config.redisUrl) {
      return null;
    }

    try {
      this.sharedRedisConnection = new Redis(config.redisUrl, {
        maxRetriesPerRequest: null, // Required by BullMQ
        enableReadyCheck: false,
        lazyConnect: true,
        retryStrategy(times) {
          const delay = Math.min(times * 200, 3000);
          return delay;
        },
      });

      this.sharedRedisConnection.on('connect', () => {
        this.isRedisAvailable = true;
        logger.info('[BullMQ] Redis connection established.');
      });

      this.sharedRedisConnection.on('error', (err) => {
        this.isRedisAvailable = false;
        logger.warn(`[BullMQ] Redis error: ${err.message}`);
      });

      this.sharedRedisConnection.on('close', () => {
        this.isRedisAvailable = false;
      });

      this.sharedRedisConnection.connect().catch((err) => {
        logger.warn(`[BullMQ] Initial Redis connection failed: ${err.message}`);
      });

      return this.sharedRedisConnection;
    } catch (err: any) {
      logger.warn(`[BullMQ] Failed to configure Redis: ${err.message}`);
      return null;
    }
  }

  /**
   * Initialize Queues and Workers
   */
  public static async init(): Promise<void> {
    if (this.isInitialized) return;

    const redis = this.getRedisConnection();
    if (!redis) {
      logger.info('[BullMQ] Redis not configured. Queue system operating in direct/fallback execution mode.');
      this.isInitialized = true;
      return;
    }

    try {
      const defaultJobOptions = {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      };

      // 1. Initialize Queues
      this.rideDispatchQueue = new Queue<RideDispatchJobData>(QUEUE_RIDE_DISPATCH, {
        connection: redis,
        defaultJobOptions,
      });

      this.offerExpirationQueue = new Queue<OfferExpirationJobData>(QUEUE_OFFER_EXPIRATION, {
        connection: redis,
        defaultJobOptions,
      });

      this.searchRetryQueue = new Queue<SearchRetryJobData>(QUEUE_SEARCH_RETRY, {
        connection: redis,
        defaultJobOptions,
      });

      this.notificationQueue = new Queue<NotificationJobData>(QUEUE_NOTIFICATION_DISPATCH, {
        connection: redis,
        defaultJobOptions,
      });

      // 2. Initialize Workers
      this.rideDispatchWorker = new Worker<RideDispatchJobData>(
        QUEUE_RIDE_DISPATCH,
        async (job: Job<RideDispatchJobData>) => {
          logger.info(`[Worker:Dispatch] Processing ride dispatch job ${job.id} for ride ${job.data.rideId}`);
          if (this.dispatchHandler) {
            await this.dispatchHandler(job.data.rideId);
          }
        },
        {
          connection: redis,
          concurrency: 5,
          lockDuration: 30000,
          maxStalledCount: 2,
        }
      );

      this.offerExpirationWorker = new Worker<OfferExpirationJobData>(
        QUEUE_OFFER_EXPIRATION,
        async (job: Job<OfferExpirationJobData>) => {
          logger.info(
            `[Worker:OfferExpiration] Processing expiration job ${job.id} for offer ${job.data.offerId}`
          );
          if (this.offerTimeoutHandler) {
            await this.offerTimeoutHandler(job.data.rideId, job.data.offerId);
          }
        },
        {
          connection: redis,
          concurrency: 10,
          lockDuration: 15000,
          maxStalledCount: 2,
        }
      );

      this.searchRetryWorker = new Worker<SearchRetryJobData>(
        QUEUE_SEARCH_RETRY,
        async (job: Job<SearchRetryJobData>) => {
          logger.info(
            `[Worker:SearchRetry] Processing search retry job ${job.id} for ride ${job.data.rideId} at ${job.data.radiusKm}km`
          );
          if (this.searchRetryHandler) {
            await this.searchRetryHandler(job.data.rideId, job.data.radiusKm);
          }
        },
        {
          connection: redis,
          concurrency: 5,
          lockDuration: 30000,
          maxStalledCount: 2,
        }
      );

      this.notificationWorker = new Worker<NotificationJobData>(
        QUEUE_NOTIFICATION_DISPATCH,
        async (job: Job<NotificationJobData>) => {
          if (this.notificationHandler) {
            await this.notificationHandler(job.data);
          }
        },
        {
          connection: redis,
          concurrency: 10,
          lockDuration: 10000,
        }
      );

      // 3. Worker Error and Life-cycle listeners
      const workers = [
        { name: 'RideDispatch', worker: this.rideDispatchWorker },
        { name: 'OfferExpiration', worker: this.offerExpirationWorker },
        { name: 'SearchRetry', worker: this.searchRetryWorker },
        { name: 'Notification', worker: this.notificationWorker },
      ];

      for (const { name, worker } of workers) {
        worker.on('failed', (job, err) => {
          logger.error(`[Worker:${name}] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err);
        });

        worker.on('error', (err) => {
          logger.warn(`[Worker:${name}] Internal worker error:`, { error: err.message });
        });

        worker.on('stalled', (jobId) => {
          logger.warn(`[Worker:${name}] Job ${jobId} stalled and will be re-processed.`);
        });
      }

      this.isInitialized = true;
      logger.info('[BullMQ] All dispatch queues and horizontal workers initialized successfully.');
    } catch (err: any) {
      logger.error('[BullMQ] Failed to start queue system:', err);
    }
  }

  /**
   * Enqueue a ride dispatch job
   */
  public static async enqueueRideDispatch(rideId: string): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('QUEUE_SHUTTING_DOWN: Cannot enqueue ride dispatch during shutdown.');
    }

    if (this.rideDispatchQueue && this.isRedisAvailable) {
      await this.rideDispatchQueue.add(
        'dispatch-ride',
        { rideId },
        {
          jobId: `dispatch_${rideId}`,
          attempts: 3,
        }
      );
    } else if (config.isProduction) {
      logger.error(`[BullMQ] Redis is unavailable in production. Cannot enqueue ride dispatch for ${rideId}.`);
      throw new Error(`QUEUE_UNAVAILABLE_PRODUCTION: Cannot enqueue ride dispatch in production without active Redis.`);
    } else if (this.dispatchHandler) {
      // Fallback allowed ONLY in local non-production/test environments
      setImmediate(() => {
        this.dispatchHandler!(rideId).catch((err) => {
          logger.error(`[Dispatch Direct] Execution failed for ride ${rideId}`, err);
        });
      });
    }
  }

  /**
   * Schedule a delayed offer expiration job (e.g. 25 seconds)
   */
  public static async scheduleOfferExpiration(
    rideId: string,
    offerId: string,
    delayMs: number = 25000
  ): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('QUEUE_SHUTTING_DOWN: Cannot schedule offer expiration during shutdown.');
    }

    if (this.offerExpirationQueue && this.isRedisAvailable) {
      await this.offerExpirationQueue.add(
        'expire-offer',
        { rideId, offerId },
        {
          delay: delayMs,
          jobId: `expire_${offerId}`,
          attempts: 2,
        }
      );
    } else if (config.isProduction) {
      logger.error(`[BullMQ] Redis is unavailable in production. Cannot schedule offer expiration for ${offerId}.`);
      throw new Error(`QUEUE_UNAVAILABLE_PRODUCTION: Cannot schedule offer expiration in production without active Redis.`);
    } else if (this.offerTimeoutHandler) {
      // Fallback allowed ONLY in local non-production/test environments
      setTimeout(() => {
        this.offerTimeoutHandler!(rideId, offerId).catch((err) => {
          logger.error(`[Offer Timeout Direct] Failed for offer ${offerId}`, err);
        });
      }, delayMs);
    }
  }

  /**
   * Enqueue a search radius expansion or retry
   */
  public static async enqueueSearchRetry(
    rideId: string,
    radiusKm: number,
    retryCount: number,
    delayMs: number = 0
  ): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('QUEUE_SHUTTING_DOWN: Cannot enqueue search retry during shutdown.');
    }

    if (this.searchRetryQueue && this.isRedisAvailable) {
      await this.searchRetryQueue.add(
        'retry-search',
        { rideId, radiusKm, retryCount },
        {
          delay: delayMs,
          jobId: `retry_${rideId}_${radiusKm}_${retryCount}`,
          attempts: 3,
        }
      );
    } else if (config.isProduction) {
      logger.error(`[BullMQ] Redis is unavailable in production. Cannot enqueue search retry for ride ${rideId}.`);
      throw new Error(`QUEUE_UNAVAILABLE_PRODUCTION: Cannot enqueue search retry in production without active Redis.`);
    } else if (this.searchRetryHandler) {
      // Fallback allowed ONLY in local non-production/test environments
      setTimeout(() => {
        this.searchRetryHandler!(rideId, radiusKm).catch((err) => {
          logger.error(`[Search Retry Direct] Failed for ride ${rideId}`, err);
        });
      }, delayMs);
    }
  }

  /**
   * Enqueue notification dispatch
   */
  public static async enqueueNotification(data: NotificationJobData): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('QUEUE_SHUTTING_DOWN: Cannot enqueue notification during shutdown.');
    }

    if (this.notificationQueue && this.isRedisAvailable) {
      await this.notificationQueue.add('send-notification', data, {
        attempts: 3,
      });
    } else if (config.isProduction) {
      logger.error(`[BullMQ] Redis is unavailable in production. Cannot enqueue notification for user ${data.userId}.`);
      throw new Error(`QUEUE_UNAVAILABLE_PRODUCTION: Cannot enqueue notification in production without active Redis.`);
    } else if (this.notificationHandler) {
      // Fallback allowed ONLY in local non-production/test environments
      setImmediate(() => {
        this.notificationHandler!(data).catch((err) => {
          logger.error(`[Notification Direct] Failed for user ${data.userId}`, err);
        });
      });
    }
  }

  /**
   * Get queue depths and health metrics
   */
  public static async getQueueMetrics(): Promise<Record<string, unknown>> {
    if (!this.isInitialized || !this.isRedisAvailable) {
      return { status: 'fallback_mode', isRedisAvailable: this.isRedisAvailable };
    }

    try {
      const [dispatchWaiting, expirationWaiting, retryWaiting] = await Promise.all([
        this.rideDispatchQueue ? this.rideDispatchQueue.getWaitingCount() : 0,
        this.offerExpirationQueue ? this.offerExpirationQueue.getDelayedCount() : 0,
        this.searchRetryQueue ? this.searchRetryQueue.getWaitingCount() : 0,
      ]);

      return {
        status: 'active',
        dispatchWaiting,
        expirationDelayed: expirationWaiting,
        retryWaiting,
      };
    } catch (err: any) {
      return { status: 'error', error: err.message };
    }
  }

  /**
   * Gracefully close all workers and queues (SIGTERM/SIGINT)
   */
  public static async close(): Promise<void> {
    this.isShuttingDown = true;
    logger.info('[BullMQ] Gracefully shutting down queues and workers...');


    const workers = [
      this.rideDispatchWorker,
      this.offerExpirationWorker,
      this.searchRetryWorker,
      this.notificationWorker,
    ];

    for (const worker of workers) {
      if (worker) {
        try {
          await worker.close();
        } catch (err: any) {
          logger.warn(`[BullMQ] Error closing worker: ${err.message}`);
        }
      }
    }

    const queues = [
      this.rideDispatchQueue,
      this.offerExpirationQueue,
      this.searchRetryQueue,
      this.notificationQueue,
    ];

    for (const queue of queues) {
      if (queue) {
        try {
          await queue.close();
        } catch (err: any) {
          logger.warn(`[BullMQ] Error closing queue: ${err.message}`);
        }
      }
    }

    if (this.sharedRedisConnection) {
      try {
        await this.sharedRedisConnection.quit();
      } catch {
        // ignore
      }
      this.sharedRedisConnection = null;
    }

    this.isInitialized = false;
    this.isRedisAvailable = false;
    logger.info('[BullMQ] All queues and workers gracefully terminated.');
  }
}
