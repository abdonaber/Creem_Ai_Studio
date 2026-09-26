import mongoose from 'mongoose';
import { config } from '../config';
import { logger } from '../utils/logger';
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
  PaymentStatus,
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
  findPaymentByStripeCharge(chargeId: string): Promise<IPayment | null>;
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
    status?: 'PROCESSED' | 'FAILED' | 'REQUIRES_RECONCILIATION',
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
  settleStripePaymentSucceeded(params: {
    paymentIntentId: string;
    eventId: string;
    amount?: number;
    metadata?: Record<string, any>;
  }): Promise<{ success: boolean; paymentId: string; alreadySettled?: boolean }>;
  settleStripeRefund(params: {
    paymentIntentId: string;
    eventId: string;
    refundAmount?: number;
    cumulativeAmountRefunded?: number;
    refundDelta?: number;
    reason?: string;
    currency?: string;
    refundId?: string;
  }): Promise<{
    success: boolean;
    paymentId: string;
    alreadyRefunded?: boolean;
    refundAmount: number;
    refundDelta: number;
    isPartial: boolean;
    status: PaymentStatus;
  }>;
  trackRefundState(params: {
    paymentIntentId: string;
    refundId: string;
    amount: number;
    status: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'requires_action';
    eventId?: string;
    reason?: string;
  }): Promise<void>;

  // Financial Reconciliation
  recordReconciliationDiscrepancy(discrepancy: {
    type: string;
    id: string;
    details: string;
  }): Promise<void>;
  reconcileFinancialIntegrity(): Promise<{
    healthy: boolean;
    discrepanciesCount: number;
    discrepancies: Array<{
      type: 'WALLET_MISMATCH' | 'PAYMENT_RIDE_MISMATCH' | 'COMMISSION_MISMATCH' | 'DRIVER_DEBT_MISMATCH' | 'DRIVER_EARNINGS_MISMATCH';
      id: string;
      details: string;
    }>;
  }>;


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
      currentLocation:
        doc.currentLocation?.lat != null && doc.currentLocation?.lng != null
          ? {
              lat: doc.currentLocation.lat,
              lng: doc.currentLocation.lng,
              heading: doc.currentLocation?.heading || 0,
              updatedAt:
                doc.currentLocation?.updatedAt?.toISOString?.() ||
                new Date(doc.currentLocation?.updatedAt || Date.now()).toISOString(),
            }
          : undefined,
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
      currentLocation: driver.currentLocation
        ? {
            lat: driver.currentLocation.lat,
            lng: driver.currentLocation.lng,
            heading: driver.currentLocation.heading || 0,
            updatedAt: new Date(driver.currentLocation.updatedAt || Date.now()),
          }
        : undefined,
      location: driver.currentLocation
        ? {
            type: 'Point',
            coordinates: [driver.currentLocation.lng, driver.currentLocation.lat],
          }
        : undefined,
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

    // Check if ride was already accepted by this captain (Idempotent acceptance)
    const initialRideQuery = mongoose.Types.ObjectId.isValid(rideId) ? { _id: rideId } : { id: rideId };
    const preCheckRide = await RideModel.findOne(initialRideQuery).lean();
    if (
      preCheckRide &&
      preCheckRide.driverId === driverId &&
      ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'].includes(preCheckRide.status)
    ) {
      return { success: true, ride: this.docToRide(preCheckRide) };
    }

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
          $or: [{ isBusy: { $ne: true } }, { activeRideId: rideId }],
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

    // Stale driver exclusion (Phase 8 Production Hardening): unified freshness threshold
    const staleCutoff = new Date(Date.now() - config.driverLocationStaleMs);
    matchFilter.$or = [
      { lastSeenAt: { $gte: staleCutoff } },
      { 'currentLocation.updatedAt': { $gte: staleCutoff.toISOString() } },
    ];


    if (excludedDriverIds.length > 0) {
      const validIds = excludedDriverIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      if (validIds.length > 0) {
        matchFilter._id = { $nin: validIds };
      }
    }

    try {
      // 1. Production MongoDB 2dsphere $geoNear aggregation with server-side vehicle lookup
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
        {
          $lookup: {
            from: 'vehicles',
            let: { driverIdStr: { $toString: '$_id' } },
            pipeline: [
              { $match: { $expr: { $eq: ['$driverId', '$$driverIdStr'] } } },
            ],
            as: 'vehicleDoc',
          },
        },
        {
          $unwind: {
            path: '$vehicleDoc',
            preserveNullAndEmptyArrays: false, // Driver must possess an approved vehicle
          },
        },
      ];

      if (category) {
        pipeline.push({
          $match: {
            'vehicleDoc.category': category,
          },
        });
      }

      pipeline.push({ $limit: 25 });

      const geoDocs = await DriverModel.aggregate(pipeline);
      const results: Array<{ driver: IDriver; distanceKm: number }> = [];

      for (const doc of geoDocs) {
        const driver = this.docToDriver(doc);
        if (doc.vehicleDoc) {
          driver.vehicle = this.docToVehicle(doc.vehicleDoc);
        }
        const distanceKm = Math.round((doc.calculatedDistanceMeters / 1000) * 100) / 100;
        results.push({ driver, distanceKm });
      }

      return results;
    } catch (err: any) {
      // Phase 7 Production Hardening: NEVER fallback to full fleet memory scan!
      // Fail safely, report operational error, and allow BullMQ dispatch queue to retry with backoff.
      logger.error(`[GeoDispatch] Failed geospatial query near [${pickupLat}, ${pickupLng}]: ${err.message}`);
      return [];
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

    // Try MongoDB transaction if available (replica set / Atlas deployment)
    const session = await mongoose.startSession().catch(() => null);
    if (session) {
      try {
        let result: { success: boolean; transactionId: string } | null = null;
        await session.withTransaction(async () => {
          const existingPayment = await PaymentModel.findOne({ rideId, status: 'SUCCEEDED' })
            .session(session)
            .lean();
          if (existingPayment) {
            result = { success: true, transactionId: existingPayment._id.toString() };
            return;
          }

          // 1. Debit rider
          const updatedRiderWallet = await WalletModel.findOneAndUpdate(
            { userId: riderId, balance: { $gte: amount } },
            { $inc: { balance: -amount }, $set: { updatedAt: new Date() } },
            { session, new: true }
          ).lean();

          if (!updatedRiderWallet) {
            throw new AppError('Insufficient wallet balance to complete payment.', 400, 'INSUFFICIENT_FUNDS');
          }

          await WalletTransactionModel.create(
            [
              {
                _id: new mongoose.Types.ObjectId(),
                walletId: updatedRiderWallet._id.toString(),
                userId: riderId,
                amount,
                type: 'DEBIT',
                balanceAfter: updatedRiderWallet.balance,
                reason: `Payment for ride #${rideId.slice(0, 8)}`,
                referenceId: rideId,
                idempotencyKey: idempotencyKey ? `${idempotencyKey}_debit` : undefined,
              },
            ],
            { session }
          );

          await PlatformLedgerModel.create(
            [
              {
                _id: new mongoose.Types.ObjectId(),
                rideId,
                type: 'RIDER_FARE',
                amount,
                currency: 'SAR',
                fromAccount: `rider:${riderId}`,
                toAccount: 'platform:escrow',
                status: 'SETTLED',
                idempotencyKey: idempotencyKey ? `${idempotencyKey}_ledger_fare` : undefined,
              },
            ],
            { session }
          );

          // 2. Driver earning & platform commission
          if (driverId) {
            const driver = await DriverModel.findById(driverId).session(session).lean();
            if (driver) {
              const driverEarning = Math.round(amount * 0.8 * 100) / 100;
              const platformCommission = Math.round((amount - driverEarning) * 100) / 100;

              let debtRecovery = 0;
              if (driver.outstandingDebt && driver.outstandingDebt > 0) {
                debtRecovery = Math.min(driverEarning, driver.outstandingDebt);
              }

              const netPayout = driverEarning - debtRecovery;
              if (netPayout > 0) {
                let driverWallet = await WalletModel.findOne({ userId: driver.userId }).session(session).lean();
                if (!driverWallet) {
                  const created = await WalletModel.create(
                    [{ _id: new mongoose.Types.ObjectId(), userId: driver.userId, balance: 0, currency: 'SAR' }],
                    { session }
                  );
                  driverWallet = created[0].toObject();
                }

                const updatedDriverWallet = await WalletModel.findOneAndUpdate(
                  { userId: driver.userId },
                  { $inc: { balance: netPayout }, $set: { updatedAt: new Date() } },
                  { session, new: true }
                ).lean();

                await WalletTransactionModel.create(
                  [
                    {
                      _id: new mongoose.Types.ObjectId(),
                      walletId: updatedDriverWallet!._id.toString(),
                      userId: driver.userId,
                      amount: netPayout,
                      type: 'CREDIT',
                      balanceAfter: updatedDriverWallet!.balance,
                      reason: `Net earnings for ride #${rideId.slice(0, 8)} (80% minus debt recovery)`,
                      referenceId: rideId,
                      idempotencyKey: idempotencyKey ? `${idempotencyKey}_driver_credit` : undefined,
                    },
                  ],
                  { session }
                );
              }

              if (debtRecovery > 0) {
                await DriverModel.findByIdAndUpdate(
                  driver._id,
                  { $inc: { outstandingDebt: -debtRecovery } },
                  { session }
                );
                await PlatformLedgerModel.create(
                  [
                    {
                      _id: new mongoose.Types.ObjectId(),
                      rideId,
                      type: 'DEBT_RECOVERY',
                      amount: debtRecovery,
                      currency: 'SAR',
                      fromAccount: `driver:${driver.id}`,
                      toAccount: 'platform:commission',
                      status: 'SETTLED',
                      idempotencyKey: idempotencyKey ? `${idempotencyKey}_debt_rec` : undefined,
                    },
                  ],
                  { session }
                );
              }

              await PlatformLedgerModel.create(
                [
                  {
                    _id: new mongoose.Types.ObjectId(),
                    rideId,
                    type: 'PLATFORM_COMMISSION',
                    amount: platformCommission,
                    currency: 'SAR',
                    fromAccount: 'platform:escrow',
                    toAccount: 'platform:revenue',
                    status: 'COMMITTED',
                    idempotencyKey: idempotencyKey ? `${idempotencyKey}_ledger_comm` : undefined,
                  },
                ],
                { session }
              );

              await DriverModel.findByIdAndUpdate(
                driver._id,
                { $inc: { earningsTotal: driverEarning, totalRides: 1 } },
                { session }
              );
            }
          }

          // 3. Update ride payment status
          await RideModel.findOneAndUpdate(
            mongoose.Types.ObjectId.isValid(rideId) ? { _id: rideId } : { id: rideId },
            {
              $set: {
                paymentStatus: 'SUCCEEDED',
                paymentMethod: 'WALLET',
                finalFare: amount,
                updatedAt: new Date(),
              },
            },
            { session }
          );

          // 4. Create payment record
          const paymentDocs = await PaymentModel.create(
            [
              {
                _id: new mongoose.Types.ObjectId(),
                rideId,
                userId: riderId,
                amount,
                currency: 'SAR',
                status: 'SUCCEEDED',
                paymentMethod: 'WALLET',
                idempotencyKey,
              },
            ],
            { session }
          );

          result = { success: true, transactionId: paymentDocs[0]._id.toString() };
        });

        if (result) return result;
      } catch (err: any) {
        if (config.isProduction) {
          throw err;
        }
        if (!err.message?.includes('replica set') && !err.message?.includes('Transactions are not supported')) {
          throw err;
        }
      } finally {
        await session.endSession();
      }
    }

    if (config.isProduction) {
      throw new AppError(
        'FATAL: MongoDB transactions are strictly required in production for wallet settlement. Non-transactional fallback is forbidden.',
        500,
        'TRANSACTION_UNAVAILABLE_PRODUCTION'
      );
    }

    // Fallback: atomic serial execution for standalone mongod without replica set

    const existingPayment = await PaymentModel.findOne({ rideId, status: 'SUCCEEDED' }).lean();
    if (existingPayment) {
      return { success: true, transactionId: existingPayment._id.toString() };
    }

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

    if (driverId) {
      const driver = await this.findDriverById(driverId);
      if (driver) {
        const driverEarning = Math.round(amount * 0.8 * 100) / 100;
        const platformCommission = Math.round((amount - driverEarning) * 100) / 100;

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

    await this.updateRide(rideId, {
      paymentStatus: 'SUCCEEDED',
      paymentMethod: 'WALLET',
      finalFare: amount,
    });

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

    // Try MongoDB transaction if available
    const session = await mongoose.startSession().catch(() => null);
    if (session) {
      try {
        let result: { success: boolean; transactionId: string; platformFee: number; commissionDebt: number } | null = null;
        await session.withTransaction(async () => {
          const existingPayment = await PaymentModel.findOne({ rideId, status: 'SUCCEEDED' })
            .session(session)
            .lean();
          if (existingPayment) {
            result = {
              success: true,
              transactionId: existingPayment._id.toString(),
              platformFee: Math.round(amount * 0.2 * 100) / 100,
              commissionDebt: 0,
            };
            return;
          }

          const platformFee = Math.round(amount * 0.2 * 100) / 100;
          const driverEarning = Math.round((amount - platformFee) * 100) / 100;
          const driver = await DriverModel.findById(driverId).session(session).lean();
          let debtIncurred = 0;

          if (driver) {
            let driverWallet = await WalletModel.findOne({ userId: driver.userId }).session(session).lean();
            if (!driverWallet) {
              const created = await WalletModel.create(
                [{ _id: new mongoose.Types.ObjectId(), userId: driver.userId, balance: 0, currency: 'SAR' }],
                { session }
              );
              driverWallet = created[0].toObject();
            }

            if (driverWallet!.balance >= platformFee) {
              const updatedWallet = await WalletModel.findOneAndUpdate(
                { userId: driver.userId, balance: { $gte: platformFee } },
                { $inc: { balance: -platformFee }, $set: { updatedAt: new Date() } },
                { session, new: true }
              ).lean();

              await WalletTransactionModel.create(
                [
                  {
                    _id: new mongoose.Types.ObjectId(),
                    walletId: updatedWallet!._id.toString(),
                    userId: driver.userId,
                    amount: platformFee,
                    type: 'DEBIT',
                    balanceAfter: updatedWallet!.balance,
                    reason: `Platform commission (20%) for cash ride #${rideId.slice(0, 8)}`,
                    referenceId: rideId,
                    idempotencyKey: idempotencyKey ? `${idempotencyKey}_cash_comm` : undefined,
                  },
                ],
                { session }
              );

              await PlatformLedgerModel.create(
                [
                  {
                    _id: new mongoose.Types.ObjectId(),
                    rideId,
                    type: 'PLATFORM_COMMISSION',
                    amount: platformFee,
                    currency: 'SAR',
                    fromAccount: `driver:${driver.id}`,
                    toAccount: 'platform:commission',
                    status: 'COMMITTED',
                    idempotencyKey: idempotencyKey ? `${idempotencyKey}_ledger_comm` : undefined,
                  },
                ],
                { session }
              );
            } else {
              const available = Math.max(0, driverWallet!.balance);
              if (available > 0) {
                const updatedWallet = await WalletModel.findOneAndUpdate(
                  { userId: driver.userId },
                  { $set: { balance: 0, updatedAt: new Date() } },
                  { session, new: true }
                ).lean();

                await WalletTransactionModel.create(
                  [
                    {
                      _id: new mongoose.Types.ObjectId(),
                      walletId: updatedWallet!._id.toString(),
                      userId: driver.userId,
                      amount: available,
                      type: 'DEBIT',
                      balanceAfter: 0,
                      reason: `Partial platform commission for cash ride #${rideId.slice(0, 8)}`,
                      referenceId: rideId,
                      idempotencyKey: idempotencyKey ? `${idempotencyKey}_partial_comm` : undefined,
                    },
                  ],
                  { session }
                );
              }

              debtIncurred = Math.round((platformFee - available) * 100) / 100;
              await DriverModel.findByIdAndUpdate(
                driver._id,
                { $inc: { outstandingDebt: debtIncurred } },
                { session }
              );

              await PlatformLedgerModel.create(
                [
                  {
                    _id: new mongoose.Types.ObjectId(),
                    rideId,
                    type: 'COMMISSION_DEBT',
                    amount: debtIncurred,
                    currency: 'SAR',
                    fromAccount: `driver:${driver.id}`,
                    toAccount: 'platform:debt',
                    status: 'OUTSTANDING',
                    idempotencyKey: idempotencyKey ? `${idempotencyKey}_debt_inc` : undefined,
                  },
                ],
                { session }
              );
            }

            await DriverModel.findByIdAndUpdate(
              driver._id,
              { $inc: { earningsTotal: driverEarning, totalRides: 1 } },
              { session }
            );
          }

          await PlatformLedgerModel.create(
            [
              {
                _id: new mongoose.Types.ObjectId(),
                rideId,
                type: 'RIDER_FARE',
                amount,
                currency: 'SAR',
                fromAccount: `rider:${riderId}`,
                toAccount: `driver:${driverId}`,
                status: 'COMMITTED',
                idempotencyKey: idempotencyKey ? `${idempotencyKey}_rider_cash` : undefined,
              },
            ],
            { session }
          );

          await RideModel.findOneAndUpdate(
            mongoose.Types.ObjectId.isValid(rideId) ? { _id: rideId } : { id: rideId },
            {
              $set: {
                paymentStatus: 'SUCCEEDED',
                paymentMethod: 'CASH',
                finalFare: amount,
                updatedAt: new Date(),
              },
            },
            { session }
          );

          const paymentDocs = await PaymentModel.create(
            [
              {
                _id: new mongoose.Types.ObjectId(),
                rideId,
                userId: riderId,
                amount,
                currency: 'SAR',
                status: 'SUCCEEDED',
                paymentMethod: 'CASH',
                idempotencyKey,
              },
            ],
            { session }
          );

          result = {
            success: true,
            transactionId: paymentDocs[0]._id.toString(),
            platformFee,
            commissionDebt: debtIncurred,
          };
        });

        if (result) return result;
      } catch (err: any) {
        if (config.isProduction) {
          throw err;
        }
        if (!err.message?.includes('replica set') && !err.message?.includes('Transactions are not supported')) {
          throw err;
        }
      } finally {
        await session.endSession();
      }
    }

    if (config.isProduction) {
      throw new AppError(
        'FATAL: MongoDB transactions are strictly required in production for cash settlement. Non-transactional fallback is forbidden.',
        500,
        'TRANSACTION_UNAVAILABLE_PRODUCTION'
      );
    }

    // Fallback: atomic serial execution for standalone

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

  private docToPayment(doc: any): IPayment {
    return {
      id: doc._id.toString(),
      rideId: doc.rideId,
      userId: doc.userId,
      amount: doc.amount,
      currency: doc.currency,
      status: doc.status,
      paymentMethod: doc.paymentMethod,
      stripePaymentIntentId: doc.stripePaymentIntentId,
      stripeChargeId: doc.stripeChargeId,
      stripeClientSecret: doc.stripeClientSecret,
      idempotencyKey: doc.idempotencyKey,
      refundAmount: doc.refundAmount,
      refunds: doc.refunds?.map((r: any) => ({
        stripeRefundId: r.stripeRefundId,
        amount: r.amount,
        status: r.status,
        eventId: r.eventId,
        reason: r.reason,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : undefined,
      })),
      metadata: doc.metadata,
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
    };
  }

  public async findPaymentById(id: string): Promise<IPayment | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const doc = await PaymentModel.findOne(query).lean();
    return doc ? this.docToPayment(doc) : null;
  }

  public async findPaymentByRideId(rideId: string): Promise<IPayment | null> {
    this.ensureConnection();
    const doc = await PaymentModel.findOne({ rideId }).sort({ createdAt: -1 }).lean();
    return doc ? this.docToPayment(doc) : null;
  }

  public async findPaymentByStripeIntent(intentId: string): Promise<IPayment | null> {
    this.ensureConnection();
    const doc = await PaymentModel.findOne({ stripePaymentIntentId: intentId }).lean();
    return doc ? this.docToPayment(doc) : null;
  }

  public async findPaymentByStripeCharge(chargeId: string): Promise<IPayment | null> {
    this.ensureConnection();
    const doc = await PaymentModel.findOne({
      $or: [
        { stripeChargeId: chargeId },
        { 'metadata.stripeChargeId': chargeId },
        { stripePaymentIntentId: chargeId },
      ],
    }).lean();
    return doc ? this.docToPayment(doc) : null;
  }

  public async trackRefundState(params: {
    paymentIntentId: string;
    refundId: string;
    amount: number;
    status: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'requires_action';
    eventId?: string;
    reason?: string;
  }): Promise<void> {
    this.ensureConnection();
    const { paymentIntentId, refundId, amount, status, eventId, reason } = params;

    const payment = await PaymentModel.findOne({ stripePaymentIntentId: paymentIntentId });
    if (!payment) return;

    if (!payment.refunds) payment.refunds = [] as any;
    const existingIdx = payment.refunds.findIndex((r: any) => r.stripeRefundId === refundId);
    if (existingIdx >= 0) {
      payment.refunds[existingIdx].status = status;
      payment.refunds[existingIdx].amount = amount;
      if (reason) payment.refunds[existingIdx].reason = reason;
      if (eventId) payment.refunds[existingIdx].eventId = eventId;
      payment.refunds[existingIdx].updatedAt = new Date();
    } else {
      payment.refunds.push({
        stripeRefundId: refundId,
        amount,
        status,
        eventId,
        reason,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }
    await payment.save();
  }

  public async recordReconciliationDiscrepancy(discrepancy: {
    type: string;
    id: string;
    details: string;
  }): Promise<void> {
    this.ensureConnection();
    await this.logAudit(
      'system',
      `RECONCILIATION_FLAG:${discrepancy.type}`,
      { ...discrepancy }
    );
  }

  public async updatePayment(id: string, updates: Partial<IPayment>): Promise<IPayment | null> {
    this.ensureConnection();
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { id };
    const doc = await PaymentModel.findOneAndUpdate(query, { $set: updates }, { new: true }).lean();
    return doc ? this.docToPayment(doc) : null;
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
    type: string,
    leaseDurationMs: number = 60000
  ): Promise<{ claimed: boolean; alreadyProcessed: boolean }> {
    this.ensureConnection();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

    try {
      await WebhookEventModel.create({
        _id: new mongoose.Types.ObjectId(),
        eventId,
        source,
        type,
        status: 'PROCESSING',
        leaseExpiresAt,
      });
      return { claimed: true, alreadyProcessed: false };
    } catch (err: any) {
      if (err.code === 11000 || err.message?.includes('duplicate key')) {
        const existing = await WebhookEventModel.findOne({ eventId }).lean();
        if (existing?.status === 'PROCESSED') {
          return { claimed: false, alreadyProcessed: true };
        }
        // If lease expired due to worker crash, recover lease and process
        if (existing?.leaseExpiresAt && new Date(existing.leaseExpiresAt) < now) {
          const updated = await WebhookEventModel.findOneAndUpdate(
            { eventId, leaseExpiresAt: existing.leaseExpiresAt },
            { $set: { status: 'PROCESSING', leaseExpiresAt, updatedAt: now } },
            { new: true }
          );
          if (updated) {
            return { claimed: true, alreadyProcessed: false };
          }
        }
        // If status was FAILED, allow safe retry
        if (existing?.status === 'FAILED') {
          const updated = await WebhookEventModel.findOneAndUpdate(
            { eventId, status: 'FAILED' },
            { $set: { status: 'PROCESSING', leaseExpiresAt, updatedAt: now } },
            { new: true }
          );
          if (updated) {
            return { claimed: true, alreadyProcessed: false };
          }
        }
        return { claimed: false, alreadyProcessed: false };
      }
      throw err;
    }
  }

  public async recordProcessedWebhook(
    eventId: string,
    source: string = 'stripe',
    type: string = 'payment_intent.succeeded',
    payload?: any,
    status: 'PROCESSED' | 'FAILED' | 'REQUIRES_RECONCILIATION' = 'PROCESSED',
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

  /**
   * Atomic Stripe Webhook Payment Settlement (Phase 6 Hardening)
   * Executes payment, ride status, ledger entries, driver earnings, and debt recovery
   * atomically within a single MongoDB session transaction.
   */
  public async settleStripePaymentSucceeded(params: {
    paymentIntentId: string;
    eventId: string;
    amount?: number;
    metadata?: Record<string, any>;
  }): Promise<{ success: boolean; paymentId: string; alreadySettled?: boolean }> {
    this.ensureConnection();
    const { paymentIntentId, eventId } = params;

    const session = await mongoose.startSession().catch(() => null);
    if (!session && config.isProduction) {
      throw new AppError(
        'FATAL: MongoDB transactions are strictly required in production for Stripe webhook settlement.',
        500,
        'TRANSACTION_UNAVAILABLE_PRODUCTION'
      );
    }

    if (session) {
      try {
        let result: { success: boolean; paymentId: string; alreadySettled?: boolean } | null = null;
        await session.withTransaction(async () => {
          const payment = await PaymentModel.findOne({ stripePaymentIntentId: paymentIntentId }).session(session);
          if (!payment) {
            throw new AppError(`Payment not found for Stripe intent ${paymentIntentId}`, 404, 'PAYMENT_NOT_FOUND');
          }

          if (payment.status === 'SUCCEEDED') {
            result = { success: true, paymentId: payment._id.toString(), alreadySettled: true };
            return;
          }

          // 1. Mark payment SUCCEEDED
          payment.status = 'SUCCEEDED';
          payment.updatedAt = new Date();
          await payment.save({ session });

          // 2. Mark ride SUCCEEDED
          await RideModel.findOneAndUpdate(
            mongoose.Types.ObjectId.isValid(payment.rideId) ? { _id: payment.rideId } : { id: payment.rideId },
            {
              $set: {
                paymentStatus: 'SUCCEEDED',
                paymentMethod: 'CREDIT_CARD',
                finalFare: payment.amount,
                updatedAt: new Date(),
              },
            },
            { session }
          );

          // 3. Platform Ledger fare entry
          await PlatformLedgerModel.create(
            [
              {
                _id: new mongoose.Types.ObjectId(),
                rideId: payment.rideId,
                type: 'RIDER_FARE',
                amount: payment.amount,
                currency: 'SAR',
                fromAccount: `rider:${payment.userId}`,
                toAccount: 'platform:escrow',
                status: 'SETTLED',
                idempotencyKey: `webhook_${eventId}_fare`,
              },
            ],
            { session }
          );

          // 4. Driver earnings, debt recovery, and platform commission
          const ride = await RideModel.findById(payment.rideId).session(session).lean();
          if (ride?.driverId) {
            const driver = await DriverModel.findById(ride.driverId).session(session).lean();
            if (driver) {
              const driverEarning = Math.round(payment.amount * 0.8 * 100) / 100;
              const platformCommission = Math.round((payment.amount - driverEarning) * 100) / 100;

              let debtRecovery = 0;
              if (driver.outstandingDebt && driver.outstandingDebt > 0) {
                debtRecovery = Math.min(driverEarning, driver.outstandingDebt);
              }

              const netPayout = driverEarning - debtRecovery;
              if (netPayout > 0) {
                let driverWallet = await WalletModel.findOne({ userId: driver.userId }).session(session).lean();
                if (!driverWallet) {
                  const created = await WalletModel.create(
                    [{ _id: new mongoose.Types.ObjectId(), userId: driver.userId, balance: 0, currency: 'SAR' }],
                    { session }
                  );
                  driverWallet = created[0].toObject();
                }

                const updatedDriverWallet = await WalletModel.findOneAndUpdate(
                  { userId: driver.userId },
                  { $inc: { balance: netPayout }, $set: { updatedAt: new Date() } },
                  { session, new: true }
                ).lean();

                await WalletTransactionModel.create(
                  [
                    {
                      _id: new mongoose.Types.ObjectId(),
                      walletId: updatedDriverWallet!._id.toString(),
                      userId: driver.userId,
                      amount: netPayout,
                      type: 'CREDIT',
                      balanceAfter: updatedDriverWallet!.balance,
                      reason: `Net earnings for card ride #${payment.rideId.slice(0, 8)} (minus debt recovery)`,
                      referenceId: payment.rideId,
                      idempotencyKey: `webhook_${eventId}_driver_credit`,
                    },
                  ],
                  { session }
                );
              }

              if (debtRecovery > 0) {
                await DriverModel.findByIdAndUpdate(
                  driver._id,
                  { $inc: { outstandingDebt: -debtRecovery } },
                  { session }
                );
                await PlatformLedgerModel.create(
                  [
                    {
                      _id: new mongoose.Types.ObjectId(),
                      rideId: payment.rideId,
                      type: 'DEBT_RECOVERY',
                      amount: debtRecovery,
                      currency: 'SAR',
                      fromAccount: `driver:${driver._id.toString()}`,
                      toAccount: 'platform:commission',
                      status: 'SETTLED',
                      idempotencyKey: `webhook_${eventId}_debt_rec`,
                    },
                  ],
                  { session }
                );
              }

              await PlatformLedgerModel.create(
                [
                  {
                    _id: new mongoose.Types.ObjectId(),
                    rideId: payment.rideId,
                    type: 'PLATFORM_COMMISSION',
                    amount: platformCommission,
                    currency: 'SAR',
                    fromAccount: 'platform:escrow',
                    toAccount: 'platform:revenue',
                    status: 'COMMITTED',
                    idempotencyKey: `webhook_${eventId}_ledger_comm`,
                  },
                ],
                { session }
              );

              await DriverModel.findByIdAndUpdate(
                driver._id,
                { $inc: { earningsTotal: driverEarning, totalRides: 1 } },
                { session }
              );
            }
          }

          result = { success: true, paymentId: payment._id.toString() };
        });

        if (result) return result;
      } catch (err: any) {
        if (config.isProduction) {
          throw err;
        }
        if (!err.message?.includes('replica set') && !err.message?.includes('Transactions are not supported')) {
          throw err;
        }
      } finally {
        await session.endSession();
      }
    }

    if (config.isProduction) {
      throw new AppError(
        'FATAL: MongoDB transactions are strictly required in production for Stripe webhook settlement.',
        500,
        'TRANSACTION_UNAVAILABLE_PRODUCTION'
      );
    }

    // Fallback for standalone Mongo development environment
    const payment = await this.findPaymentByStripeIntent(paymentIntentId);
    if (!payment) throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
    if (payment.status === 'SUCCEEDED') return { success: true, paymentId: payment.id, alreadySettled: true };
    await this.updatePayment(payment.id, { status: 'SUCCEEDED' });
    await this.updateRide(payment.rideId, { paymentStatus: 'SUCCEEDED', finalFare: payment.amount });
    await this.recordLedgerEntry({
      rideId: payment.rideId,
      type: 'RIDER_FARE',
      amount: payment.amount,
      currency: 'SAR',
      fromAccount: `rider:${payment.userId}`,
      toAccount: 'platform:escrow',
      status: 'SETTLED',
      idempotencyKey: `webhook_${eventId}_fare`,
    });
    return { success: true, paymentId: payment.id };
  }

  public async settleStripeRefund(params: {
    paymentIntentId: string;
    eventId: string;
    refundAmount?: number;
    cumulativeAmountRefunded?: number;
    refundDelta?: number;
    reason?: string;
    currency?: string;
    refundId?: string;
  }): Promise<{
    success: boolean;
    paymentId: string;
    alreadyRefunded?: boolean;
    refundAmount: number;
    refundDelta: number;
    isPartial: boolean;
    status: PaymentStatus;
  }> {
    this.ensureConnection();
    const { paymentIntentId, eventId } = params;

    const session = await mongoose.startSession().catch(() => null);
    if (!session && config.isProduction) {
      throw new AppError(
        'FATAL: MongoDB transactions are strictly required in production for Stripe webhook refund.',
        500,
        'TRANSACTION_UNAVAILABLE_PRODUCTION'
      );
    }

    if (session) {
      try {
        let result: {
          success: boolean;
          paymentId: string;
          alreadyRefunded?: boolean;
          refundAmount: number;
          refundDelta: number;
          isPartial: boolean;
          status: PaymentStatus;
        } | null = null;

        await session.withTransaction(async () => {
          const payment = await PaymentModel.findOne({ stripePaymentIntentId: paymentIntentId }).session(session);
          if (!payment) {
            throw new AppError(`Payment not found for Stripe intent ${paymentIntentId}`, 404, 'PAYMENT_NOT_FOUND');
          }

          if (params.currency && payment.currency && params.currency.toUpperCase() !== payment.currency.toUpperCase()) {
            throw new AppError(
              `Refund currency ${params.currency} does not match payment currency ${payment.currency}`,
              400,
              'CURRENCY_MISMATCH'
            );
          }

          const existingRefunded = Math.round((payment.refundAmount || 0) * 100) / 100;
          const totalAmount = Math.round(payment.amount * 100) / 100;

          // Unique Stripe Refund ID check to prevent duplicate settlements
          if (params.refundId && payment.refunds) {
            const alreadyProcessedRefund = (payment.refunds as any[]).find(
              (r) => r.stripeRefundId === params.refundId && r.status === 'succeeded'
            );
            if (alreadyProcessedRefund) {
              const isCurrentPartial = existingRefunded < totalAmount && payment.status === 'PARTIALLY_REFUNDED';
              result = {
                success: true,
                paymentId: payment._id.toString(),
                alreadyRefunded: true,
                refundAmount: existingRefunded,
                refundDelta: 0,
                isPartial: isCurrentPartial,
                status: payment.status,
              };
              return;
            }
          }

          let targetCumulative: number;
          let delta: number;

          if (params.cumulativeAmountRefunded !== undefined && params.cumulativeAmountRefunded !== null) {
            if (typeof params.cumulativeAmountRefunded !== 'number' || isNaN(params.cumulativeAmountRefunded) || !isFinite(params.cumulativeAmountRefunded)) {
              throw new AppError('Provided refund amount must be a finite, valid number', 400, 'INVALID_REFUND_AMOUNT');
            }
            if (params.cumulativeAmountRefunded < 0) {
              throw new AppError('Refund amount cannot be negative', 400, 'INVALID_REFUND_AMOUNT');
            }
            targetCumulative = Math.round(params.cumulativeAmountRefunded * 100) / 100;
            delta = Math.round((targetCumulative - existingRefunded) * 100) / 100;
          } else if (params.refundDelta !== undefined && params.refundDelta !== null) {
            if (typeof params.refundDelta !== 'number' || isNaN(params.refundDelta) || !isFinite(params.refundDelta)) {
              throw new AppError('Provided refund delta must be a finite, valid number', 400, 'INVALID_REFUND_AMOUNT');
            }
            if (params.refundDelta <= 0) {
              throw new AppError('Refund delta must be greater than 0', 400, 'INVALID_REFUND_AMOUNT');
            }
            delta = Math.round(params.refundDelta * 100) / 100;
            targetCumulative = Math.round((existingRefunded + delta) * 100) / 100;
          } else if (params.refundAmount !== undefined && params.refundAmount !== null) {
            if (typeof params.refundAmount !== 'number' || isNaN(params.refundAmount) || !isFinite(params.refundAmount)) {
              throw new AppError('Provided refund amount must be a finite, valid number', 400, 'INVALID_REFUND_AMOUNT');
            }
            if (params.refundAmount <= 0) {
              throw new AppError('Refund amount must be greater than 0', 400, 'INVALID_REFUND_AMOUNT');
            }
            targetCumulative = Math.round(params.refundAmount * 100) / 100;
            delta = Math.round((targetCumulative - existingRefunded) * 100) / 100;
          } else {
            delta = Math.round((totalAmount - existingRefunded) * 100) / 100;
            targetCumulative = totalAmount;
          }

          // Idempotency: If delta <= 0 or already fully refunded, no mutation
          if (delta <= 0 || (payment.status === 'REFUNDED' && existingRefunded >= totalAmount)) {
            const isCurrentPartial = existingRefunded < totalAmount && payment.status === 'PARTIALLY_REFUNDED';
            result = {
              success: true,
              paymentId: payment._id.toString(),
              alreadyRefunded: true,
              refundAmount: existingRefunded,
              refundDelta: 0,
              isPartial: isCurrentPartial,
              status: payment.status,
            };
            return;
          }

          // Strict validation: Decimal precision (maximum 2 decimal places)
          const decimalPart = String(delta).split('.')[1];
          if (decimalPart && decimalPart.length > 2) {
            throw new AppError('Refund amount precision abuse: maximum 2 decimal places allowed for SAR', 400, 'INVALID_REFUND_PRECISION');
          }
          if (delta < 0.01) {
            throw new AppError('Refund amount must be at least 0.01 SAR (smallest currency unit)', 400, 'INVALID_REFUND_AMOUNT');
          }

          if (targetCumulative > totalAmount) {
            throw new AppError(
              `Refund cumulative amount (${targetCumulative} SAR) exceeds original payment amount (${totalAmount} SAR)`,
              400,
              'REFUND_AMOUNT_EXCEEDS_BALANCE'
            );
          }

          const remainingBalance = Math.round((totalAmount - existingRefunded) * 100) / 100;
          if (delta > remainingBalance) {
            throw new AppError(
              `Refund delta (${delta} SAR) exceeds remaining refundable balance (${remainingBalance} SAR)`,
              400,
              'REFUND_AMOUNT_EXCEEDS_BALANCE'
            );
          }

          const isPartial = targetCumulative < totalAmount;
          const newStatus: PaymentStatus = isPartial ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
          const keySuffix = params.refundId ? `ref_${params.refundId}` : `c_${Math.round(targetCumulative * 100)}`;

          // Reversal of Driver Earnings and Platform Commission when fare was settled
          const ride = await RideModel.findById(payment.rideId).session(session);
          const fareSettled = payment.status === 'SUCCEEDED' || payment.status === 'PARTIALLY_REFUNDED' || (payment.metadata as any)?.settledToDriver;

          if (fareSettled && ride?.driverId) {
            const driver = await DriverModel.findById(ride.driverId).session(session);
            if (driver) {
              const driverReversal = Math.round(delta * 0.8 * 100) / 100;
              const platformReversal = Math.round((delta - driverReversal) * 100) / 100;

              // 1. Decrement driver earningsTotal
              const newEarningsTotal = Math.max(0, (driver.earningsTotal || 0) - driverReversal);
              await DriverModel.findByIdAndUpdate(
                driver._id,
                { $set: { earningsTotal: newEarningsTotal } },
                { session }
              );

              // 2. Adjust driver wallet or record debt
              let driverWallet = await WalletModel.findOne({ userId: driver.userId }).session(session);
              if (!driverWallet) {
                const created = await WalletModel.create(
                  [{ _id: new mongoose.Types.ObjectId(), userId: driver.userId, balance: 0, currency: 'SAR' }],
                  { session }
                );
                driverWallet = created[0];
              }

              const availableWallet = Math.max(0, driverWallet.balance);
              if (availableWallet >= driverReversal) {
                const updatedWallet = await WalletModel.findOneAndUpdate(
                  { userId: driver.userId },
                  { $inc: { balance: -driverReversal }, $set: { updatedAt: new Date() } },
                  { session, new: true }
                );

                await WalletTransactionModel.create(
                  [
                    {
                      _id: new mongoose.Types.ObjectId(),
                      walletId: updatedWallet!._id.toString(),
                      userId: driver.userId,
                      amount: driverReversal,
                      type: 'DEBIT',
                      balanceAfter: updatedWallet!.balance,
                      reason: `Earnings reversal on refund for ride #${payment.rideId.slice(0, 8)}`,
                      referenceId: payment.rideId,
                      idempotencyKey: `webhook_${eventId}_driver_wal_${keySuffix}`,
                    },
                  ],
                  { session }
                );
              } else {
                if (availableWallet > 0) {
                  await WalletModel.findOneAndUpdate(
                    { userId: driver.userId },
                    { $set: { balance: 0, updatedAt: new Date() } },
                    { session }
                  );

                  await WalletTransactionModel.create(
                    [
                      {
                        _id: new mongoose.Types.ObjectId(),
                        walletId: driverWallet._id.toString(),
                        userId: driver.userId,
                        amount: availableWallet,
                        type: 'DEBIT',
                        balanceAfter: 0,
                        reason: `Partial earnings reversal on refund for ride #${payment.rideId.slice(0, 8)}`,
                        referenceId: payment.rideId,
                        idempotencyKey: `webhook_${eventId}_driver_wal_part_${keySuffix}`,
                      },
                    ],
                    { session }
                  );
                }

                const debtIncurred = Math.round((driverReversal - availableWallet) * 100) / 100;
                await DriverModel.findByIdAndUpdate(
                  driver._id,
                  { $inc: { outstandingDebt: debtIncurred } },
                  { session }
                );

                await PlatformLedgerModel.create(
                  [
                    {
                      _id: new mongoose.Types.ObjectId(),
                      rideId: payment.rideId,
                      type: 'COMMISSION_DEBT',
                      amount: debtIncurred,
                      currency: payment.currency || 'SAR',
                      fromAccount: `driver:${driver._id.toString()}`,
                      toAccount: 'platform:debt',
                      status: 'OUTSTANDING',
                      idempotencyKey: `webhook_${eventId}_driver_debt_${keySuffix}`,
                    },
                  ],
                  { session }
                );
              }

              // 3. Compensating Driver Reversal entry into PlatformLedger (funds return to escrow)
              await PlatformLedgerModel.create(
                [
                  {
                    _id: new mongoose.Types.ObjectId(),
                    rideId: payment.rideId,
                    type: 'DRIVER_EARNING',
                    amount: driverReversal,
                    currency: payment.currency || 'SAR',
                    fromAccount: `driver:${driver._id.toString()}`,
                    toAccount: 'platform:escrow',
                    status: 'SETTLED',
                    idempotencyKey: `webhook_${eventId}_driver_rev_${keySuffix}`,
                  },
                ],
                { session }
              );

              // 4. Platform Commission Reversal into PlatformLedger (funds return to escrow)
              await PlatformLedgerModel.create(
                [
                  {
                    _id: new mongoose.Types.ObjectId(),
                    rideId: payment.rideId,
                    type: 'PLATFORM_COMMISSION',
                    amount: platformReversal,
                    currency: payment.currency || 'SAR',
                    fromAccount: 'platform:revenue',
                    toAccount: 'platform:escrow',
                    status: 'SETTLED',
                    idempotencyKey: `webhook_${eventId}_comm_rev_${keySuffix}`,
                  },
                ],
                { session }
              );
            }
          }

          // 5. Rider Refund entry from escrow
          const idempotencyKey = `webhook_${eventId}_refund_${keySuffix}`;
          await PlatformLedgerModel.create(
            [
              {
                _id: new mongoose.Types.ObjectId(),
                rideId: payment.rideId,
                type: 'REFUND',
                amount: delta,
                currency: payment.currency || 'SAR',
                fromAccount: 'platform:escrow',
                toAccount: `rider:${payment.userId}`,
                status: 'SETTLED',
                idempotencyKey,
              },
            ],
            { session }
          );

          // 6. Update Payment status and cumulative refundAmount and track refunds array
          payment.status = newStatus;
          payment.refundAmount = targetCumulative;
          payment.updatedAt = new Date();

          if (!payment.refunds) payment.refunds = [] as any;
          const rIdx = payment.refunds.findIndex(
            (r: any) => r.stripeRefundId === (params.refundId || keySuffix)
          );
          if (rIdx >= 0) {
            payment.refunds[rIdx].status = 'succeeded';
            payment.refunds[rIdx].amount = delta;
            payment.refunds[rIdx].updatedAt = new Date();
          } else {
            payment.refunds.push({
              stripeRefundId: params.refundId || keySuffix,
              amount: delta,
              status: 'succeeded',
              eventId,
              reason: params.reason,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as any);
          }

          await payment.save({ session });

          // 7. Update Ride paymentStatus
          await RideModel.findOneAndUpdate(
            mongoose.Types.ObjectId.isValid(payment.rideId) ? { _id: payment.rideId } : { id: payment.rideId },
            {
              $set: {
                paymentStatus: newStatus,
                updatedAt: new Date(),
              },
            },
            { session }
          );

          result = {
            success: true,
            paymentId: payment._id.toString(),
            alreadyRefunded: false,
            refundAmount: targetCumulative,
            refundDelta: delta,
            isPartial,
            status: newStatus,
          };
        });

        if (result) return result;
      } catch (err: any) {
        if (config.isProduction) {
          throw err;
        }
        if (!err.message?.includes('replica set') && !err.message?.includes('Transactions are not supported')) {
          throw err;
        }
      } finally {
        await session.endSession();
      }
    }

    if (config.isProduction) {
      throw new AppError(
        'FATAL: MongoDB transactions are strictly required in production for Stripe webhook refund.',
        500,
        'TRANSACTION_UNAVAILABLE_PRODUCTION'
      );
    }

    // Fallback for standalone Mongo development environment
    const payment = await this.findPaymentByStripeIntent(paymentIntentId);
    if (!payment) throw new AppError(`Payment not found for Stripe intent ${paymentIntentId}`, 404, 'PAYMENT_NOT_FOUND');

    if (params.currency && payment.currency && params.currency.toUpperCase() !== payment.currency.toUpperCase()) {
      throw new AppError(
        `Refund currency ${params.currency} does not match payment currency ${payment.currency}`,
        400,
        'CURRENCY_MISMATCH'
      );
    }

    const existingRefunded = Math.round(((payment as any).refundAmount || 0) * 100) / 100;
    const totalAmount = Math.round(payment.amount * 100) / 100;

    // Unique Stripe Refund ID check to prevent duplicate settlements
    if (params.refundId && payment.refunds) {
      const alreadyProcessedRefund = (payment.refunds as any[]).find(
        (r) => r.stripeRefundId === params.refundId && r.status === 'succeeded'
      );
      if (alreadyProcessedRefund) {
        const isCurrentPartial = existingRefunded < totalAmount && payment.status === 'PARTIALLY_REFUNDED';
        return {
          success: true,
          paymentId: payment.id,
          alreadyRefunded: true,
          refundAmount: existingRefunded,
          refundDelta: 0,
          isPartial: isCurrentPartial,
          status: payment.status,
        };
      }
    }

    let targetCumulative: number;
    let delta: number;

    if (params.cumulativeAmountRefunded !== undefined && params.cumulativeAmountRefunded !== null) {
      if (typeof params.cumulativeAmountRefunded !== 'number' || isNaN(params.cumulativeAmountRefunded) || !isFinite(params.cumulativeAmountRefunded)) {
        throw new AppError('Provided refund amount must be a finite, valid number', 400, 'INVALID_REFUND_AMOUNT');
      }
      if (params.cumulativeAmountRefunded < 0) {
        throw new AppError('Refund amount cannot be negative', 400, 'INVALID_REFUND_AMOUNT');
      }
      targetCumulative = Math.round(params.cumulativeAmountRefunded * 100) / 100;
      delta = Math.round((targetCumulative - existingRefunded) * 100) / 100;
    } else if (params.refundDelta !== undefined && params.refundDelta !== null) {
      if (typeof params.refundDelta !== 'number' || isNaN(params.refundDelta) || !isFinite(params.refundDelta)) {
        throw new AppError('Provided refund delta must be a finite, valid number', 400, 'INVALID_REFUND_AMOUNT');
      }
      if (params.refundDelta <= 0) {
        throw new AppError('Refund delta must be greater than 0', 400, 'INVALID_REFUND_AMOUNT');
      }
      delta = Math.round(params.refundDelta * 100) / 100;
      targetCumulative = Math.round((existingRefunded + delta) * 100) / 100;
    } else if (params.refundAmount !== undefined && params.refundAmount !== null) {
      if (typeof params.refundAmount !== 'number' || isNaN(params.refundAmount) || !isFinite(params.refundAmount)) {
        throw new AppError('Provided refund amount must be a finite, valid number', 400, 'INVALID_REFUND_AMOUNT');
      }
      if (params.refundAmount <= 0) {
        throw new AppError('Refund amount must be greater than 0', 400, 'INVALID_REFUND_AMOUNT');
      }
      targetCumulative = Math.round(params.refundAmount * 100) / 100;
      delta = Math.round((targetCumulative - existingRefunded) * 100) / 100;
    } else {
      delta = Math.round((totalAmount - existingRefunded) * 100) / 100;
      targetCumulative = totalAmount;
    }

    if (delta <= 0 || (payment.status === 'REFUNDED' && existingRefunded >= totalAmount)) {
      const isCurrentPartial = existingRefunded < totalAmount && payment.status === 'PARTIALLY_REFUNDED';
      return {
        success: true,
        paymentId: payment.id,
        alreadyRefunded: true,
        refundAmount: existingRefunded,
        refundDelta: 0,
        isPartial: isCurrentPartial,
        status: payment.status,
      };
    }

    const decimalPart = String(delta).split('.')[1];
    if (decimalPart && decimalPart.length > 2) {
      throw new AppError('Refund amount precision abuse: maximum 2 decimal places allowed for SAR', 400, 'INVALID_REFUND_PRECISION');
    }
    if (delta < 0.01) {
      throw new AppError('Refund amount must be at least 0.01 SAR (smallest currency unit)', 400, 'INVALID_REFUND_AMOUNT');
    }

    if (targetCumulative > totalAmount) {
      throw new AppError(
        `Refund cumulative amount (${targetCumulative} SAR) exceeds original payment amount (${totalAmount} SAR)`,
        400,
        'REFUND_AMOUNT_EXCEEDS_BALANCE'
      );
    }

    const remainingBalance = Math.round((totalAmount - existingRefunded) * 100) / 100;
    if (delta > remainingBalance) {
      throw new AppError(
        `Refund delta (${delta} SAR) exceeds remaining refundable balance (${remainingBalance} SAR)`,
        400,
        'REFUND_AMOUNT_EXCEEDS_BALANCE'
      );
    }

    const isPartial = targetCumulative < totalAmount;
    const newStatus: PaymentStatus = isPartial ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
    const keySuffix = params.refundId ? `ref_${params.refundId}` : `c_${Math.round(targetCumulative * 100)}`;

    const ride = await this.findRideById(payment.rideId);
    const fareSettled = payment.status === 'SUCCEEDED' || payment.status === 'PARTIALLY_REFUNDED' || (payment.metadata as any)?.settledToDriver;

    if (fareSettled && ride?.driverId) {
      const driver = await this.findDriverById(ride.driverId);
      if (driver) {
        const driverReversal = Math.round(delta * 0.8 * 100) / 100;
        const platformReversal = Math.round((delta - driverReversal) * 100) / 100;

        const newEarningsTotal = Math.max(0, (driver.earningsTotal || 0) - driverReversal);
        await this.updateDriver(driver.id, { earningsTotal: newEarningsTotal });

        const driverWallet = await this.getOrCreateWallet(driver.userId);
        if (driverWallet.balance >= driverReversal) {
          await this.debitWallet(
            driver.userId,
            driverReversal,
            `Earnings reversal on refund for ride #${payment.rideId.slice(0, 8)}`,
            payment.rideId,
            `webhook_${eventId}_driver_wal_${keySuffix}`
          );
        } else {
          const available = Math.max(0, driverWallet.balance);
          if (available > 0) {
            await this.debitWallet(
              driver.userId,
              available,
              `Partial earnings reversal on refund for ride #${payment.rideId.slice(0, 8)}`,
              payment.rideId,
              `webhook_${eventId}_driver_wal_part_${keySuffix}`
            );
          }
          const debtIncurred = Math.round((driverReversal - available) * 100) / 100;
          await this.updateDriver(driver.id, {
            outstandingDebt: (driver.outstandingDebt || 0) + debtIncurred,
          });

          await this.recordLedgerEntry({
            rideId: payment.rideId,
            type: 'COMMISSION_DEBT',
            amount: debtIncurred,
            currency: payment.currency || 'SAR',
            fromAccount: `driver:${driver.id}`,
            toAccount: 'platform:debt',
            status: 'OUTSTANDING',
            idempotencyKey: `webhook_${eventId}_driver_debt_${keySuffix}`,
          });
        }

        await this.recordLedgerEntry({
          rideId: payment.rideId,
          type: 'DRIVER_EARNING',
          amount: driverReversal,
          currency: payment.currency || 'SAR',
          fromAccount: `driver:${driver.id}`,
          toAccount: 'platform:escrow',
          status: 'SETTLED',
          idempotencyKey: `webhook_${eventId}_driver_rev_${keySuffix}`,
        });

        await this.recordLedgerEntry({
          rideId: payment.rideId,
          type: 'PLATFORM_COMMISSION',
          amount: platformReversal,
          currency: payment.currency || 'SAR',
          fromAccount: 'platform:revenue',
          toAccount: 'platform:escrow',
          status: 'SETTLED',
          idempotencyKey: `webhook_${eventId}_comm_rev_${keySuffix}`,
        });
      }
    }

    const idempotencyKey = `webhook_${eventId}_refund_${keySuffix}`;
    await this.recordLedgerEntry({
      rideId: payment.rideId,
      type: 'REFUND',
      amount: delta,
      currency: payment.currency || 'SAR',
      fromAccount: 'platform:escrow',
      toAccount: `rider:${payment.userId}`,
      status: 'SETTLED',
      idempotencyKey,
    });

    const refundsList = payment.refunds ? [...payment.refunds] : [];
    const rIdx = refundsList.findIndex((r) => r.stripeRefundId === (params.refundId || keySuffix));
    if (rIdx >= 0) {
      refundsList[rIdx].status = 'succeeded';
      refundsList[rIdx].amount = delta;
    } else {
      refundsList.push({
        stripeRefundId: params.refundId || keySuffix,
        amount: delta,
        status: 'succeeded',
        eventId,
        reason: params.reason,
        createdAt: new Date().toISOString(),
      });
    }

    await this.updatePayment(payment.id, {
      status: newStatus,
      refundAmount: targetCumulative,
      refunds: refundsList,
    } as any);
    await this.updateRide(payment.rideId, { paymentStatus: newStatus });

    return {
      success: true,
      paymentId: payment.id,
      alreadyRefunded: false,
      refundAmount: targetCumulative,
      refundDelta: delta,
      isPartial,
      status: newStatus,
    };
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

  public async reconcileFinancialIntegrity(): Promise<{
    healthy: boolean;
    discrepanciesCount: number;
    discrepancies: Array<{
      type: 'WALLET_MISMATCH' | 'PAYMENT_RIDE_MISMATCH' | 'COMMISSION_MISMATCH' | 'DRIVER_DEBT_MISMATCH' | 'DRIVER_EARNINGS_MISMATCH';
      id: string;
      details: string;
    }>;
  }> {
    this.ensureConnection();
    const discrepancies: Array<{
      type: 'WALLET_MISMATCH' | 'PAYMENT_RIDE_MISMATCH' | 'COMMISSION_MISMATCH' | 'DRIVER_DEBT_MISMATCH' | 'DRIVER_EARNINGS_MISMATCH';
      id: string;
      details: string;
    }> = [];


    // 1. Audit Wallet Balances against Transactions
    const wallets = await WalletModel.find().lean();
    for (const wallet of wallets) {
      const txs = await WalletTransactionModel.find({ userId: wallet.userId }).lean();
      const calculatedBalance = txs.reduce((sum, tx) => {
        return tx.type === 'CREDIT' ? sum + tx.amount : sum - tx.amount;
      }, 0);
      const diff = Math.abs(wallet.balance - calculatedBalance);
      if (diff > 0.05) {
        discrepancies.push({
          type: 'WALLET_MISMATCH',
          id: wallet.userId,
          details: `Wallet balance (${wallet.balance.toFixed(2)} SAR) does not match sum of transactions (${calculatedBalance.toFixed(2)} SAR). Difference: ${diff.toFixed(2)} SAR.`,
        });
      }
    }

    // 2. Audit Payment records vs Completed Rides
    const completedRides = await RideModel.find({ status: 'RIDE_COMPLETED' }).lean();
    for (const ride of completedRides) {
      const payment = await PaymentModel.findOne({ rideId: ride._id.toString() }).lean();
      if (!payment) {
        discrepancies.push({
          type: 'PAYMENT_RIDE_MISMATCH',
          id: ride._id.toString(),
          details: `Completed ride #${ride._id.toString().slice(0, 8)} has no payment record.`,
        });
      } else if (ride.paymentStatus === 'SUCCEEDED' && payment.status !== 'SUCCEEDED') {
        discrepancies.push({
          type: 'PAYMENT_RIDE_MISMATCH',
          id: ride._id.toString(),
          details: `Ride marked paymentStatus: SUCCEEDED but payment record #${payment._id} is status: ${payment.status}.`,
        });
      }
    }

    // 3. Audit Driver Outstanding Debt vs Ledger Entries
    const driversWithDebt = await DriverModel.find({ outstandingDebt: { $gt: 0 } }).lean();
    for (const driver of driversWithDebt) {
      const debtLedgers = await PlatformLedgerModel.find({
        fromAccount: `driver:${driver._id.toString()}`,
        type: 'COMMISSION_DEBT',
      }).lean();
      const recoveryLedgers = await PlatformLedgerModel.find({
        fromAccount: `driver:${driver._id.toString()}`,
        type: 'DEBT_RECOVERY',
      }).lean();

      const totalIncurred = debtLedgers.reduce((acc, l) => acc + l.amount, 0);
      const totalRecovered = recoveryLedgers.reduce((acc, l) => acc + l.amount, 0);
      const expectedDebt = Math.max(0, Math.round((totalIncurred - totalRecovered) * 100) / 100);

      if (Math.abs(driver.outstandingDebt - expectedDebt) > 0.05) {
        discrepancies.push({
          type: 'DRIVER_DEBT_MISMATCH',
          id: driver._id.toString(),
          details: `Driver debt record (${driver.outstandingDebt} SAR) does not match ledger balance (${expectedDebt} SAR).`,
        });
      }
    }

    // 4. Audit Driver Earnings vs Settled Rides (Phase 7 Hardening)
    const allDrivers = await DriverModel.find({ earningsTotal: { $gt: 0 } }).lean();
    for (const driver of allDrivers) {
      const settledDriverRides = await RideModel.find({
        driverId: driver._id.toString(),
        status: 'RIDE_COMPLETED',
        paymentStatus: { $in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] },
      }).lean();

      let expectedEarnings = 0;
      for (const r of settledDriverRides) {
        const payment = await PaymentModel.findOne({ rideId: r._id.toString() }).lean();
        const fare = r.finalFare ?? r.estimatedFare ?? 0;
        const refunded = payment?.refundAmount || 0;
        const netFare = Math.max(0, fare - refunded);
        expectedEarnings += Math.round(netFare * 0.8 * 100) / 100;
      }

      const diff = Math.abs((driver.earningsTotal || 0) - expectedEarnings);
      if (diff > 0.1) {
        discrepancies.push({
          type: 'DRIVER_EARNINGS_MISMATCH',
          id: driver._id.toString(),
          details: `Driver earningsTotal (${(driver.earningsTotal || 0).toFixed(2)} SAR) does not match sum of settled rides (${expectedEarnings.toFixed(2)} SAR). Difference: ${diff.toFixed(2)} SAR.`,
        });
      }
    }

    // 5. Audit Platform Commission in Ledger vs Settled Rides
    const settledRides = await RideModel.find({
      status: 'RIDE_COMPLETED',
      paymentStatus: { $in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] },
    }).lean();

    let expectedTotalCommission = 0;
    for (const r of settledRides) {
      const payment = await PaymentModel.findOne({ rideId: r._id.toString() }).lean();
      const fare = r.finalFare ?? r.estimatedFare ?? 0;
      const refunded = payment?.refundAmount || 0;
      const netFare = Math.max(0, fare - refunded);
      expectedTotalCommission += Math.round(netFare * 0.2 * 100) / 100;
    }

    const commissionLedgers = await PlatformLedgerModel.find({
      type: 'PLATFORM_COMMISSION',
    }).lean();
    const recordedCommission = commissionLedgers.reduce((acc, l) => {
      if (l.fromAccount === 'platform:revenue' && l.toAccount === 'platform:escrow') {
        return acc - (l.amount || 0); // Commission reversal on refund
      }
      return acc + (l.amount || 0);
    }, 0);

    if (Math.abs(expectedTotalCommission - recordedCommission) > 0.1) {
      discrepancies.push({
        type: 'COMMISSION_MISMATCH',
        id: 'platform_commission_pool',
        details: `Platform commission recorded in ledger (${recordedCommission.toFixed(2)} SAR) does not match expected commission on settled rides (${expectedTotalCommission.toFixed(2)} SAR).`,
      });
    }

    return {
      healthy: discrepancies.length === 0,
      discrepanciesCount: discrepancies.length,
      discrepancies,
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
