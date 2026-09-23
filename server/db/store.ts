import mongoose from 'mongoose';
import { acquireLock, releaseLock, LockAcquisitionResult } from '../redis/redisClient';
import {
  UserModel,
  DriverModel,
  VehicleModel,
  RideModel,
  RideOfferModel,
  WalletModel,
  WalletTransactionModel,
  PaymentModel,
  RatingModel,
  MessageModel,
  NotificationModel,
  AuditLogModel,
  RefreshSessionModel,
  WebhookEventModel,
  PlatformLedgerModel,
} from '../models/mongoSchemas';
import { isDbConnected } from './connection';
import {
  IUser,
  IDriver,
  IVehicle,
  IRide,
  IRideOffer,
  IWallet,
  IWalletTransaction,
  IRating,
  IMessage,
  INotification,
  IAuditLog,
  IPayment,
  IPlatformLedger,
  RideStatus,
  VehicleCategory,
} from '../types';
import { AppError } from '../middleware/errorHandler';

export interface IRefreshSession {
  id: string;
  userId: string;
  jti: string;
  tokenHash: string;
  revoked: boolean;
  revokedReason?: string;
  expiresAt: string;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}

export interface IDatabaseStore {
  // User Operations
  findUserById(id: string): Promise<IUser | null>;
  findUserByEmail(email: string): Promise<IUser | null>;
  findUserByPhone(phone: string): Promise<IUser | null>;
  createUser(user: Partial<IUser>): Promise<IUser>;
  updateUser(id: string, updates: Partial<IUser>): Promise<IUser | null>;
  getAllUsers(): Promise<IUser[]>;

  // Driver & Vehicle Operations
  findDriverById(id: string): Promise<IDriver | null>;
  findDriverByUserId(userId: string): Promise<IDriver | null>;
  createDriver(driver: Partial<IDriver>): Promise<IDriver>;
  updateDriver(id: string, updates: Partial<IDriver>): Promise<IDriver | null>;
  getOnlineApprovedDrivers(): Promise<IDriver[]>;
  getAllDrivers(): Promise<IDriver[]>;
  findVehicleByDriverId(driverId: string): Promise<IVehicle | null>;
  createVehicle(vehicle: Partial<IVehicle>): Promise<IVehicle>;
  updateVehicle(driverId: string, updates: Partial<IVehicle>): Promise<IVehicle | null>;

  // Ride Operations
  createRide(ride: Partial<IRide>): Promise<IRide>;
  findRideById(id: string): Promise<IRide | null>;
  updateRide(id: string, updates: Partial<IRide>): Promise<IRide | null>;
  findActiveRideForUser(userId: string): Promise<IRide | null>;
  getRidesByRiderId(riderId: string): Promise<IRide[]>;
  getRidesByDriverId(driverId: string): Promise<IRide[]>;
  getAllRides(): Promise<IRide[]>;
  atomicTransitionRide(
    rideId: string,
    nextStatus: RideStatus,
    allowedCurrentStatuses: RideStatus[],
    additionalUpdates?: Partial<IRide>
  ): Promise<{ success: boolean; ride?: IRide; message?: string }>;
  atomicAcceptRide(
    rideId: string,
    driverId: string
  ): Promise<{ success: boolean; ride?: IRide; message?: string }>;
  freeDriver(driverId: string, rideId?: string): Promise<boolean>;
  findNearbyEligibleDrivers(params: {
    pickupLat: number;
    pickupLng: number;
    radiusKm: number;
    category?: VehicleCategory;
    excludedDriverIds?: string[];
  }): Promise<Array<{ driver: IDriver; distanceKm: number }>>;

  // Ride Offer Operations
  createRideOffer(offer: Partial<IRideOffer>): Promise<IRideOffer>;
  findOfferById(offerId: string): Promise<IRideOffer | null>;
  findActiveOfferForRide(rideId: string): Promise<IRideOffer | null>;
  updateRideOfferStatus(offerId: string, status: 'ACCEPTED' | 'REJECTED' | 'EXPIRED'): Promise<void>;
  getPendingOffersExpiredBefore(date: Date): Promise<IRideOffer[]>;

