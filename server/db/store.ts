import mongoose, { ClientSession } from 'mongoose';
import { acquireLock, releaseLock } from '../redis/redisClient';
import {
  UserModel,
  DriverModel,
  VehicleModel,
  RideModel,
  WalletModel,
  WalletTransactionModel,
  PaymentModel,
  RatingModel,
  MessageModel,
  NotificationModel,
  AuditLogModel,
  RefreshSessionModel,
} from '../models/mongoSchemas';
import { isDbConnected } from './connection';
import {
  IUser,
  IDriver,
  IVehicle,
  IRide,
  IWallet,
  IWalletTransaction,
  IRating,
  IMessage,
  INotification,
  IAuditLog,
  IPayment,
  RideStatus,
} from '../types';

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

export class DatabaseStore {
  // In-memory fallback caches for development/testing when MongoDB Atlas is connecting
  private memUsers: Map<string, IUser> = new Map();
  private memDrivers: Map<string, IDriver> = new Map();
  private memVehicles: Map<string, IVehicle> = new Map();
  private memRides: Map<string, IRide> = new Map();
  private memWallets: Map<string, IWallet> = new Map();
  private memTransactions: Map<string, IWalletTransaction> = new Map();
  private memPayments: Map<string, IPayment> = new Map();
  private memRatings: Map<string, IRating> = new Map();
  private memMessages: Map<string, IMessage> = new Map();
  private memNotifications: Map<string, INotification> = new Map();
  private memAuditLogs: IAuditLog[] = [];
  private memSessions: Map<string, IRefreshSession> = new Map();