  // Wallet & Financial Operations
  getOrCreateWallet(userId: string): Promise<IWallet>;
  debitWallet(
    userId: string,
    amount: number,
    description: string,
    referenceId?: string,
    idempotencyKey?: string
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }>;
  creditWallet(
    userId: string,
    amount: number,
    description: string,
    referenceId?: string,
    idempotencyKey?: string
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }>;
  settleRidePaymentWallet(params: {
    rideId: string;
    riderId: string;
    driverId?: string;
    amount: number;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; transactionId: string }>;
  getTransactionsForUser(userId: string): Promise<IWalletTransaction[]>;

  // Payment Operations
  createPayment(payment: Partial<IPayment>): Promise<IPayment>;
  findPaymentById(id: string): Promise<IPayment | null>;
  findPaymentByRideId(rideId: string): Promise<IPayment | null>;
  findPaymentByStripeIntent(intentId: string): Promise<IPayment | null>;
  updatePayment(id: string, updates: Partial<IPayment>): Promise<IPayment | null>;

  // Webhook Deduplication & Idempotency
  isWebhookProcessed(eventId: string): Promise<boolean>;
  claimWebhookEvent(
    eventId: string,
    source: string,
    type: string
  ): Promise<{ claimed: boolean; alreadyProcessed: boolean }>;
  recordProcessedWebhook(
    eventId: string,
    source: string,
    type: string,
    payload?: any,
    status?: 'PROCESSED' | 'FAILED',
    errorMessage?: string
  ): Promise<void>;

  // Platform Ledger & Cash Settlement
  recordLedgerEntry(entry: Omit<IPlatformLedger, 'id' | 'createdAt'>): Promise<IPlatformLedger>;
  getPlatformLedger(limit?: number, filter?: Partial<IPlatformLedger>): Promise<IPlatformLedger[]>;
  settleCashPayment(params: {
    rideId: string;
    riderId: string;
    driverId: string;
    amount: number;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; transactionId: string; platformFee: number; commissionDebt: number }>;

  // Paginated Administrative Queries
  getRidesPaginated(options: {
    page?: number;
    limit?: number;
    status?: string;
    riderId?: string;
    driverId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ data: IRide[]; total: number; page: number; totalPages: number }>;
  getUsersPaginated(options: {
    page?: number;
    limit?: number;
    role?: string;
    search?: string;
  }): Promise<{ data: Omit<IUser, 'passwordHash'>[]; total: number; page: number; totalPages: number }>;
  getDriversPaginated(options: {
    page?: number;
    limit?: number;
    approvalStatus?: string;
    isOnline?: boolean;
    search?: string;
  }): Promise<{ data: IDriver[]; total: number; page: number; totalPages: number }>;
  getFinancialSummary(): Promise<{
    totalGrossVolume: number;
    totalPlatformRevenue: number;
    totalDriverPayouts: number;
    totalOutstandingDebt: number;
    transactionCount: number;
  }>;

  // Rating Operations
  createRating(rating: Partial<IRating>): Promise<IRating>;
  getRatingsForUser(userId: string): Promise<IRating[]>;
  findRatingByRideAndFromUser(rideId: string, fromUserId: string): Promise<IRating | null>;

  // Chat Messaging Operations
  createMessage(msg: Partial<IMessage>): Promise<IMessage>;
  getMessagesForRide(rideId: string): Promise<IMessage[]>;

  // Notification Operations
  createNotification(notif: Partial<INotification>): Promise<INotification>;
  getNotificationsForUser(userId: string): Promise<INotification[]>;
  findNotificationById(id: string): Promise<INotification | null>;
  updateNotification(id: string, updates: Partial<INotification>): Promise<INotification | null>;
  markNotificationRead(id: string, userId: string): Promise<boolean>;
  markAllNotificationsRead(userId: string): Promise<number>;

  // Audit Logs & Platform Admin
  logAudit(userId: string, action: string, details?: any, ip?: string): Promise<void>;
  createAuditLog(log: Partial<IAuditLog>): Promise<IAuditLog>;
  getAuditLogs(limit?: number): Promise<IAuditLog[]>;
  getPlatformStats(): Promise<any>;

  // Refresh Sessions (JWT Token Rotation)
  createRefreshSession(session: {
    userId: string;
    jti: string;
    tokenHash: string;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
  }): Promise<IRefreshSession>;
  findRefreshSessionByJti(jti: string): Promise<IRefreshSession | null>;
  revokeRefreshSession(jti: string, reason?: string): Promise<void>;
  revokeAllSessionsForUser(userId: string, reason?: string): Promise<void>;
}

export class MongoDatabaseStore implements IDatabaseStore {
  private ensureConnection(): void {
    if (!isDbConnected()) {
      throw new AppError(
        'Database connection is unavailable. Real MongoDB connection is required.',
        503,
        'DATABASE_UNAVAILABLE'
      );
    }
  }

  // Domain mappers
  private docToUser(doc: any): IUser {
    if (!doc) return null as any;
    return {
      id: doc._id?.toString() || doc.id,
      name: doc.name,
      email: doc.email,
      phone: doc.phone,
      passwordHash: doc.passwordHash,
      role: doc.role,
      status: doc.status,
      avatarUrl: doc.avatarUrl,
      createdAt: doc.createdAt?.toISOString?.() || new Date(doc.createdAt).toISOString(),
      updatedAt: doc.updatedAt?.toISOString?.() || new Date(doc.updatedAt).toISOString(),
    };
  }

  private docToDriver(doc: any): IDriver {
    if (!doc) return null as any;
    return {
      id: doc._id?.toString() || doc.id,
      userId: doc.userId,
      approvalStatus: doc.approvalStatus,
      isOnline: doc.isOnline,
      isBusy: doc.isBusy || false,
      activeRideId: doc.activeRideId || undefined,
      currentLocation: {
        lat: doc.currentLocation?.lat ?? 24.7136,
        lng: doc.currentLocation?.lng ?? 46.6753,
        heading: doc.currentLocation?.heading || 0,
        updatedAt:
          doc.currentLocation?.updatedAt?.toISOString?.() ||
          new Date(doc.currentLocation?.updatedAt || Date.now()).toISOString(),
      },
      rating: doc.rating ?? 5.0,
      totalRides: doc.totalRides ?? 0,
      licenseNumber: doc.licenseNumber,
      documents: doc.documents,
      earningsTotal: doc.earningsTotal ?? 0,
    };
  }

  private docToVehicle(doc: any): IVehicle {
    if (!doc) return null as any;
    return {
      id: doc._id?.toString() || doc.id,
      driverId: doc.driverId,
      make: doc.make,
      model: doc.model,
      year: doc.year,
      color: doc.color,
      plateNumber: doc.plateNumber,
      category: doc.category,
    };
  }

  private docToRide(doc: any): IRide {
    if (!doc) return null as any;
    return {
      id: doc._id?.toString() || doc.id,
      riderId: doc.riderId,
      driverId: doc.driverId,
      status: doc.status,
      vehicleCategory: doc.vehicleCategory,
      pickup: doc.pickup,
      destination: doc.destination,
      currentDriverLocation: doc.currentDriverLocation,
      estimatedFare: doc.estimatedFare,
      finalFare: doc.finalFare,
      tip: doc.tip,
      distanceKm: doc.distanceKm,
      durationMinutes: doc.durationMinutes,
      paymentMethod: doc.paymentMethod,
      paymentStatus: doc.paymentStatus,
      cancellationReason: doc.cancellationReason,
      cancelledBy: doc.cancelledBy,
      stateHistory: (doc.stateHistory || []).map((s: any) => ({
        status: s.status,
        timestamp: s.timestamp instanceof Date ? s.timestamp.toISOString() : new Date(s.timestamp).toISOString(),
        byUserId: s.byUserId,
        reason: s.reason,
      })),
      offeredDriverIds: doc.offeredDriverIds || [],
      currentOffer: doc.currentOffer
        ? {
            driverId: doc.currentOffer.driverId,
            offerId: doc.currentOffer.offerId,
            expiresAt:
              doc.currentOffer.expiresAt instanceof Date
                ? doc.currentOffer.expiresAt.toISOString()
                : new Date(doc.currentOffer.expiresAt).toISOString(),
          }
        : undefined,
      searchRadiusKm: doc.searchRadiusKm || 3,
      retryCount: doc.retryCount || 0,
      startedAt: doc.startedAt ? new Date(doc.startedAt).toISOString() : undefined,
      completedAt: doc.completedAt ? new Date(doc.completedAt).toISOString() : undefined,
      createdAt: doc.createdAt?.toISOString?.() || new Date(doc.createdAt).toISOString(),
      updatedAt: doc.updatedAt?.toISOString?.() || new Date(doc.updatedAt || Date.now()).toISOString(),
    };
  }

  // ==========================================
  // USER OPERATIONS
  // ==========================================
  public async findUserById(id: string): Promise<IUser | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const doc = await UserModel.findOne(query).lean();
    return doc ? this.docToUser(doc) : null;
  }

  public async findUserByEmail(email: string): Promise<IUser | null> {
    this.ensureConnection();
    const doc = await UserModel.findOne({ email: email.toLowerCase().trim() }).lean();
    return doc ? this.docToUser(doc) : null;
  }

  public async findUserByPhone(phone: string): Promise<IUser | null> {
    this.ensureConnection();
    const doc = await UserModel.findOne({ phone: phone.trim() }).lean();
    return doc ? this.docToUser(doc) : null;
  }

  public async createUser(user: Partial<IUser>): Promise<IUser> {
    this.ensureConnection();
    const doc = await UserModel.create({
      _id: new mongoose.Types.ObjectId(),
      name: user.name,
      email: user.email?.toLowerCase().trim(),
      phone: user.phone?.trim(),
      passwordHash: user.passwordHash,
      role: user.role || 'RIDER',
      status: user.status || 'ACTIVE',
      avatarUrl: user.avatarUrl,
    });
    return this.docToUser(doc);
  }

  public async updateUser(id: string, updates: Partial<IUser>): Promise<IUser | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const doc = await UserModel.findOneAndUpdate(
      query,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
    return doc ? this.docToUser(doc) : null;
  }

  public async getAllUsers(): Promise<IUser[]> {
    this.ensureConnection();
    const docs = await UserModel.find().sort({ createdAt: -1 }).lean();
    return docs.map((d) => this.docToUser(d));
  }

  // ==========================================
  // DRIVER & VEHICLE OPERATIONS
  // ==========================================
  public async findDriverById(id: string): Promise<IDriver | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const doc = await DriverModel.findOne(query).lean();
    return doc ? this.docToDriver(doc) : null;
  }

  public async findDriverByUserId(userId: string): Promise<IDriver | null> {
    this.ensureConnection();
    const doc = await DriverModel.findOne({ userId }).lean();
    return doc ? this.docToDriver(doc) : null;
  }

  public async createDriver(driver: Partial<IDriver>): Promise<IDriver> {
    this.ensureConnection();
    const doc = await DriverModel.create({
      _id: new mongoose.Types.ObjectId(),
      userId: driver.userId,
      approvalStatus: driver.approvalStatus || 'PENDING',
      isOnline: driver.isOnline || false,
      currentLocation: driver.currentLocation || {
        lat: 24.7136,
        lng: 46.6753,
        heading: 0,
        updatedAt: new Date(),
      },
      location: {
        type: 'Point',
        coordinates: [
          driver.currentLocation?.lng ?? 46.6753,
          driver.currentLocation?.lat ?? 24.7136,
        ],
      },
      rating: driver.rating || 5.0,
      totalRides: driver.totalRides || 0,
      licenseNumber: driver.licenseNumber,
      documents: driver.documents,
      earningsTotal: driver.earningsTotal || 0,
    });
    return this.docToDriver(doc);
  }

  public async updateDriver(id: string, updates: Partial<IDriver>): Promise<IDriver | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const mongoUpdates: any = { ...updates };

    if (updates.currentLocation) {
      mongoUpdates.location = {
        type: 'Point',
        coordinates: [updates.currentLocation.lng, updates.currentLocation.lat],
      };
    }

    const doc = await DriverModel.findOneAndUpdate(
      query,
      { $set: mongoUpdates },
      { new: true, runValidators: true }
    ).lean();
    return doc ? this.docToDriver(doc) : null;
  }

  public async getOnlineApprovedDrivers(): Promise<IDriver[]> {
    this.ensureConnection();
    const docs = await DriverModel.find({ isOnline: true, approvalStatus: 'APPROVED' }).lean();
    const drivers = docs.map((d) => this.docToDriver(d));
    for (const d of drivers) {
      const v = await this.findVehicleByDriverId(d.id);
      if (v) d.vehicle = v;
    }
    return drivers;
  }

  public async getAllDrivers(): Promise<IDriver[]> {
    this.ensureConnection();
    const docs = await DriverModel.find().lean();
    const drivers = docs.map((d) => this.docToDriver(d));
    for (const d of drivers) {
      const v = await this.findVehicleByDriverId(d.id);
      if (v) d.vehicle = v;
    }
    return drivers;
  }

  public async findVehicleByDriverId(driverId: string): Promise<IVehicle | null> {
    this.ensureConnection();
    const doc = await VehicleModel.findOne({ driverId }).lean();
    return doc ? this.docToVehicle(doc) : null;
  }

  public async createVehicle(vehicle: Partial<IVehicle>): Promise<IVehicle> {
    this.ensureConnection();
    const doc = await VehicleModel.create({
      _id: new mongoose.Types.ObjectId(),
      driverId: vehicle.driverId,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      plateNumber: vehicle.plateNumber,
      category: vehicle.category || 'STANDARD',
    });
    return this.docToVehicle(doc);
  }

  public async updateVehicle(driverId: string, updates: Partial<IVehicle>): Promise<IVehicle | null> {
    this.ensureConnection();
    const doc = await VehicleModel.findOneAndUpdate(
      { driverId },
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
    return doc ? this.docToVehicle(doc) : null;
  }

  // ==========================================
  // RIDE OPERATIONS
  // ==========================================
  public async createRide(ride: Partial<IRide>): Promise<IRide> {
    this.ensureConnection();
    const doc = await RideModel.create({
      _id: new mongoose.Types.ObjectId(),
      riderId: ride.riderId,
      driverId: ride.driverId,
      status: ride.status || 'REQUESTED',
      vehicleCategory: ride.vehicleCategory || 'STANDARD',
      pickup: ride.pickup,
      destination: ride.destination,
      estimatedFare: ride.estimatedFare,
      finalFare: ride.finalFare,
      tip: ride.tip || 0,
      distanceKm: ride.distanceKm,
      durationMinutes: ride.durationMinutes,
      paymentMethod: ride.paymentMethod || 'WALLET',
      paymentStatus: ride.paymentStatus || 'PENDING',
    });
    return this.docToRide(doc);
  }

  public async findRideById(id: string): Promise<IRide | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const doc = await RideModel.findOne(query).lean();
    return doc ? this.docToRide(doc) : null;
  }