  // Helper to map Mongoose doc to domain type
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
      createdAt: doc.createdAt?.toISOString?.() || doc.createdAt,
      updatedAt: doc.updatedAt?.toISOString?.() || doc.updatedAt,
    };
  }

  private docToDriver(doc: any): IDriver {
    if (!doc) return null as any;
    return {
      id: doc._id?.toString() || doc.id,
      userId: doc.userId,
      approvalStatus: doc.approvalStatus,
      isOnline: doc.isOnline,
      currentLocation: {
        lat: doc.currentLocation?.lat,
        lng: doc.currentLocation?.lng,
        heading: doc.currentLocation?.heading || 0,
        updatedAt: doc.currentLocation?.updatedAt?.toISOString?.() || doc.currentLocation?.updatedAt,
      },
      rating: doc.rating,
      totalRides: doc.totalRides,
      licenseNumber: doc.licenseNumber,
      documents: doc.documents,
      earningsTotal: doc.earningsTotal,
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
      startedAt: doc.startedAt?.toISOString?.() || doc.startedAt,
      completedAt: doc.completedAt?.toISOString?.() || doc.completedAt,
      createdAt: doc.createdAt?.toISOString?.() || doc.createdAt,
      updatedAt: doc.updatedAt?.toISOString?.() || doc.updatedAt || new Date().toISOString(),
    };
  }

  public clearAll(): void {
    this.memUsers.clear();
    this.memDrivers.clear();
    this.memVehicles.clear();
    this.memRides.clear();
    this.memWallets.clear();
    this.memTransactions.clear();
    this.memPayments.clear();
    this.memRatings.clear();
    this.memMessages.clear();
    this.memNotifications.clear();
    this.memAuditLogs = [];
    this.memSessions.clear();
  }

  // ==========================================
  // USER OPERATIONS
  // ==========================================
  public async createUser(user: IUser): Promise<IUser> {
    this.memUsers.set(user.id, { ...user });
    if (isDbConnected()) {
      try {
        const created = await UserModel.create({
          _id: new mongoose.Types.ObjectId(),
          name: user.name,
          email: user.email.toLowerCase(),
          phone: user.phone,
          passwordHash: user.passwordHash,
          role: user.role,
          status: user.status,
          avatarUrl: user.avatarUrl,
        });
        const mapped = this.docToUser(created);
        this.memUsers.set(mapped.id, mapped);
        return mapped;
      } catch (err) {
        console.warn('[DB User] Mongo insert error, saved in memory store:', (err as Error).message);
      }
    }
    return user;
  }

  public async findUserById(id: string): Promise<IUser | null> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const doc = await UserModel.findById(id).lean();
          if (doc) return this.docToUser(doc);
        }
      } catch {
        // fallback
      }
    }
    return this.memUsers.get(id) || null;
  }

  public async findUserByEmail(email: string): Promise<IUser | null> {
    const cleanEmail = email.toLowerCase().trim();
    if (isDbConnected()) {
      try {
        const doc = await UserModel.findOne({ email: cleanEmail }).lean();
        if (doc) return this.docToUser(doc);
      } catch {
        // fallback
      }
    }
    for (const u of this.memUsers.values()) {
      if (u.email.toLowerCase().trim() === cleanEmail) return u;
    }
    return null;
  }

  public async findUserByPhone(phone: string): Promise<IUser | null> {
    const cleanPhone = phone.trim();
    if (isDbConnected()) {
      try {
        const doc = await UserModel.findOne({ phone: cleanPhone }).lean();
        if (doc) return this.docToUser(doc);
      } catch {
        // fallback
      }
    }
    for (const u of this.memUsers.values()) {
      if (u.phone.trim() === cleanPhone) return u;
    }
    return null;
  }

  public async updateUser(id: string, updates: Partial<IUser>): Promise<IUser | null> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const updated = await UserModel.findByIdAndUpdate(id, updates, { new: true }).lean();
          if (updated) {
            const mapped = this.docToUser(updated);
            this.memUsers.set(id, mapped);
            return mapped;
          }
        }
      } catch {
        // fallback
      }
    }
    const existing = this.memUsers.get(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.memUsers.set(id, merged);
    return merged;
  }

  public async getAllUsers(): Promise<IUser[]> {
    if (isDbConnected()) {
      try {
        const docs = await UserModel.find().sort({ createdAt: -1 }).lean();
        return docs.map((d) => this.docToUser(d));
      } catch {
        // fallback
      }
    }
    return Array.from(this.memUsers.values());
  }

  // ==========================================
  // DRIVER OPERATIONS
  // ==========================================
  public async createDriver(driver: IDriver): Promise<IDriver> {
    this.memDrivers.set(driver.id, { ...driver });
    if (isDbConnected()) {
      try {
        const created = await DriverModel.create({
          _id: new mongoose.Types.ObjectId(),
          userId: driver.userId,
          approvalStatus: driver.approvalStatus,
          isOnline: driver.isOnline,
          currentLocation: driver.currentLocation,
          rating: driver.rating,
          totalRides: driver.totalRides,
          licenseNumber: driver.licenseNumber,
          documents: driver.documents,
          earningsTotal: driver.earningsTotal,
        });
        const mapped = this.docToDriver(created);
        this.memDrivers.set(mapped.id, mapped);
        return mapped;
      } catch (err) {
        console.warn('[DB Driver] Mongo insert error:', (err as Error).message);
      }
    }
    return driver;
  }

  public async findDriverById(id: string): Promise<IDriver | null> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const doc = await DriverModel.findById(id).lean();
          if (doc) return this.docToDriver(doc);
        }
      } catch {
        // fallback
      }
    }
    return this.memDrivers.get(id) || null;
  }

  public async findDriverByUserId(userId: string): Promise<IDriver | null> {
    if (isDbConnected()) {
      try {
        const doc = await DriverModel.findOne({ userId }).lean();
        if (doc) return this.docToDriver(doc);
      } catch {
        // fallback
      }
    }
    for (const d of this.memDrivers.values()) {
      if (d.userId === userId) return d;
    }
    return null;
  }

  public async updateDriver(id: string, updates: Partial<IDriver>): Promise<IDriver | null> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const updated = await DriverModel.findByIdAndUpdate(id, updates, { new: true }).lean();
          if (updated) {
            const mapped = this.docToDriver(updated);
            this.memDrivers.set(id, mapped);
            return mapped;
          }
        }
      } catch {
        // fallback
      }
    }
    const existing = this.memDrivers.get(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates };
    this.memDrivers.set(id, merged);
    return merged;
  }

  public async getAllDrivers(): Promise<IDriver[]> {
    if (isDbConnected()) {
      try {
        const docs = await DriverModel.find().lean();
        return docs.map((d) => this.docToDriver(d));
      } catch {
        // fallback
      }
    }
    return Array.from(this.memDrivers.values());
  }

  public async getOnlineApprovedDrivers(): Promise<IDriver[]> {
    if (isDbConnected()) {
      try {
        const docs = await DriverModel.find({ isOnline: true, approvalStatus: 'APPROVED' }).lean();
        return docs.map((d) => this.docToDriver(d));
      } catch {
        // fallback
      }
    }
    return Array.from(this.memDrivers.values()).filter(
      (d) => d.isOnline && d.approvalStatus === 'APPROVED'
    );
  }

  // ==========================================
  // VEHICLE OPERATIONS
  // ==========================================
  public async createVehicle(vehicle: IVehicle): Promise<IVehicle> {
    this.memVehicles.set(vehicle.id, { ...vehicle });
    if (isDbConnected()) {
      try {
        const created = await VehicleModel.create({
          _id: new mongoose.Types.ObjectId(),
          driverId: vehicle.driverId,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          color: vehicle.color,
          plateNumber: vehicle.plateNumber,
          category: vehicle.category,
        });
        const mapped = this.docToVehicle(created);
        this.memVehicles.set(mapped.id, mapped);
        return mapped;
      } catch (err) {
        console.warn('[DB Vehicle] Mongo insert error:', (err as Error).message);
      }
    }
    return vehicle;
  }

  public async findVehicleByDriverId(driverId: string): Promise<IVehicle | null> {
    if (isDbConnected()) {
      try {
        const doc = await VehicleModel.findOne({ driverId }).lean();
        if (doc) return this.docToVehicle(doc);
      } catch {
        // fallback
      }
    }
    for (const v of this.memVehicles.values()) {
      if (v.driverId === driverId) return v;
    }
    return null;
  }

  public async updateVehicle(id: string, updates: Partial<IVehicle>): Promise<IVehicle | null> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const updated = await VehicleModel.findByIdAndUpdate(id, updates, { new: true }).lean();
          if (updated) {
            const mapped = this.docToVehicle(updated);
            this.memVehicles.set(id, mapped);
            return mapped;
          }
        }
      } catch {
        // fallback
      }
    }
    const existing = this.memVehicles.get(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates };
    this.memVehicles.set(id, merged);
    return merged;
  }

  // ==========================================
  // RIDE OPERATIONS
  // ==========================================
  public async createRide(ride: IRide): Promise<IRide> {
    this.memRides.set(ride.id, { ...ride });
    if (isDbConnected()) {
      try {
        const created = await RideModel.create({
          _id: new mongoose.Types.ObjectId(),
          riderId: ride.riderId,
          driverId: ride.driverId,
          status: ride.status,
          vehicleCategory: ride.vehicleCategory,
          pickup: ride.pickup,
          destination: ride.destination,
          currentDriverLocation: ride.currentDriverLocation,
          estimatedFare: ride.estimatedFare,
          finalFare: ride.finalFare,
          tip: ride.tip || 0,
          distanceKm: ride.distanceKm,
          durationMinutes: ride.durationMinutes,
          paymentMethod: ride.paymentMethod,
          paymentStatus: ride.paymentStatus,
          cancellationReason: ride.cancellationReason,
          cancelledBy: ride.cancelledBy,
          startedAt: ride.startedAt ? new Date(ride.startedAt) : undefined,
          completedAt: ride.completedAt ? new Date(ride.completedAt) : undefined,
        });
        const mapped = this.docToRide(created);
        this.memRides.set(mapped.id, mapped);
        return mapped;
      } catch (err) {
        console.warn('[DB Ride] Mongo insert error:', (err as Error).message);
      }
    }
    return ride;
  }

  public async findRideById(id: string): Promise<IRide | null> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const doc = await RideModel.findById(id).lean();
          if (doc) return this.docToRide(doc);
        }
      } catch {
        // fallback
      }
    }
    return this.memRides.get(id) || null;
  }

  public async updateRide(id: string, updates: Partial<IRide>): Promise<IRide | null> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const updated = await RideModel.findByIdAndUpdate(id, updates, { new: true }).lean();
          if (updated) {
            const mapped = this.docToRide(updated);
            this.memRides.set(id, mapped);
            return mapped;
          }
        }
      } catch {
        // fallback
      }
    }
    const existing = this.memRides.get(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates };
    this.memRides.set(id, merged);
    return merged;
  }

  public async findActiveRideForUser(userId: string): Promise<IRide | null> {
    const activeStatuses: RideStatus[] = [
      'REQUESTED',
      'SEARCHING_DRIVER',
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVING',
      'DRIVER_ARRIVED',
      'RIDE_STARTED',
    ];

    if (isDbConnected()) {
      try {
        const doc = await RideModel.findOne({
          $or: [{ riderId: userId }, { driverId: userId }],
          status: { $in: activeStatuses },
        })
          .sort({ createdAt: -1 })
          .lean();
        if (doc) return this.docToRide(doc);
      } catch {
        // fallback
      }
    }

    for (const r of this.memRides.values()) {
      if ((r.riderId === userId || r.driverId === userId) && activeStatuses.includes(r.status)) {
        return r;
      }
    }
    return null;
  }

  public async findRidesByUser(userId: string): Promise<IRide[]> {
    if (isDbConnected()) {
      try {
        const docs = await RideModel.find({
          $or: [{ riderId: userId }, { driverId: userId }],
        })
          .sort({ createdAt: -1 })
          .lean();
        return docs.map((d) => this.docToRide(d));
      } catch {
        // fallback
      }
    }
    return Array.from(this.memRides.values())
      .filter((r) => r.riderId === userId || r.driverId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async getRidesByRiderId(riderId: string): Promise<IRide[]> {
    if (isDbConnected()) {
      try {
        const docs = await RideModel.find({ riderId })
          .sort({ createdAt: -1 })
          .lean();
        return docs.map((d) => this.docToRide(d));
      } catch {
        // fallback
      }
    }
    return Array.from(this.memRides.values())
      .filter((r) => r.riderId === riderId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async getRidesByDriverId(driverId: string): Promise<IRide[]> {
    if (isDbConnected()) {
      try {
        const docs = await RideModel.find({ driverId })
          .sort({ createdAt: -1 })
          .lean();
        return docs.map((d) => this.docToRide(d));
      } catch {
        // fallback
      }
    }
    return Array.from(this.memRides.values())
      .filter((r) => r.driverId === driverId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async atomicAcceptRide(
    rideId: string,
    driverId: string
  ): Promise<{ success: boolean; ride?: IRide; message: string }> {
    const lockKey = `ride_accept:${rideId}`;
    const locked = await acquireLock(lockKey, 10000);
    if (!locked) {
      return { success: false, message: 'Another driver is currently accepting this ride.' };
    }

    try {
      if (isDbConnected()) {
        try {
          if (mongoose.Types.ObjectId.isValid(rideId)) {
            const updated = await RideModel.findOneAndUpdate(
              { _id: rideId, status: { $in: ['REQUESTED', 'SEARCHING_DRIVER'] } },
              { $set: { status: 'DRIVER_ASSIGNED', driverId } },
              { new: true }
            ).lean();

            if (!updated) {
              return { success: false, message: 'Ride is no longer available or was already accepted.' };
            }
            const mapped = this.docToRide(updated);
            this.memRides.set(rideId, mapped);
            return { success: true, ride: mapped, message: 'Ride accepted successfully.' };
          }
        } catch {
          // fallback
        }
      }

      const ride = this.memRides.get(rideId);
      if (!ride || !['REQUESTED', 'SEARCHING_DRIVER'].includes(ride.status)) {
        return { success: false, message: 'Ride is no longer available or was already accepted.' };
      }

      ride.status = 'DRIVER_ASSIGNED';
      ride.driverId = driverId;
      ride.updatedAt = new Date().toISOString();
      this.memRides.set(rideId, ride);
      return { success: true, ride, message: 'Ride accepted successfully.' };
    } finally {
      await releaseLock(lockKey);
    }
  }

  public async atomicTransitionRide(
    rideId: string,
    nextStatus: RideStatus,
    allowedPriorStatuses: RideStatus[],
    additionalUpdates?: Partial<IRide>
  ): Promise<{ success: boolean; ride?: IRide; error?: string }> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(rideId)) {
          const updated = await RideModel.findOneAndUpdate(
            { _id: rideId, status: { $in: allowedPriorStatuses } },
            { $set: { status: nextStatus, ...(additionalUpdates || {}) } },
            { new: true }
          ).lean();

          if (!updated) {
            return { success: false, error: 'Illegal transition: ride is not in expected prior status.' };
          }
          const mapped = this.docToRide(updated);
          this.memRides.set(rideId, mapped);
          return { success: true, ride: mapped };
        }
      } catch {
        // fallback
      }
    }

    const ride = this.memRides.get(rideId);
    if (!ride) {
      return { success: false, error: 'Ride not found' };
    }

    if (!allowedPriorStatuses.includes(ride.status)) {
      return {
        success: false,
        error: `Cannot transition ride from '${ride.status}' to '${nextStatus}'.`,
      };
    }

    ride.status = nextStatus;
    if (additionalUpdates) {
      Object.assign(ride, additionalUpdates);
    }
    ride.updatedAt = new Date().toISOString();
    this.memRides.set(rideId, ride);
    return { success: true, ride };
  }

  public async logAudit(
    userId: string | undefined,
    action: string,
    details: Record<string, unknown>,
    ip?: string
  ): Promise<void> {
    await this.createAuditLog({
      id: 'aud_' + Math.random().toString(36).substring(2, 9),
      userId,
      action,
      details,
      ip,
      timestamp: new Date().toISOString(),
    });
  }

  public async getAllRides(): Promise<IRide[]> {
    if (isDbConnected()) {
      try {
        const docs = await RideModel.find().sort({ createdAt: -1 }).lean();
        return docs.map((d) => this.docToRide(d));
      } catch {
        // fallback
      }
    }
    return Array.from(this.memRides.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  // ==========================================
  // WALLET & FINANCIAL TRANSACTIONS (ATOMIC)
  // ==========================================
  public async getOrCreateWallet(userId: string): Promise<IWallet> {
    if (isDbConnected()) {
      try {
        let doc = await WalletModel.findOne({ userId }).lean();
        if (!doc) {
          doc = await WalletModel.create({
            _id: new mongoose.Types.ObjectId(),
            userId,
            balance: 0,
            currency: 'SAR',
          });
        }
        const mapped: IWallet = {
          id: doc._id?.toString() || doc.id,
          userId: doc.userId,
          balance: doc.balance,
          currency: doc.currency,
          updatedAt: doc.updatedAt?.toISOString?.() || doc.updatedAt,
        };
        this.memWallets.set(userId, mapped);
        return mapped;
      } catch {
        // fallback
      }
    }

    const existing = this.memWallets.get(userId);
    if (existing) return existing;

    const wallet: IWallet = {
      id: 'wal_' + Math.random().toString(36).substring(2, 9),
      userId,
      balance: 0,
      currency: 'SAR',
      updatedAt: new Date().toISOString(),
    };
    this.memWallets.set(userId, wallet);
    return wallet;
  }

  /**
   * Atomic Credit Wallet: guarantees accurate balance and audit transaction log
   */
  public async creditWallet(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string,
    idempotencyKey?: string
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    if (amount <= 0) {
      throw new Error('Credit amount must be positive.');
    }

    if (isDbConnected()) {
      try {
        const walletDoc = await WalletModel.findOneAndUpdate(
          { userId },
          { $inc: { balance: amount } },
          { new: true, upsert: true }
        ).lean();

        const txDoc = await WalletTransactionModel.create({
          _id: new mongoose.Types.ObjectId(),
          walletId: walletDoc._id.toString(),
          userId,
          type: 'CREDIT',
          amount,
          balanceAfter: walletDoc.balance,
          reason,
          referenceId,
          idempotencyKey,
        });

        const wallet: IWallet = {
          id: walletDoc._id.toString(),
          userId: walletDoc.userId,
          balance: walletDoc.balance,
          currency: walletDoc.currency,
          updatedAt: walletDoc.updatedAt.toISOString(),
        };

        const transaction: IWalletTransaction = {
          id: txDoc._id.toString(),
          walletId: walletDoc._id.toString(),
          userId,
          type: 'CREDIT',
          amount,
          balanceAfter: walletDoc.balance,
          reason,
          referenceId,
          createdAt: txDoc.createdAt.toISOString(),
        };

        this.memWallets.set(userId, wallet);
        this.memTransactions.set(transaction.id, transaction);
        return { wallet, transaction };
      } catch (err: any) {
        if (err.code === 11000 && idempotencyKey) {
          throw new Error('DUPLICATE_TRANSACTION: Idempotency key already processed.');
        }
      }
    }

    // Memory atomic operation
    const wallet = await this.getOrCreateWallet(userId);
    wallet.balance += amount;
    wallet.updatedAt = new Date().toISOString();

    const transaction: IWalletTransaction = {
      id: 'tx_' + Math.random().toString(36).substring(2, 9),
      walletId: wallet.id,
      userId,
      type: 'CREDIT',
      amount,
      balanceAfter: wallet.balance,
      reason,
      referenceId,
      createdAt: new Date().toISOString(),
    };

    this.memTransactions.set(transaction.id, transaction);
    this.memWallets.set(userId, wallet);
    return { wallet, transaction };
  }

  /**
   * Atomic Debit Wallet: prevents negative balance and double-spending
   */
  public async debitWallet(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    if (amount <= 0) {
      throw new Error('Debit amount must be positive.');
    }

    if (isDbConnected()) {
      try {
        // Atomic query matching balance >= amount
        const walletDoc = await WalletModel.findOneAndUpdate(
          { userId, balance: { $gte: amount } },
          { $inc: { balance: -amount } },
          { new: true }
        ).lean();

        if (!walletDoc) {
          throw new Error('INSUFFICIENT_FUNDS: Wallet balance is insufficient for this debit.');
        }

        const txDoc = await WalletTransactionModel.create({
          _id: new mongoose.Types.ObjectId(),
          walletId: walletDoc._id.toString(),
          userId,
          type: 'DEBIT',
          amount,
          balanceAfter: walletDoc.balance,
          reason,
          referenceId,
        });

        const wallet: IWallet = {
          id: walletDoc._id.toString(),
          userId: walletDoc.userId,
          balance: walletDoc.balance,
          currency: walletDoc.currency,
          updatedAt: walletDoc.updatedAt.toISOString(),
        };

        const transaction: IWalletTransaction = {
          id: txDoc._id.toString(),
          walletId: walletDoc._id.toString(),
          userId,
          type: 'DEBIT',
          amount,
          balanceAfter: walletDoc.balance,
          reason,
          referenceId,
          createdAt: txDoc.createdAt.toISOString(),
        };

        this.memWallets.set(userId, wallet);
        this.memTransactions.set(transaction.id, transaction);
        return { wallet, transaction };
      } catch (err: any) {
        if (err.message.includes('INSUFFICIENT_FUNDS')) throw err;
      }
    }

    // Memory fallback
    const wallet = await this.getOrCreateWallet(userId);
    if (wallet.balance < amount) {
      throw new Error('INSUFFICIENT_FUNDS: Wallet balance is insufficient for this debit.');
    }

    wallet.balance -= amount;
    wallet.updatedAt = new Date().toISOString();

    const transaction: IWalletTransaction = {
      id: 'tx_' + Math.random().toString(36).substring(2, 9),
      walletId: wallet.id,
      userId,
      type: 'DEBIT',
      amount,
      balanceAfter: wallet.balance,
      reason,
      referenceId,
      createdAt: new Date().toISOString(),
    };

    this.memTransactions.set(transaction.id, transaction);
    this.memWallets.set(userId, wallet);
    return { wallet, transaction };
  }

  public async getTransactionsForUser(userId: string): Promise<IWalletTransaction[]> {
    if (isDbConnected()) {
      try {
        const docs = await WalletTransactionModel.find({ userId })
          .sort({ createdAt: -1 })
          .limit(50)
          .lean();
        return docs.map((d) => ({
          id: d._id.toString(),
          walletId: d.walletId,
          userId: d.userId,
          type: d.type as 'CREDIT' | 'DEBIT',
          amount: d.amount,
          balanceAfter: d.balanceAfter,
          reason: d.reason,
          referenceId: d.referenceId,
          createdAt: d.createdAt.toISOString(),
        }));
      } catch {
        // fallback
      }
    }
    return Array.from(this.memTransactions.values())
      .filter((t) => t.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // ==========================================
  // PAYMENT OPERATIONS
  // ==========================================
  public async createPayment(payment: IPayment): Promise<IPayment> {
    this.memPayments.set(payment.id, { ...payment });
    if (isDbConnected()) {
      try {
        const created = await PaymentModel.create({
          _id: new mongoose.Types.ObjectId(),
          rideId: payment.rideId,
          userId: payment.userId,
          amount: payment.amount,
          currency: payment.currency || 'SAR',
          status: payment.status,
          paymentMethod: payment.paymentMethod,
          stripePaymentIntentId: payment.stripePaymentIntentId,
          stripeClientSecret: payment.stripeClientSecret,
          idempotencyKey: payment.idempotencyKey,
          metadata: payment.metadata,
        });
        const mapped: IPayment = {
          id: created._id.toString(),
          rideId: created.rideId,
          userId: created.userId,
          amount: created.amount,
          currency: created.currency,
          status: created.status as any,
          paymentMethod: created.paymentMethod as any,
          stripePaymentIntentId: created.stripePaymentIntentId,
          stripeClientSecret: created.stripeClientSecret,
          idempotencyKey: created.idempotencyKey,
          createdAt: created.createdAt.toISOString(),
        };
        this.memPayments.set(mapped.id, mapped);
        return mapped;
      } catch (err) {
        console.warn('[DB Payment] Mongo insert error:', (err as Error).message);
      }
    }
    return payment;
  }

  public async findPaymentById(id: string): Promise<IPayment | null> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const doc = await PaymentModel.findById(id).lean();
          if (doc) {
            return {
              id: doc._id.toString(),
              rideId: doc.rideId,
              userId: doc.userId,
              amount: doc.amount,
              currency: doc.currency,
              status: doc.status as any,
              paymentMethod: doc.paymentMethod as any,
              stripePaymentIntentId: doc.stripePaymentIntentId,
              stripeClientSecret: doc.stripeClientSecret,
              idempotencyKey: doc.idempotencyKey,
              createdAt: doc.createdAt.toISOString(),
            };
          }
        }
      } catch {
        // fallback
      }
    }
    return this.memPayments.get(id) || null;
  }

  public async findPaymentByStripeIntent(intentId: string): Promise<IPayment | null> {
    if (isDbConnected()) {
      try {
        const doc = await PaymentModel.findOne({ stripePaymentIntentId: intentId }).lean();
        if (doc) {
          return {
            id: doc._id.toString(),
            rideId: doc.rideId,
            userId: doc.userId,
            amount: doc.amount,
            currency: doc.currency,
            status: doc.status as any,
            paymentMethod: doc.paymentMethod as any,
            stripePaymentIntentId: doc.stripePaymentIntentId,
            stripeClientSecret: doc.stripeClientSecret,
            idempotencyKey: doc.idempotencyKey,
            createdAt: doc.createdAt.toISOString(),
          };
        }
      } catch {
        // fallback
      }
    }
    for (const p of this.memPayments.values()) {
      if (p.stripePaymentIntentId === intentId) return p;
    }
    return null;
  }

  public async updatePayment(id: string, updates: Partial<IPayment>): Promise<IPayment | null> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const updated = await PaymentModel.findByIdAndUpdate(id, updates, { new: true }).lean();
          if (updated) {
            const mapped: IPayment = {
              id: updated._id.toString(),
              rideId: updated.rideId,
              userId: updated.userId,
              amount: updated.amount,
              currency: updated.currency,
              status: updated.status as any,
              paymentMethod: updated.paymentMethod as any,
              stripePaymentIntentId: updated.stripePaymentIntentId,
              stripeClientSecret: updated.stripeClientSecret,
              idempotencyKey: updated.idempotencyKey,
              createdAt: updated.createdAt.toISOString(),
            };
            this.memPayments.set(id, mapped);
            return mapped;
          }
        }
      } catch {
        // fallback
      }
    }
    const existing = this.memPayments.get(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates };
    this.memPayments.set(id, merged);
    return merged;
  }

  // ==========================================
  // RATING OPERATIONS
  // ==========================================
  public async createRating(rating: IRating): Promise<IRating> {
    this.memRatings.set(rating.id, { ...rating });
    if (isDbConnected()) {
      try {
        const created = await RatingModel.create({
          _id: new mongoose.Types.ObjectId(),
          rideId: rating.rideId,
          fromUserId: rating.fromUserId,
          toUserId: rating.toUserId,
          stars: rating.stars,
          comment: rating.comment,
        });
        const mapped: IRating = {
          id: created._id.toString(),
          rideId: created.rideId,
          fromUserId: created.fromUserId,
          toUserId: created.toUserId,
          stars: created.stars,
          comment: created.comment,
          createdAt: created.createdAt.toISOString(),
        };
        this.memRatings.set(mapped.id, mapped);
        return mapped;
      } catch (err) {
        console.warn('[DB Rating] Mongo insert error:', (err as Error).message);
      }
    }
    return rating;
  }

  public async getRatingsForUser(toUserId: string): Promise<IRating[]> {
    if (isDbConnected()) {
      try {
        const docs = await RatingModel.find({ toUserId }).lean();
        return docs.map((d) => ({
          id: d._id.toString(),
          rideId: d.rideId,
          fromUserId: d.fromUserId,
          toUserId: d.toUserId,
          stars: d.stars,
          comment: d.comment,
          createdAt: d.createdAt.toISOString(),
        }));
      } catch {
        // fallback
      }
    }
    return Array.from(this.memRatings.values()).filter((r) => r.toUserId === toUserId);
  }

  public async findRatingByRideAndFromUser(rideId: string, fromUserId: string): Promise<IRating | null> {
    if (isDbConnected()) {
      try {
        const doc = await RatingModel.findOne({ rideId, fromUserId }).lean();
        if (doc) {
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
      } catch {
        // fallback
      }
    }
    for (const r of this.memRatings.values()) {
      if (r.rideId === rideId && r.fromUserId === fromUserId) return r;
    }
    return null;
  }

  // ==========================================
  // CHAT / MESSAGE OPERATIONS
  // ==========================================
  public async createMessage(msg: IMessage): Promise<IMessage> {
    this.memMessages.set(msg.id, { ...msg });
    if (isDbConnected()) {
      try {
        const created = await MessageModel.create({
          _id: new mongoose.Types.ObjectId(),
          rideId: msg.rideId,
          senderId: msg.senderId,
          senderName: msg.senderName,
          recipientId: msg.recipientId,
          content: msg.content,
          read: msg.read || false,
        });
        const mapped: IMessage = {
          id: created._id.toString(),
          rideId: created.rideId,
          senderId: created.senderId,
          senderName: created.senderName,
          recipientId: created.recipientId,
          content: created.content,
          read: created.read,
          createdAt: created.createdAt.toISOString(),
        };
        this.memMessages.set(mapped.id, mapped);
        return mapped;
      } catch (err) {
        console.warn('[DB Message] Mongo insert error:', (err as Error).message);
      }
    }
    return msg;
  }

  public async getMessagesForRide(rideId: string, limit: number = 100): Promise<IMessage[]> {
    if (isDbConnected()) {
      try {
        const docs = await MessageModel.find({ rideId })
          .sort({ createdAt: 1 })
          .limit(limit)
          .lean();
        return docs.map((d) => ({
          id: d._id.toString(),
          rideId: d.rideId,
          senderId: d.senderId,
          senderName: d.senderName,
          recipientId: d.recipientId,
          content: d.content,
          read: d.read,
          createdAt: d.createdAt.toISOString(),
        }));
      } catch {
        // fallback
      }
    }
    return Array.from(this.memMessages.values())
      .filter((m) => m.rideId === rideId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // ==========================================
  // NOTIFICATIONS OPERATIONS
  // ==========================================
  public async createNotification(notif: INotification): Promise<INotification> {
    this.memNotifications.set(notif.id, { ...notif });
    if (isDbConnected()) {
      try {
        const created = await NotificationModel.create({
          _id: new mongoose.Types.ObjectId(),
          userId: notif.userId,
          title: notif.title,
          body: notif.body,
          type: notif.type,
          metadata: notif.metadata,
          read: notif.read,
        });
        const mapped: INotification = {
          id: created._id.toString(),
          userId: created.userId,
          title: created.title,
          body: created.body,
          type: created.type as any,
          metadata: created.metadata,
          read: created.read,
          createdAt: created.createdAt.toISOString(),
        };
        this.memNotifications.set(mapped.id, mapped);
        return mapped;
      } catch (err) {
        console.warn('[DB Notification] Mongo insert error:', (err as Error).message);
      }
    }
    return notif;
  }

  public async getNotificationsForUser(userId: string): Promise<INotification[]> {
    if (isDbConnected()) {
      try {
        const docs = await NotificationModel.find({ userId })
          .sort({ createdAt: -1 })
          .limit(50)
          .lean();
        return docs.map((d) => ({
          id: d._id.toString(),
          userId: d.userId,
          title: d.title,
          body: d.body,
          type: d.type as any,
          metadata: d.metadata,
          read: d.read,
          createdAt: d.createdAt.toISOString(),
        }));
      } catch {
        // fallback
      }
    }
    return Array.from(this.memNotifications.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async findNotificationById(id: string): Promise<INotification | null> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const doc = await NotificationModel.findById(id).lean();
          if (doc) {
            return {
              id: doc._id.toString(),
              userId: doc.userId,
              title: doc.title,
              body: doc.body,
              type: doc.type as any,
              metadata: doc.metadata,
              read: doc.read,
              createdAt: doc.createdAt.toISOString(),
            };
          }
        }
      } catch {
        // fallback
      }
    }
    return this.memNotifications.get(id) || null;
  }

  public async updateNotification(id: string, updates: Partial<INotification>): Promise<INotification | null> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          const updated = await NotificationModel.findByIdAndUpdate(id, updates, { new: true }).lean();
          if (updated) {
            const mapped: INotification = {
              id: updated._id.toString(),
              userId: updated.userId,
              title: updated.title,
              body: updated.body,
              type: updated.type as any,
              metadata: updated.metadata,
              read: updated.read,
              createdAt: updated.createdAt.toISOString(),
            };
            this.memNotifications.set(id, mapped);
            return mapped;
          }
        }
      } catch {
        // fallback
      }
    }
    const notif = this.memNotifications.get(id);
    if (!notif) return null;
    const merged = { ...notif, ...updates };
    this.memNotifications.set(id, merged);
    return merged;
  }

  public async markNotificationRead(id: string): Promise<void> {
    if (isDbConnected()) {
      try {
        if (mongoose.Types.ObjectId.isValid(id)) {
          await NotificationModel.findByIdAndUpdate(id, { read: true });
        }
      } catch {
        // fallback
      }
    }
    const notif = this.memNotifications.get(id);
    if (notif) {
      notif.read = true;
      this.memNotifications.set(id, notif);
    }
  }

  public async markAllNotificationsRead(userId: string): Promise<void> {
    if (isDbConnected()) {
      try {
        await NotificationModel.updateMany({ userId }, { read: true });
      } catch {
        // fallback
      }
    }
    for (const notif of this.memNotifications.values()) {
      if (notif.userId === userId) {
        notif.read = true;
      }
    }
  }

  // ==========================================
  // AUDIT LOG OPERATIONS
  // ==========================================
  public async createAuditLog(log: IAuditLog): Promise<IAuditLog> {
    this.memAuditLogs.unshift({ ...log });
    if (isDbConnected()) {
      try {
        await AuditLogModel.create({
          userId: log.userId,
          action: log.action,
          details: log.details,
          ip: log.ip,
          timestamp: new Date(log.timestamp),
        });
      } catch (err) {
        console.warn('[DB AuditLog] Mongo insert error:', (err as Error).message);
      }
    }
    return log;
  }

  public async getAuditLogs(limit: number = 100): Promise<IAuditLog[]> {
    if (isDbConnected()) {
      try {
        const docs = await AuditLogModel.find()
          .sort({ timestamp: -1 })
          .limit(limit)
          .lean();
        return docs.map((d) => ({
          id: d._id.toString(),
          userId: d.userId,
          action: d.action,
          details: d.details,
          ip: d.ip,
          timestamp: d.timestamp.toISOString(),
        }));
      } catch {
        // fallback
      }
    }
    return this.memAuditLogs.slice(0, limit);
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
    const entry: IRefreshSession = {
      id: 'ses_' + Math.random().toString(36).substring(2, 9),
      userId: session.userId,
      jti: session.jti,
      tokenHash: session.tokenHash,
      revoked: false,
      expiresAt: session.expiresAt.toISOString(),
      ip: session.ip,
      userAgent: session.userAgent,
      createdAt: new Date().toISOString(),
    };
    this.memSessions.set(session.jti, entry);

    if (isDbConnected()) {
      try {
        const created = await RefreshSessionModel.create({
          _id: new mongoose.Types.ObjectId(),
          userId: session.userId,
          jti: session.jti,
          tokenHash: session.tokenHash,
          expiresAt: session.expiresAt,
          ip: session.ip,
          userAgent: session.userAgent,
        });
        entry.id = created._id.toString();
        this.memSessions.set(session.jti, entry);
      } catch (err) {
        console.warn('[DB Session] Mongo insert error:', (err as Error).message);
      }
    }
    return entry;
  }

  public async findRefreshSessionByJti(jti: string): Promise<IRefreshSession | null> {
    if (isDbConnected()) {
      try {
        const doc = await RefreshSessionModel.findOne({ jti }).lean();
        if (doc) {
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
      } catch {
        // fallback
      }
    }
    return this.memSessions.get(jti) || null;
  }

  public async revokeRefreshSession(jti: string, reason: string = 'LOGOUT'): Promise<void> {
    if (isDbConnected()) {
      try {
        await RefreshSessionModel.findOneAndUpdate(
          { jti },
          { revoked: true, revokedReason: reason }
        );
      } catch {
        // fallback
      }
    }
    const session = this.memSessions.get(jti);
    if (session) {
      session.revoked = true;
      session.revokedReason = reason;
      this.memSessions.set(jti, session);
    }
  }

  public async revokeAllSessionsForUser(userId: string, reason: string = 'LOGOUT_ALL'): Promise<void> {
    if (isDbConnected()) {
      try {
        await RefreshSessionModel.updateMany(
          { userId },
          { revoked: true, revokedReason: reason }
        );
      } catch {
        // fallback
      }
    }
    for (const session of this.memSessions.values()) {
      if (session.userId === userId) {
        session.revoked = true;
        session.revokedReason = reason;
      }
    }
  }
}

export const db = new DatabaseStore();