  public async updateRide(id: string, updates: Partial<IRide>): Promise<IRide | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const doc = await RideModel.findOneAndUpdate(
      query,
      { $set: { ...updates, updatedAt: new Date() } },
      { new: true }
    ).lean();
    return doc ? this.docToRide(doc) : null;
  }

  public async findActiveRideForUser(userId: string): Promise<IRide | null> {
    this.ensureConnection();
    const activeStatuses: RideStatus[] = [
      'REQUESTED',
      'SEARCHING_DRIVER',
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVING',
      'DRIVER_ARRIVED',
      'RIDE_STARTED',
    ];

    // Check as rider
    let doc = await RideModel.findOne({
      riderId: userId,
      status: { $in: activeStatuses },
    }).lean();

    if (doc) return this.docToRide(doc);

    // Check as driver
    const driver = await this.findDriverByUserId(userId);
    if (driver) {
      doc = await RideModel.findOne({
        driverId: driver.id,
        status: { $in: activeStatuses },
      }).lean();
      if (doc) return this.docToRide(doc);
    }

    return null;
  }

  public async getRidesByRiderId(riderId: string): Promise<IRide[]> {
    this.ensureConnection();
    const docs = await RideModel.find({ riderId }).sort({ createdAt: -1 }).lean();
    return docs.map((d) => this.docToRide(d));
  }

  public async getRidesByDriverId(driverId: string): Promise<IRide[]> {
    this.ensureConnection();
    const docs = await RideModel.find({ driverId }).sort({ createdAt: -1 }).lean();
    return docs.map((d) => this.docToRide(d));
  }

  public async getAllRides(): Promise<IRide[]> {
    this.ensureConnection();
    const docs = await RideModel.find().sort({ createdAt: -1 }).lean();
    return docs.map((d) => this.docToRide(d));
  }

  public async atomicTransitionRide(
    rideId: string,
    nextStatus: RideStatus,
    allowedCurrentStatuses: RideStatus[],
    additionalUpdates?: Partial<IRide>
  ): Promise<{ success: boolean; ride?: IRide; message?: string }> {
    this.ensureConnection();
    const lockKey = `ride_transition:${rideId}`;
    const lock = await acquireLock(lockKey, 5000);
    if (!lock.acquired) {
      return { success: false, message: 'Conflict: Ride update is currently being processed by another worker.' };
    }

    try {
      const query = mongoose.Types.ObjectId.isValid(rideId) ? { _id: rideId } : { id: rideId };
      const updateData: any = {
        status: nextStatus,
        updatedAt: new Date(),
        ...(additionalUpdates || {}),
        $push: {
          stateHistory: {
            status: nextStatus,
            timestamp: new Date(),
            byUserId: (additionalUpdates as any)?.byUserId || additionalUpdates?.cancelledBy,
            reason: additionalUpdates?.cancellationReason,
          },
        },
      };

      if (nextStatus === 'RIDE_STARTED' && !updateData.startedAt) {
        updateData.startedAt = new Date();
      } else if (nextStatus === 'RIDE_COMPLETED' && !updateData.completedAt) {
        updateData.completedAt = new Date();
      }

      const updatedDoc = await RideModel.findOneAndUpdate(
        { ...query, status: { $in: allowedCurrentStatuses } },
        updateData,
        { new: true }
      ).lean();

      if (!updatedDoc) {
        const current = await this.findRideById(rideId);
        return {
          success: false,
          message: `Cannot transition ride from current status '${current?.status}' to '${nextStatus}'.`,
        };
      }

      // If ride is finished or cancelled, release driver reservation
      if (nextStatus === 'RIDE_COMPLETED' || nextStatus === 'CANCELLED') {
        if (updatedDoc.driverId) {
          await this.freeDriver(updatedDoc.driverId, rideId);
        }
        // Also expire any remaining pending offers
        await RideOfferModel.updateMany(
          { rideId, status: 'PENDING' },
          { $set: { status: 'EXPIRED', updatedAt: new Date() } }
        );
      }

      return { success: true, ride: this.docToRide(updatedDoc) };
    } finally {
      await releaseLock(lockKey, lock.token);
    }
  }

  public async atomicAcceptRide(
    rideId: string,
    driverId: string
  ): Promise<{ success: boolean; ride?: IRide; message?: string }> {
    this.ensureConnection();

    // 1. Dual-level locking: Lock driver and ride to eliminate race conditions
    const driverLockKey = `driver_reservation:${driverId}`;
    const rideLockKey = `ride_claim:${rideId}`;

    const driverLock = await acquireLock(driverLockKey, 10000, { failClosed: true });
    if (!driverLock.acquired) {
      return { success: false, message: 'Captain reservation in progress. Please try again.' };
    }

    let rideLock: LockAcquisitionResult | null = null;
    try {
      // 2. Atomic Driver Reservation in MongoDB:
      // Captain must be approved, online, and NOT already busy
      const driverQuery = mongoose.Types.ObjectId.isValid(driverId) ? { _id: driverId } : { id: driverId };
      const reservedDriver = await DriverModel.findOneAndUpdate(
        {
          ...driverQuery,
          approvalStatus: 'APPROVED',
          isOnline: true,
          isBusy: { $ne: true },
        },
        {
          $set: {
            isBusy: true,
            activeRideId: rideId,
          },
        },
        { new: true }
      ).lean();

      if (!reservedDriver) {
        return {
          success: false,
          message: 'Captain is currently on another ride or is offline.',
        };
      }

      // 3. Acquire Ride Lock
      rideLock = await acquireLock(rideLockKey, 8000);
      if (!rideLock || !rideLock.acquired) {
        // Rollback driver reservation
        await DriverModel.updateOne(
          { ...driverQuery, activeRideId: rideId },
          { $set: { isBusy: false, activeRideId: null } }
        );
        return { success: false, message: 'This ride is currently being claimed by another captain.' };
      }

      // 4. Atomically claim Ride
      const rideQuery = mongoose.Types.ObjectId.isValid(rideId) ? { _id: rideId } : { id: rideId };
      const updatedDoc = await RideModel.findOneAndUpdate(
        {
          ...rideQuery,
          status: { $in: ['REQUESTED', 'SEARCHING_DRIVER'] },
          driverId: { $exists: false },
        },
        {
          $set: {
            status: 'DRIVER_ASSIGNED',
            driverId,
            updatedAt: new Date(),
            'currentOffer.status': 'ACCEPTED',
          },
          $push: {
            stateHistory: {
              status: 'DRIVER_ASSIGNED',
              timestamp: new Date(),
              byUserId: reservedDriver.userId,
              reason: 'Ride accepted by captain',
            },
          },
        },
        { new: true }
      ).lean();

      if (!updatedDoc) {
        // Rollback driver reservation if ride was already claimed or cancelled
        await DriverModel.updateOne(
          { ...driverQuery, activeRideId: rideId },
          { $set: { isBusy: false, activeRideId: null } }
        );
        return { success: false, message: 'Ride has already been accepted by another captain or was cancelled.' };
      }

      // 5. Update RideOffer records
      await RideOfferModel.updateMany(
        { rideId, driverId, status: 'PENDING' },
        { $set: { status: 'ACCEPTED', updatedAt: new Date() } }
      );
      await RideOfferModel.updateMany(
        { rideId, driverId: { $ne: driverId }, status: 'PENDING' },
        { $set: { status: 'EXPIRED', updatedAt: new Date() } }
      );

      return { success: true, ride: this.docToRide(updatedDoc) };
    } finally {
      if (rideLock && rideLock.acquired) {
        await releaseLock(rideLockKey, rideLock.token);
      }
      await releaseLock(driverLockKey, driverLock.token);
    }
  }

  public async freeDriver(driverId: string, rideId?: string): Promise<boolean> {
    this.ensureConnection();
    const query: any = mongoose.Types.ObjectId.isValid(driverId) ? { _id: driverId } : { id: driverId };
    if (rideId) {
      query.activeRideId = rideId;
    }
    const res = await DriverModel.updateOne(
      query,
      { $set: { isBusy: false, activeRideId: null } }
    );
    return res.modifiedCount > 0;
  }

  public async findNearbyEligibleDrivers(params: {
    pickupLat: number;
    pickupLng: number;
    radiusKm: number;
    category?: VehicleCategory;
    excludedDriverIds?: string[];
  }): Promise<Array<{ driver: IDriver; distanceKm: number }>> {
    this.ensureConnection();
    const { pickupLat, pickupLng, radiusKm, category, excludedDriverIds = [] } = params;
    const maxDistanceMeters = radiusKm * 1000;

    // Must be online, approved, and not busy
    const matchFilter: any = {
      isOnline: true,
      approvalStatus: 'APPROVED',
      isBusy: { $ne: true },
    };

    if (excludedDriverIds.length > 0) {
      const validIds = excludedDriverIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (validIds.length > 0) {
        matchFilter._id = { $nin: validIds };
      }
    }

    try {
      // 1. Production MongoDB 2dsphere $geoNear pipeline
      const pipeline: any[] = [
        {
          $geoNear: {
            near: {
              type: 'Point',
              coordinates: [pickupLng, pickupLat],
            },
            distanceField: 'calculatedDistanceMeters',
            maxDistance: maxDistanceMeters,
            query: matchFilter,
            spherical: true,
          },
        },
      ];

      const geoDocs = await DriverModel.aggregate(pipeline);
      const results: Array<{ driver: IDriver; distanceKm: number }> = [];

      for (const doc of geoDocs) {
        const driver = this.docToDriver(doc);
        const vehicle = await this.findVehicleByDriverId(driver.id);
        if (vehicle) driver.vehicle = vehicle;

        // Filter by category if specified
        if (category && driver.vehicle && driver.vehicle.category !== category) {
          continue;
        }

        const distanceKm = Math.round((doc.calculatedDistanceMeters / 1000) * 100) / 100;
        results.push({ driver, distanceKm });
      }

      return results;
    } catch {
      // 2. Resilient fallback to coordinate bounding & precise Haversine
      const driverDocs = await DriverModel.find(matchFilter).lean();
      const results: Array<{ driver: IDriver; distanceKm: number }> = [];

      for (const doc of driverDocs) {
        const driver = this.docToDriver(doc);
        const vehicle = await this.findVehicleByDriverId(driver.id);
        if (vehicle) driver.vehicle = vehicle;

        if (category && driver.vehicle && driver.vehicle.category !== category) {
          continue;
        }

        // Calculate distance using Haversine formula
        const dLat = (driver.currentLocation.lat - pickupLat) * (Math.PI / 180);
        const dLng = (driver.currentLocation.lng - pickupLng) * (Math.PI / 180);
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(pickupLat * (Math.PI / 180)) *
            Math.cos(driver.currentLocation.lat * (Math.PI / 180)) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceKm = Math.round(6371 * c * 100) / 100;

        if (distanceKm <= radiusKm) {
          results.push({ driver, distanceKm });
        }
      }

      return results.sort((a, b) => a.distanceKm - b.distanceKm);
    }
  }

  // ==========================================
  // RIDE OFFER OPERATIONS
  // ==========================================
  public async createRideOffer(offer: Partial<IRideOffer>): Promise<IRideOffer> {
    this.ensureConnection();
    const doc = await RideOfferModel.create({
      _id: new mongoose.Types.ObjectId(),
      rideId: offer.rideId,
      driverId: offer.driverId,
      status: offer.status || 'PENDING',
      expiresAt: new Date(offer.expiresAt!),
      distanceKm: offer.distanceKm,
      estimatedFare: offer.estimatedFare,
    });
    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      driverId: doc.driverId,
      status: doc.status as any,
      expiresAt: doc.expiresAt.toISOString(),
      distanceKm: doc.distanceKm,
      estimatedFare: doc.estimatedFare,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  public async findOfferById(offerId: string): Promise<IRideOffer | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(offerId) ? { _id: offerId } : { id: offerId };
    const doc = await RideOfferModel.findOne(query).lean();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      driverId: doc.driverId,
      status: doc.status as any,
      expiresAt: doc.expiresAt.toISOString(),
      distanceKm: doc.distanceKm,
      estimatedFare: doc.estimatedFare,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  public async findActiveOfferForRide(rideId: string): Promise<IRideOffer | null> {
    this.ensureConnection();
    const doc = await RideOfferModel.findOne({ rideId, status: 'PENDING' })
      .sort({ createdAt: -1 })
      .lean();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      driverId: doc.driverId,
      status: doc.status as any,
      expiresAt: doc.expiresAt.toISOString(),
      distanceKm: doc.distanceKm,
      estimatedFare: doc.estimatedFare,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  public async updateRideOfferStatus(
    offerId: string,
    status: 'ACCEPTED' | 'REJECTED' | 'EXPIRED'
  ): Promise<void> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(offerId) ? { _id: offerId } : { id: offerId };
    await RideOfferModel.updateOne(query, { $set: { status, updatedAt: new Date() } });
  }

  public async getPendingOffersExpiredBefore(date: Date): Promise<IRideOffer[]> {
    this.ensureConnection();
    const docs = await RideOfferModel.find({
      status: 'PENDING',
      expiresAt: { $lt: date },
    }).lean();

    return docs.map((doc: any) => ({
      id: doc._id.toString(),
      rideId: doc.rideId,
      driverId: doc.driverId,
      status: doc.status as any,
      expiresAt: doc.expiresAt.toISOString(),
      distanceKm: doc.distanceKm,
      estimatedFare: doc.estimatedFare,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    }));
  }

  // ==========================================
  // WALLET & FINANCIAL OPERATIONS
  // ==========================================
  public async getOrCreateWallet(userId: string): Promise<IWallet> {
    this.ensureConnection();
    let doc = await WalletModel.findOne({ userId }).lean();
    if (!doc) {
      try {
        const created = await WalletModel.create({
          _id: new mongoose.Types.ObjectId(),
          userId,
          balance: 0,
          currency: 'SAR',
        });
        doc = created.toObject();
      } catch {
        // Race condition: another request created it
        doc = await WalletModel.findOne({ userId }).lean();
      }
    }

    return {
      id: doc!._id.toString(),
      userId: doc!.userId,
      balance: doc!.balance,
      currency: doc!.currency || 'SAR',
      updatedAt: doc!.updatedAt?.toISOString?.() || new Date(doc!.updatedAt).toISOString(),
    };
  }

  public async debitWallet(
    userId: string,
    amount: number,
    description: string,
    referenceId?: string,
    idempotencyKey?: string
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    this.ensureConnection();
    if (amount <= 0) {
      throw new AppError('Debit amount must be greater than zero', 400, 'INVALID_AMOUNT');
    }

    // Idempotency verification
    if (idempotencyKey) {
      const existingTx = await WalletTransactionModel.findOne({ idempotencyKey }).lean();
      if (existingTx) {
        const wallet = await this.getOrCreateWallet(userId);
        return {
          wallet,
          transaction: {
            id: existingTx._id.toString(),
            walletId: existingTx.walletId,
            userId: existingTx.userId,
            amount: existingTx.amount,
            type: existingTx.type,
            balanceAfter: existingTx.balanceAfter,
            reason: (existingTx as any).reason || (existingTx as any).description || '',
            referenceId: existingTx.referenceId,
            createdAt: existingTx.createdAt.toISOString(),
          },
        };
      }
    }

    // Atomic conditional decrement: balance MUST be >= amount
    const updatedWalletDoc = await WalletModel.findOneAndUpdate(
      { userId, balance: { $gte: amount } },
      { $inc: { balance: -amount }, $set: { updatedAt: new Date() } },
      { new: true }
    ).lean();

    if (!updatedWalletDoc) {
      const current = await this.getOrCreateWallet(userId);
      throw new AppError(
        `Insufficient wallet balance. Available: ${current.balance.toFixed(2)} SAR, required: ${amount.toFixed(2)} SAR.`,
        400,
        'INSUFFICIENT_FUNDS'
      );
    }

    const txDoc = await WalletTransactionModel.create({
      _id: new mongoose.Types.ObjectId(),
      walletId: updatedWalletDoc._id.toString(),
      userId,
      amount,
      type: 'DEBIT',
      balanceAfter: updatedWalletDoc.balance,
      reason: description,
      referenceId,
      idempotencyKey,
    });

    return {
      wallet: {
        id: updatedWalletDoc._id.toString(),
        userId: updatedWalletDoc.userId,
        balance: updatedWalletDoc.balance,
        currency: updatedWalletDoc.currency,
        updatedAt: updatedWalletDoc.updatedAt.toISOString(),
      },
      transaction: {
        id: txDoc._id.toString(),
        walletId: txDoc.walletId,
        userId: txDoc.userId,
        amount: txDoc.amount,
        type: txDoc.type,
        balanceAfter: txDoc.balanceAfter,
        reason: txDoc.reason,
        referenceId: txDoc.referenceId,
        createdAt: txDoc.createdAt.toISOString(),
      },
    };
  }

  public async creditWallet(
    userId: string,
    amount: number,
    description: string,
    referenceId?: string,
    idempotencyKey?: string
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    this.ensureConnection();
    if (amount <= 0) {
      throw new AppError('Credit amount must be greater than zero', 400, 'INVALID_AMOUNT');
    }

    // Idempotency verification
    if (idempotencyKey) {
      const existingTx = await WalletTransactionModel.findOne({ idempotencyKey }).lean();
      if (existingTx) {
        const wallet = await this.getOrCreateWallet(userId);
        return {
          wallet,
          transaction: {
            id: existingTx._id.toString(),
            walletId: existingTx.walletId,
            userId: existingTx.userId,
            amount: existingTx.amount,
            type: existingTx.type,
            balanceAfter: existingTx.balanceAfter,
            reason: (existingTx as any).reason || (existingTx as any).description || '',
            referenceId: existingTx.referenceId,
            createdAt: existingTx.createdAt.toISOString(),
          },
        };
      }
    }

    // Ensure wallet exists, then atomic increment
    await this.getOrCreateWallet(userId);
    const updatedWalletDoc = await WalletModel.findOneAndUpdate(
      { userId },
      { $inc: { balance: amount }, $set: { updatedAt: new Date() } },
      { new: true }
    ).lean();

    const txDoc = await WalletTransactionModel.create({
      _id: new mongoose.Types.ObjectId(),
      walletId: updatedWalletDoc!._id.toString(),
      userId,
      amount,
      type: 'CREDIT',
      balanceAfter: updatedWalletDoc!.balance,
      reason: description,
      referenceId,
      idempotencyKey,
    });

    return {
      wallet: {
        id: updatedWalletDoc!._id.toString(),
        userId: updatedWalletDoc!.userId,
        balance: updatedWalletDoc!.balance,
        currency: updatedWalletDoc!.currency,
        updatedAt: updatedWalletDoc!.updatedAt.toISOString(),
      },
      transaction: {
        id: txDoc._id.toString(),
        walletId: txDoc.walletId,
        userId: txDoc.userId,
        amount: txDoc.amount,
        type: txDoc.type,
        balanceAfter: txDoc.balanceAfter,
        reason: txDoc.reason,
        referenceId: txDoc.referenceId,
        createdAt: txDoc.createdAt.toISOString(),
      },
    };
  }

  public async settleRidePaymentWallet(params: {
    rideId: string;
    riderId: string;
    driverId?: string;
    amount: number;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; transactionId: string }> {
    this.ensureConnection();
    const { rideId, riderId, driverId, amount, idempotencyKey } = params;

    // Check idempotency on ride payment first
    const existingPayment = await PaymentModel.findOne({ rideId, status: 'SUCCEEDED' }).lean();
    if (existingPayment) {
      return { success: true, transactionId: existingPayment._id.toString() };
    }

    // Debit rider
    await this.debitWallet(
      riderId,
      amount,
      `Payment for ride #${rideId.slice(0, 8)}`,
      rideId,
      idempotencyKey ? `${idempotencyKey}_debit` : undefined
    );

    await this.recordLedgerEntry({
      rideId,
      type: 'RIDER_FARE',
      amount,
      currency: 'SAR',
      fromAccount: `rider:${riderId}`,
      toAccount: 'platform:escrow',
      status: 'SETTLED',
      idempotencyKey: idempotencyKey ? `${idempotencyKey}_ledger_fare` : undefined,
    });

    // Credit driver (80% net earnings after 20% platform commission)
    if (driverId) {
      const driver = await this.findDriverById(driverId);
      if (driver) {
        const driverEarning = Math.round(amount * 0.8 * 100) / 100;
        const platformCommission = Math.round((amount - driverEarning) * 100) / 100;

        // Automatically offset outstanding cash commission debt if any
        let debtRecovery = 0;
        if (driver.outstandingDebt && driver.outstandingDebt > 0) {
          debtRecovery = Math.min(driverEarning, driver.outstandingDebt);
        }

        const netPayout = driverEarning - debtRecovery;
        if (netPayout > 0) {
          await this.creditWallet(
            driver.userId,
            netPayout,
            `Net earnings for ride #${rideId.slice(0, 8)} (80% minus debt recovery)`,
            rideId,
            idempotencyKey ? `${idempotencyKey}_driver_credit` : undefined
          );
        }

        if (debtRecovery > 0) {
          await DriverModel.findByIdAndUpdate(driver.id, {
            $inc: { outstandingDebt: -debtRecovery },
          });
          await this.recordLedgerEntry({
            rideId,
            type: 'DEBT_RECOVERY',
            amount: debtRecovery,
            currency: 'SAR',
            fromAccount: `driver:${driver.id}`,
            toAccount: 'platform:commission',
            status: 'SETTLED',
            idempotencyKey: idempotencyKey ? `${idempotencyKey}_debt_rec` : undefined,
          });
        }

        await this.recordLedgerEntry({
          rideId,
          type: 'PLATFORM_COMMISSION',
          amount: platformCommission,
          currency: 'SAR',
          fromAccount: 'platform:escrow',
          toAccount: 'platform:revenue',
          status: 'COMMITTED',
          idempotencyKey: idempotencyKey ? `${idempotencyKey}_ledger_comm` : undefined,
        });

        await DriverModel.findByIdAndUpdate(driver.id, {
          $inc: { earningsTotal: driverEarning, totalRides: 1 },
        });
      }
    }

    // Update ride payment status
    await this.updateRide(rideId, {
      paymentStatus: 'SUCCEEDED',
      paymentMethod: 'WALLET',
      finalFare: amount,
    });

    // Create payment record
    const payment = await this.createPayment({
      rideId,
      userId: riderId,
      amount,
      currency: 'SAR',
      status: 'SUCCEEDED',
      paymentMethod: 'WALLET',
      idempotencyKey,
    });

    return { success: true, transactionId: payment.id };
  }

  public async settleCashPayment(params: {
    rideId: string;
    riderId: string;
    driverId: string;
    amount: number;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; transactionId: string; platformFee: number; commissionDebt: number }> {
    this.ensureConnection();
    const { rideId, riderId, driverId, amount, idempotencyKey } = params;

    const existingPayment = await PaymentModel.findOne({ rideId, status: 'SUCCEEDED' }).lean();
    if (existingPayment) {
      return {
        success: true,
        transactionId: existingPayment._id.toString(),
        platformFee: Math.round(amount * 0.2 * 100) / 100,
        commissionDebt: 0,
      };
    }

    const platformFee = Math.round(amount * 0.2 * 100) / 100;
    const driverEarning = Math.round((amount - platformFee) * 100) / 100;
    const driver = await this.findDriverById(driverId);
    let debtIncurred = 0;

    if (driver) {
      const driverWallet = await this.getOrCreateWallet(driver.userId);
      if (driverWallet.balance >= platformFee) {
        // Sufficient funds in wallet: deduct platform commission immediately
        await this.debitWallet(
          driver.userId,
          platformFee,
          `Platform commission (20%) for cash ride #${rideId.slice(0, 8)}`,
          rideId,
          idempotencyKey ? `${idempotencyKey}_cash_comm` : undefined
        );
        await this.recordLedgerEntry({
          rideId,
          type: 'PLATFORM_COMMISSION',
          amount: platformFee,
          currency: 'SAR',
          fromAccount: `driver:${driver.id}`,
          toAccount: 'platform:commission',
          status: 'COMMITTED',
          idempotencyKey: idempotencyKey ? `${idempotencyKey}_ledger_comm` : undefined,
        });
      } else {
        // Partial or zero balance in wallet
        const available = Math.max(0, driverWallet.balance);
        if (available > 0) {
          await this.debitWallet(
            driver.userId,
            available,
            `Partial platform commission for cash ride #${rideId.slice(0, 8)}`,
            rideId,
            idempotencyKey ? `${idempotencyKey}_partial_comm` : undefined
          );
        }
        debtIncurred = Math.round((platformFee - available) * 100) / 100;
        await DriverModel.findByIdAndUpdate(driver.id, {
          $inc: { outstandingDebt: debtIncurred },
        });

        await this.recordLedgerEntry({
          rideId,
          type: 'COMMISSION_DEBT',
          amount: debtIncurred,
          currency: 'SAR',
          fromAccount: `driver:${driver.id}`,
          toAccount: 'platform:debt',
          status: 'OUTSTANDING',
          idempotencyKey: idempotencyKey ? `${idempotencyKey}_debt_inc` : undefined,
        });
      }

      await DriverModel.findByIdAndUpdate(driver.id, {
        $inc: { earningsTotal: driverEarning, totalRides: 1 },
      });
    }

    await this.updateRide(rideId, {
      paymentStatus: 'SUCCEEDED',
      paymentMethod: 'CASH',
      finalFare: amount,
    });

    const payment = await this.createPayment({
      rideId,
      userId: riderId,
      amount,
      currency: 'SAR',
      status: 'SUCCEEDED',
      paymentMethod: 'CASH',
      idempotencyKey,
    });

    return {
      success: true,
      transactionId: payment.id,
      platformFee,
      commissionDebt: debtIncurred,
    };
  }

  public async getTransactionsForUser(userId: string): Promise<IWalletTransaction[]> {
    this.ensureConnection();
    const docs = await WalletTransactionModel.find({ userId })
      .sort({ createdAt: -1 })
      .lean();
    return docs.map((d) => ({
      id: d._id.toString(),
      walletId: d.walletId,
      userId: d.userId,
      amount: d.amount,
      type: d.type,
      balanceAfter: d.balanceAfter,
      reason: (d as any).reason || (d as any).description || '',
      referenceId: d.referenceId,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  // ==========================================
  // PAYMENT OPERATIONS
  // ==========================================
  public async createPayment(payment: Partial<IPayment>): Promise<IPayment> {
    this.ensureConnection();
    const doc = await PaymentModel.create({
      _id: new mongoose.Types.ObjectId(),
      rideId: payment.rideId,
      userId: payment.userId,
      amount: payment.amount,
      currency: payment.currency || 'SAR',
      status: payment.status || 'PENDING',
      paymentMethod: payment.paymentMethod || 'WALLET',
      stripePaymentIntentId: payment.stripePaymentIntentId,
      stripeClientSecret: payment.stripeClientSecret,
      idempotencyKey: payment.idempotencyKey,
    });
    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      userId: doc.userId,
      amount: doc.amount,
      currency: doc.currency,
      status: doc.status,
      paymentMethod: doc.paymentMethod,
      stripePaymentIntentId: doc.stripePaymentIntentId,
      stripeClientSecret: doc.stripeClientSecret,
      idempotencyKey: doc.idempotencyKey,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  public async findPaymentById(id: string): Promise<IPayment | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const doc = await PaymentModel.findOne(query).lean();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      userId: doc.userId,
      amount: doc.amount,
      currency: doc.currency,
      status: doc.status,
      paymentMethod: doc.paymentMethod,
      stripePaymentIntentId: doc.stripePaymentIntentId,
      stripeClientSecret: doc.stripeClientSecret,
      idempotencyKey: doc.idempotencyKey,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  public async findPaymentByRideId(rideId: string): Promise<IPayment | null> {
    this.ensureConnection();
    const doc = await PaymentModel.findOne({ rideId }).sort({ createdAt: -1 }).lean();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      userId: doc.userId,
      amount: doc.amount,
      currency: doc.currency,
      status: doc.status,
      paymentMethod: doc.paymentMethod,
      stripePaymentIntentId: doc.stripePaymentIntentId,
      stripeClientSecret: doc.stripeClientSecret,
      idempotencyKey: doc.idempotencyKey,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  public async findPaymentByStripeIntent(intentId: string): Promise<IPayment | null> {
    this.ensureConnection();
    const doc = await PaymentModel.findOne({ stripePaymentIntentId: intentId }).lean();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      userId: doc.userId,
      amount: doc.amount,
      currency: doc.currency,
      status: doc.status,
      paymentMethod: doc.paymentMethod,
      stripePaymentIntentId: doc.stripePaymentIntentId,
      stripeClientSecret: doc.stripeClientSecret,
      idempotencyKey: doc.idempotencyKey,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  public async updatePayment(id: string, updates: Partial<IPayment>): Promise<IPayment | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const doc = await PaymentModel.findOneAndUpdate(query, { $set: updates }, { new: true }).lean();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      userId: doc.userId,
      amount: doc.amount,
      currency: doc.currency,
      status: doc.status,
      paymentMethod: doc.paymentMethod,
      stripePaymentIntentId: doc.stripePaymentIntentId,
      stripeClientSecret: doc.stripeClientSecret,
      idempotencyKey: doc.idempotencyKey,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  // ==========================================
  // WEBHOOK IDEMPOTENCY & AUDITING
  // ==========================================
  public async isWebhookProcessed(eventId: string): Promise<boolean> {
    this.ensureConnection();
    const count = await WebhookEventModel.countDocuments({ eventId, status: 'PROCESSED' });
    return count > 0;
  }

  public async claimWebhookEvent(
    eventId: string,
    source: string,
    type: string
  ): Promise<{ claimed: boolean; alreadyProcessed: boolean }> {
    this.ensureConnection();
    try {
      await WebhookEventModel.create({
        _id: new mongoose.Types.ObjectId(),
        eventId,
        source,
        type,
        status: 'PROCESSING',
      });
      return { claimed: true, alreadyProcessed: false };
    } catch (err: any) {
      if (err.code === 11000 || err.message?.includes('duplicate key')) {
        const existing = await WebhookEventModel.findOne({ eventId }).lean();
        if (existing?.status === 'PROCESSED') {
          return { claimed: false, alreadyProcessed: true };
        }
        return { claimed: false, alreadyProcessed: false };
      }
      throw err;
    }
  }

  public async recordProcessedWebhook(
    eventId: string,
    source: string,
    type: string,
    payload?: any,
    status: 'PROCESSED' | 'FAILED' = 'PROCESSED',
    errorMessage?: string
  ): Promise<void> {
    this.ensureConnection();
    await WebhookEventModel.updateOne(
      { eventId },
      {
        $set: {
          eventId,
          source,
          type,
          payload,
          status,
          errorMessage,
          processedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  // ==========================================
  // PLATFORM LEDGER OPERATIONS
  // ==========================================
  public async recordLedgerEntry(entry: Omit<IPlatformLedger, 'id' | 'createdAt'>): Promise<IPlatformLedger> {
    this.ensureConnection();
    const doc = await PlatformLedgerModel.create({
      _id: new mongoose.Types.ObjectId(),
      rideId: entry.rideId,
      type: entry.type,
      amount: entry.amount,
      currency: entry.currency || 'SAR',
      fromAccount: entry.fromAccount,
      toAccount: entry.toAccount,
      status: entry.status || 'COMMITTED',
      idempotencyKey: entry.idempotencyKey,
    });

    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      type: doc.type as any,
      amount: doc.amount,
      currency: doc.currency,
      fromAccount: doc.fromAccount,
      toAccount: doc.toAccount,
      status: doc.status as any,
      idempotencyKey: doc.idempotencyKey,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  public async getPlatformLedger(limit: number = 100, filter?: Partial<IPlatformLedger>): Promise<IPlatformLedger[]> {
    this.ensureConnection();
    const query: any = {};
    if (filter?.rideId) query.rideId = filter.rideId;
    if (filter?.type) query.type = filter.type;
    if (filter?.status) query.status = filter.status;

    const docs = await PlatformLedgerModel.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    return docs.map((doc) => ({
      id: doc._id.toString(),
      rideId: doc.rideId,
      type: doc.type as any,
      amount: doc.amount,
      currency: doc.currency,
      fromAccount: doc.fromAccount,
      toAccount: doc.toAccount,
      status: doc.status as any,
      idempotencyKey: doc.idempotencyKey,
      createdAt: doc.createdAt.toISOString(),
    }));
  }

  // ==========================================
  // RATING OPERATIONS
  // ==========================================
  public async createRating(rating: Partial<IRating>): Promise<IRating> {
    this.ensureConnection();
    const stars = rating.stars ?? (rating as any).score ?? 5;
    const doc = await RatingModel.create({
      _id: new mongoose.Types.ObjectId(),
      rideId: rating.rideId,
      fromUserId: rating.fromUserId,
      toUserId: rating.toUserId,
      stars,
      comment: rating.comment,
    });

    // Recalculate target driver rating if applicable
    const targetDriver = await this.findDriverByUserId(rating.toUserId!);
    if (targetDriver) {
      const allRatings = await RatingModel.find({ toUserId: rating.toUserId }).lean();
      const avg = allRatings.reduce((sum, r) => sum + (r.stars || (r as any).score || 5), 0) / allRatings.length;
      await this.updateDriver(targetDriver.id, { rating: Math.round(avg * 10) / 10 });
    }

    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      fromUserId: doc.fromUserId,
      toUserId: doc.toUserId,
      stars: doc.stars,
      comment: doc.comment,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  public async getRatingsForUser(userId: string): Promise<IRating[]> {
    this.ensureConnection();
    const docs = await RatingModel.find({ toUserId: userId }).sort({ createdAt: -1 }).lean();
    return docs.map((d) => ({
      id: d._id.toString(),
      rideId: d.rideId,
      fromUserId: d.fromUserId,
      toUserId: d.toUserId,
      stars: d.stars ?? (d as any).score ?? 5,
      comment: d.comment,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  public async findRatingByRideAndFromUser(rideId: string, fromUserId: string): Promise<IRating | null> {
    this.ensureConnection();
    const doc = await RatingModel.findOne({ rideId, fromUserId }).lean();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      fromUserId: doc.fromUserId,
      toUserId: doc.toUserId,
      stars: doc.stars ?? (doc as any).score ?? 5,
      comment: doc.comment,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  // ==========================================
  // CHAT MESSAGES
  // ==========================================
  public async createMessage(msg: Partial<IMessage>): Promise<IMessage> {
    this.ensureConnection();
    const doc = await MessageModel.create({
      _id: new mongoose.Types.ObjectId(),
      rideId: msg.rideId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      recipientId: msg.recipientId,
      content: msg.content,
      read: false,
    });
    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      senderId: doc.senderId,
      senderName: doc.senderName,
      recipientId: doc.recipientId,
      content: doc.content,
      createdAt: doc.createdAt.toISOString(),
      read: doc.read,
    };
  }

  public async getMessagesForRide(rideId: string): Promise<IMessage[]> {
    this.ensureConnection();
    const docs = await MessageModel.find({ rideId }).sort({ createdAt: 1 }).lean();
    return docs.map((d) => ({
      id: d._id.toString(),
      rideId: d.rideId,
      senderId: d.senderId,
      senderName: d.senderName,
      recipientId: d.recipientId,
      content: d.content,
      createdAt: d.createdAt.toISOString(),
      read: d.read,
    }));
  }

  // ==========================================
  // NOTIFICATIONS
  // ==========================================
  public async createNotification(notif: Partial<INotification>): Promise<INotification> {
    this.ensureConnection();
    const body = notif.body || (notif as any).message || '';
    const metadata = notif.metadata || (notif as any).data;
    const doc = await NotificationModel.create({
      _id: new mongoose.Types.ObjectId(),
      userId: notif.userId,
      title: notif.title,
      body,
      type: notif.type || 'SYSTEM',
      read: false,
      metadata,
    });
    return {
      id: doc._id.toString(),
      userId: doc.userId,
      title: doc.title,
      body: doc.body,
      type: doc.type,
      read: doc.read,
      createdAt: doc.createdAt.toISOString(),
      metadata: doc.metadata,
    };
  }

  public async getNotificationsForUser(userId: string): Promise<INotification[]> {
    this.ensureConnection();
    const docs = await NotificationModel.find({ userId }).sort({ createdAt: -1 }).limit(50).lean();
    return docs.map((d) => ({
      id: d._id.toString(),
      userId: d.userId,
      title: d.title,
      body: d.body || (d as any).message || '',
      type: d.type,
      read: d.read,
      createdAt: d.createdAt.toISOString(),
      metadata: d.metadata || (d as any).data,
    }));
  }

  public async findNotificationById(id: string): Promise<INotification | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const doc = await NotificationModel.findOne(query).lean();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      userId: doc.userId,
      title: doc.title,
      body: doc.body || (doc as any).message || '',
      type: doc.type,
      read: doc.read,
      createdAt: doc.createdAt.toISOString(),
      metadata: doc.metadata || (doc as any).data,
    };
  }

  public async updateNotification(id: string, updates: Partial<INotification>): Promise<INotification | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const doc = await NotificationModel.findOneAndUpdate(query, { $set: updates }, { new: true }).lean();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      userId: doc.userId,
      title: doc.title,
      body: doc.body || (doc as any).message || '',
      type: doc.type,
      read: doc.read,
      createdAt: doc.createdAt.toISOString(),
      metadata: doc.metadata || (doc as any).data,
    };
  }

  public async markNotificationRead(id: string, userId: string): Promise<boolean> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const res = await NotificationModel.updateOne({ ...query, userId }, { $set: { read: true } });
    return res.modifiedCount > 0;
  }

  public async markAllNotificationsRead(userId: string): Promise<number> {
    this.ensureConnection();
    const res = await NotificationModel.updateMany({ userId, read: false }, { $set: { read: true } });
    return res.modifiedCount;
  }

  // ==========================================
  // AUDIT LOGS & PLATFORM ADMIN
  // ==========================================
  public async logAudit(userId: string, action: string, details?: any, ip?: string): Promise<void> {
    this.ensureConnection();
    await AuditLogModel.create({
      _id: new mongoose.Types.ObjectId(),
      userId,
      action,
      details,
      ip,
      timestamp: new Date(),
    });
  }

  public async createAuditLog(log: Partial<IAuditLog>): Promise<IAuditLog> {
    this.ensureConnection();
    const doc = await AuditLogModel.create({
      _id: new mongoose.Types.ObjectId(),
      userId: log.userId,
      action: log.action,
      details: log.details,
      ip: log.ip,
      timestamp: new Date(),
    });
    return {
      id: doc._id.toString(),
      userId: doc.userId,
      action: doc.action,
      details: doc.details,
      ip: doc.ip,
      timestamp: doc.timestamp.toISOString(),
    };
  }

  public async getAuditLogs(limit: number = 100): Promise<IAuditLog[]> {
    this.ensureConnection();
    const docs = await AuditLogModel.find().sort({ timestamp: -1 }).limit(limit).lean();
    return docs.map((d) => ({
      id: d._id.toString(),
      userId: d.userId,
      action: d.action,
      details: d.details,
      ip: d.ip,
      timestamp: d.timestamp.toISOString(),
    }));
  }

  public async getPlatformStats(): Promise<any> {
    this.ensureConnection();
    const [
      totalUsers,
      totalDrivers,
      onlineDrivers,
      pendingDrivers,
      totalRides,
      completedRides,
      activeRides,
      payments,
    ] = await Promise.all([
      UserModel.countDocuments(),
      DriverModel.countDocuments(),
      DriverModel.countDocuments({ isOnline: true, approvalStatus: 'APPROVED' }),
      DriverModel.countDocuments({ approvalStatus: 'PENDING' }),
      RideModel.countDocuments(),
      RideModel.countDocuments({ status: 'RIDE_COMPLETED' }),
      RideModel.countDocuments({
        status: { $in: ['SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'] },
      }),
      PaymentModel.find({ status: 'SUCCEEDED' }).lean(),
    ]);

    const totalGMV = payments.reduce((acc, p) => acc + (p.amount || 0), 0);
    const platformNetRevenue = Math.round(totalGMV * 0.2 * 100) / 100;

    return {
      totalUsers,
      totalDrivers,
      onlineDrivers,
      pendingDrivers,
      totalRides,
      completedRides,
      activeRides,
      totalGMV: Math.round(totalGMV * 100) / 100,
      platformNetRevenue,
    };
  }

  // ==========================================
  // PAGINATED ADMIN QUERIES & FINANCIAL SUMMARY
  // ==========================================
  public async getRidesPaginated(options: {
    page?: number;
    limit?: number;
    status?: string;
    riderId?: string;
    driverId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ data: IRide[]; total: number; page: number; totalPages: number }> {
    this.ensureConnection();
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const skip = (page - 1) * limit;

    const query: any = {};
    if (options.status) query.status = options.status;
    if (options.riderId) query.riderId = options.riderId;
    if (options.driverId) query.driverId = options.driverId;
    if (options.startDate || options.endDate) {
      query.createdAt = {};
      if (options.startDate) query.createdAt.$gte = new Date(options.startDate);
      if (options.endDate) query.createdAt.$lte = new Date(options.endDate);
    }

    const [total, docs] = await Promise.all([
      RideModel.countDocuments(query),
      RideModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    return {
      data: docs.map((d) => this.docToRide(d)),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  public async getUsersPaginated(options: {
    page?: number;
    limit?: number;
    role?: string;
    search?: string;
  }): Promise<{ data: Omit<IUser, 'passwordHash'>[]; total: number; page: number; totalPages: number }> {
    this.ensureConnection();
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const skip = (page - 1) * limit;

    const query: any = {};
    if (options.role) query.role = options.role;
    if (options.search) {
      const regex = new RegExp(options.search, 'i');
      query.$or = [{ name: regex }, { email: regex }, { phone: regex }];
    }

    const [total, docs] = await Promise.all([
      UserModel.countDocuments(query),
      UserModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    return {
      data: docs.map((d) => {
        const u = this.docToUser(d);
        const { passwordHash: _, ...userSafe } = u as any;
        return userSafe;
      }),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  public async getDriversPaginated(options: {
    page?: number;
    limit?: number;
    approvalStatus?: string;
    isOnline?: boolean;
    search?: string;
  }): Promise<{ data: IDriver[]; total: number; page: number; totalPages: number }> {
    this.ensureConnection();
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const skip = (page - 1) * limit;

    const query: any = {};
    if (options.approvalStatus) query.approvalStatus = options.approvalStatus;
    if (options.isOnline !== undefined) query.isOnline = options.isOnline;

    const [total, docs] = await Promise.all([
      DriverModel.countDocuments(query),
      DriverModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    const drivers = await Promise.all(
      docs.map(async (d) => {
        const driver = this.docToDriver(d);
        const vehicle = await this.findVehicleByDriverId(driver.id);
        if (vehicle) driver.vehicle = vehicle;
        return driver;
      })
    );

    return {
      data: drivers,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  public async getFinancialSummary(): Promise<{
    totalGrossVolume: number;
    totalPlatformRevenue: number;
    totalDriverPayouts: number;
    totalOutstandingDebt: number;
    transactionCount: number;
  }> {
    this.ensureConnection();
    const [payments, drivers] = await Promise.all([
      PaymentModel.find({ status: 'SUCCEEDED' }).lean(),
      DriverModel.find({ outstandingDebt: { $gt: 0 } }).lean(),
    ]);

    const totalGrossVolume = Math.round(payments.reduce((acc, p) => acc + (p.amount || 0), 0) * 100) / 100;
    const totalPlatformRevenue = Math.round(totalGrossVolume * 0.2 * 100) / 100;
    const totalDriverPayouts = Math.round((totalGrossVolume - totalPlatformRevenue) * 100) / 100;
    const totalOutstandingDebt = Math.round(drivers.reduce((acc, d) => acc + ((d as any).outstandingDebt || 0), 0) * 100) / 100;

    return {
      totalGrossVolume,
      totalPlatformRevenue,
      totalDriverPayouts,
      totalOutstandingDebt,
      transactionCount: payments.length,
    };
  }

  // ==========================================
  // REFRESH SESSION OPERATIONS (TOKEN ROTATION)
  // ==========================================
  public async createRefreshSession(session: {
    userId: string;
    jti: string;
    tokenHash: string;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
  }): Promise<IRefreshSession> {
    this.ensureConnection();
    const created = await RefreshSessionModel.create({
      _id: new mongoose.Types.ObjectId(),
      userId: session.userId,
      jti: session.jti,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt,
      ip: session.ip,
      userAgent: session.userAgent,
    });
    return {
      id: created._id.toString(),
      userId: created.userId,
      jti: created.jti,
      tokenHash: created.tokenHash,
      revoked: created.revoked,
      revokedReason: created.revokedReason,
      expiresAt: created.expiresAt.toISOString(),
      ip: created.ip,
      userAgent: created.userAgent,
      createdAt: created.createdAt.toISOString(),
    };
  }

  public async findRefreshSessionByJti(jti: string): Promise<IRefreshSession | null> {
    this.ensureConnection();
    const doc = await RefreshSessionModel.findOne({ jti }).lean();
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      userId: doc.userId,
      jti: doc.jti,
      tokenHash: doc.tokenHash,
      revoked: doc.revoked,
      revokedReason: doc.revokedReason,
      expiresAt: doc.expiresAt.toISOString(),
      ip: doc.ip,
      userAgent: doc.userAgent,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  public async revokeRefreshSession(jti: string, reason: string = 'LOGOUT'): Promise<void> {
    this.ensureConnection();
    await RefreshSessionModel.findOneAndUpdate(
      { jti },
      { $set: { revoked: true, revokedReason: reason } }
    );
  }

  public async revokeAllSessionsForUser(userId: string, reason: string = 'LOGOUT_ALL'): Promise<void> {
    this.ensureConnection();
    await RefreshSessionModel.updateMany(
      { userId },
      { $set: { revoked: true, revokedReason: reason } }
    );
  }
}

// In production, instantiate the real MongoDatabaseStore
export let db: IDatabaseStore = new MongoDatabaseStore();

// Exclusively for isolated test suites to inject a test harness store if needed
export function setDatabaseStore(store: IDatabaseStore): void {
  db = store;
}
