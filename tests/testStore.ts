import { IDatabaseStore, IRefreshSession } from '../server/db/store';
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
} from '../server/types';
import { AppError } from '../server/middleware/errorHandler';

export class TestDatabaseStore implements IDatabaseStore {
  public users = new Map<string, IUser>();
  public drivers = new Map<string, IDriver>();
  public vehicles = new Map<string, IVehicle>();
  public rides = new Map<string, IRide>();
  public wallets = new Map<string, IWallet>();
  public transactions = new Map<string, IWalletTransaction[]>();
  public payments = new Map<string, IPayment>();
  public ratings: IRating[] = [];
  public messages: IMessage[] = [];
  public notifications: INotification[] = [];
  public auditLogs: IAuditLog[] = [];
  public sessions = new Map<string, IRefreshSession>();
  public processedWebhooks = new Set<string>();

  public clearAll(): void {
    this.users.clear();
    this.drivers.clear();
    this.vehicles.clear();
    this.rides.clear();
    this.wallets.clear();
    this.transactions.clear();
    this.payments.clear();
    this.ratings = [];
    this.messages = [];
    this.notifications = [];
    this.auditLogs = [];
    this.sessions.clear();
    this.processedWebhooks.clear();
  }

  // Users
  async findUserById(id: string): Promise<IUser | null> {
    return this.users.get(id) || null;
  }
  async findUserByEmail(email: string): Promise<IUser | null> {
    const target = email.toLowerCase().trim();
    for (const u of this.users.values()) {
      if (u.email.toLowerCase() === target) return u;
    }
    return null;
  }
  async findUserByPhone(phone: string): Promise<IUser | null> {
    for (const u of this.users.values()) {
      if (u.phone === phone) return u;
    }
    return null;
  }
  async createUser(user: Partial<IUser>): Promise<IUser> {
    const id = user.id || 'usr_' + Math.random().toString(36).substring(2, 9);
    const created: IUser = {
      id,
      name: user.name || '',
      email: user.email?.toLowerCase().trim() || '',
      phone: user.phone || '',
      passwordHash: user.passwordHash || '',
      role: user.role || 'RIDER',
      status: user.status || 'ACTIVE',
      avatarUrl: user.avatarUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(id, created);
    return created;
  }
  async updateUser(id: string, updates: Partial<IUser>): Promise<IUser | null> {
    const existing = this.users.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.users.set(id, updated);
    return updated;
  }
  async getAllUsers(): Promise<IUser[]> {
    return Array.from(this.users.values());
  }

  // Drivers
  async findDriverById(id: string): Promise<IDriver | null> {
    return this.drivers.get(id) || null;
  }
  async findDriverByUserId(userId: string): Promise<IDriver | null> {
    for (const d of this.drivers.values()) {
      if (d.userId === userId) return d;
    }
    return null;
  }
  async createDriver(driver: Partial<IDriver>): Promise<IDriver> {
    const id = driver.id || 'drv_' + Math.random().toString(36).substring(2, 9);
    const created: IDriver = {
      id,
      userId: driver.userId!,
      approvalStatus: driver.approvalStatus || 'PENDING',
      isOnline: driver.isOnline || false,
      currentLocation: driver.currentLocation || {
        lat: 24.7136,
        lng: 46.6753,
        heading: 0,
        updatedAt: new Date().toISOString(),
      },
      rating: driver.rating || 5.0,
      totalRides: driver.totalRides || 0,
      licenseNumber: driver.licenseNumber || '',
      documents: driver.documents || {},
      earningsTotal: driver.earningsTotal || 0,
    };
    this.drivers.set(id, created);
    return created;
  }
  async updateDriver(id: string, updates: Partial<IDriver>): Promise<IDriver | null> {
    const existing = this.drivers.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.drivers.set(id, updated);
    return updated;
  }
  async getOnlineApprovedDrivers(): Promise<IDriver[]> {
    return Array.from(this.drivers.values()).filter(
      (d) => d.isOnline && d.approvalStatus === 'APPROVED'
    );
  }
  async getAllDrivers(): Promise<IDriver[]> {
    return Array.from(this.drivers.values());
  }
  async findVehicleByDriverId(driverId: string): Promise<IVehicle | null> {
    return this.vehicles.get(driverId) || null;
  }
  async createVehicle(vehicle: Partial<IVehicle>): Promise<IVehicle> {
    const id = vehicle.id || 'veh_' + Math.random().toString(36).substring(2, 9);
    const created: IVehicle = {
      id,
      driverId: vehicle.driverId!,
      make: vehicle.make || '',
      model: vehicle.model || '',
      year: vehicle.year || 2024,
      color: vehicle.color || '',
      plateNumber: vehicle.plateNumber || '',
      category: vehicle.category || 'STANDARD',
    };
    this.vehicles.set(vehicle.driverId!, created);
    return created;
  }
  async updateVehicle(driverId: string, updates: Partial<IVehicle>): Promise<IVehicle | null> {
    const existing = this.vehicles.get(driverId);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.vehicles.set(driverId, updated);
    return updated;
  }

  // Rides
  async createRide(ride: Partial<IRide>): Promise<IRide> {
    const id = ride.id || 'ride_' + Math.random().toString(36).substring(2, 9);
    const created: IRide = {
      id,
      riderId: ride.riderId!,
      driverId: ride.driverId,
      status: ride.status || 'REQUESTED',
      vehicleCategory: ride.vehicleCategory || 'STANDARD',
      pickup: ride.pickup!,
      destination: ride.destination!,
      estimatedFare: ride.estimatedFare || 25,
      finalFare: ride.finalFare,
      tip: ride.tip || 0,
      distanceKm: ride.distanceKm || 5,
      durationMinutes: ride.durationMinutes || 10,
      paymentMethod: ride.paymentMethod || 'WALLET',
      paymentStatus: ride.paymentStatus || 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.rides.set(id, created);
    return created;
  }
  async findRideById(id: string): Promise<IRide | null> {
    return this.rides.get(id) || null;
  }
  async updateRide(id: string, updates: Partial<IRide>): Promise<IRide | null> {
    const existing = this.rides.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.rides.set(id, updated);
    return updated;
  }
  async findActiveRideForUser(userId: string): Promise<IRide | null> {
    const active = ['REQUESTED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'];
    for (const r of this.rides.values()) {
      if ((r.riderId === userId || r.driverId === userId) && active.includes(r.status)) {
        return r;
      }
    }
    return null;
  }
  async getRidesByRiderId(riderId: string): Promise<IRide[]> {
    return Array.from(this.rides.values()).filter((r) => r.riderId === riderId);
  }
  async getRidesByDriverId(driverId: string): Promise<IRide[]> {
    return Array.from(this.rides.values()).filter((r) => r.driverId === driverId);
  }
  async getAllRides(): Promise<IRide[]> {
    return Array.from(this.rides.values());
  }
  async atomicTransitionRide(
    rideId: string,
    nextStatus: RideStatus,
    allowedCurrentStatuses: RideStatus[],
    additionalUpdates?: Partial<IRide>
  ): Promise<{ success: boolean; ride?: IRide; message?: string }> {
    const ride = this.rides.get(rideId);
    if (!ride) return { success: false, message: 'Ride not found' };
    if (!allowedCurrentStatuses.includes(ride.status)) {
      return { success: false, message: `Invalid transition from ${ride.status}` };
    }
    ride.status = nextStatus;
    if (additionalUpdates) {
      Object.assign(ride, additionalUpdates);
    }
    ride.updatedAt = new Date().toISOString();
    return { success: true, ride };
  }
  async atomicAcceptRide(
    rideId: string,
    driverId: string
  ): Promise<{ success: boolean; ride?: IRide; message?: string }> {
    const ride = this.rides.get(rideId);
    if (!ride || ride.driverId || !['REQUESTED', 'SEARCHING_DRIVER'].includes(ride.status)) {
      return { success: false, message: 'Ride unavailable' };
    }
    ride.driverId = driverId;
    ride.status = 'DRIVER_ASSIGNED';
    ride.updatedAt = new Date().toISOString();
    return { success: true, ride };
  }

  // Wallet
  async getOrCreateWallet(userId: string): Promise<IWallet> {
    let w = this.wallets.get(userId);
    if (!w) {
      w = {
        id: 'wal_' + userId,
        userId,
        balance: 0,
        currency: 'SAR',
        updatedAt: new Date().toISOString(),
      };
      this.wallets.set(userId, w);
    }
    return w;
  }
  async debitWallet(
    userId: string,
    amount: number,
    description: string,
    referenceId?: string,
    idempotencyKey?: string
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    const wallet = await this.getOrCreateWallet(userId);
    if (wallet.balance < amount) {
      throw new AppError('Insufficient balance', 400, 'INSUFFICIENT_FUNDS');
    }
    wallet.balance -= amount;
    const tx: IWalletTransaction = {
      id: 'tx_' + Math.random().toString(36).substring(2, 9),
      walletId: wallet.id,
      userId,
      amount,
      type: 'DEBIT',
      balanceAfter: wallet.balance,
      reason: description,
      referenceId,
      createdAt: new Date().toISOString(),
    };
    const userTxs = this.transactions.get(userId) || [];
    userTxs.push(tx);
    this.transactions.set(userId, userTxs);
    return { wallet, transaction: tx };
  }
  async creditWallet(
    userId: string,
    amount: number,
    description: string,
    referenceId?: string,
    idempotencyKey?: string
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    const wallet = await this.getOrCreateWallet(userId);
    wallet.balance += amount;
    const tx: IWalletTransaction = {
      id: 'tx_' + Math.random().toString(36).substring(2, 9),
      walletId: wallet.id,
      userId,
      amount,
      type: 'CREDIT',
      balanceAfter: wallet.balance,
      reason: description,
      referenceId,
      createdAt: new Date().toISOString(),
    };
    const userTxs = this.transactions.get(userId) || [];
    userTxs.push(tx);
    this.transactions.set(userId, userTxs);
    return { wallet, transaction: tx };
  }
  async settleRidePaymentWallet(params: {
    rideId: string;
    riderId: string;
    driverId?: string;
    amount: number;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; transactionId: string }> {
    await this.debitWallet(params.riderId, params.amount, `Ride payment ${params.rideId}`);
    if (params.driverId) {
      const d = await this.findDriverById(params.driverId);
      if (d) {
        const net = Math.round(params.amount * 0.8 * 100) / 100;
        await this.creditWallet(d.userId, net, `Ride earnings ${params.rideId}`);
      }
    }
    await this.updateRide(params.rideId, { paymentStatus: 'SUCCEEDED' });
    return { success: true, transactionId: 'settle_' + params.rideId };
  }
  async getTransactionsForUser(userId: string): Promise<IWalletTransaction[]> {
    return this.transactions.get(userId) || [];
  }

  // Payments
  async createPayment(payment: Partial<IPayment>): Promise<IPayment> {
    const id = payment.id || 'pay_' + Math.random().toString(36).substring(2, 9);
    const p: IPayment = {
      id,
      rideId: payment.rideId!,
      userId: payment.userId!,
      amount: payment.amount || 0,
      currency: payment.currency || 'SAR',
      status: payment.status || 'PENDING',
      paymentMethod: payment.paymentMethod || 'WALLET',
      createdAt: new Date().toISOString(),
    };
    this.payments.set(id, p);
    return p;
  }
  async findPaymentById(id: string): Promise<IPayment | null> {
    return this.payments.get(id) || null;
  }
  async findPaymentByRideId(rideId: string): Promise<IPayment | null> {
    for (const p of this.payments.values()) {
      if (p.rideId === rideId) return p;
    }
    return null;
  }
  async findPaymentByStripeIntent(intentId: string): Promise<IPayment | null> {
    for (const p of this.payments.values()) {
      if (p.stripePaymentIntentId === intentId) return p;
    }
    return null;
  }
  async updatePayment(id: string, updates: Partial<IPayment>): Promise<IPayment | null> {
    const existing = this.payments.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.payments.set(id, updated);
    return updated;
  }

  // Webhooks
  async isWebhookProcessed(eventId: string): Promise<boolean> {
    return this.processedWebhooks.has(eventId);
  }
  async recordProcessedWebhook(eventId: string): Promise<void> {
    this.processedWebhooks.add(eventId);
  }

  // Ratings
  async createRating(rating: Partial<IRating>): Promise<IRating> {
    const r: IRating = {
      id: 'rat_' + Math.random().toString(36).substring(2, 9),
      rideId: rating.rideId!,
      fromUserId: rating.fromUserId!,
      toUserId: rating.toUserId!,
      stars: rating.stars || (rating as any).score || 5,
      comment: rating.comment,
      createdAt: new Date().toISOString(),
    };
    this.ratings.push(r);
    return r;
  }
  async getRatingsForUser(userId: string): Promise<IRating[]> {
    return this.ratings.filter((r) => r.toUserId === userId);
  }
  async findRatingByRideAndFromUser(rideId: string, fromUserId: string): Promise<IRating | null> {
    return this.ratings.find((r) => r.rideId === rideId && r.fromUserId === fromUserId) || null;
  }

  // Messages
  async createMessage(msg: Partial<IMessage>): Promise<IMessage> {
    const m: IMessage = {
      id: 'msg_' + Math.random().toString(36).substring(2, 9),
      rideId: msg.rideId!,
      senderId: msg.senderId!,
      senderName: msg.senderName || '',
      recipientId: msg.recipientId!,
      content: msg.content || '',
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(m);
    return m;
  }
  async getMessagesForRide(rideId: string): Promise<IMessage[]> {
    return this.messages.filter((m) => m.rideId === rideId);
  }

  // Notifications
  async createNotification(notif: Partial<INotification>): Promise<INotification> {
    const n: INotification = {
      id: 'notif_' + Math.random().toString(36).substring(2, 9),
      userId: notif.userId!,
      title: notif.title || '',
      body: notif.body || (notif as any).message || '',
      type: notif.type || 'SYSTEM',
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.notifications.push(n);
    return n;
  }
  async getNotificationsForUser(userId: string): Promise<INotification[]> {
    return this.notifications.filter((n) => n.userId === userId);
  }
  async findNotificationById(id: string): Promise<INotification | null> {
    return this.notifications.find((n) => n.id === id) || null;
  }
  async updateNotification(id: string, updates: Partial<INotification>): Promise<INotification | null> {
    const n = this.notifications.find((x) => x.id === id);
    if (!n) return null;
    Object.assign(n, updates);
    return n;
  }
  async markNotificationRead(id: string, userId: string): Promise<boolean> {
    const n = this.notifications.find((x) => x.id === id && x.userId === userId);
    if (!n) return false;
    n.read = true;
    return true;
  }
  async markAllNotificationsRead(userId: string): Promise<number> {
    let count = 0;
    for (const n of this.notifications) {
      if (n.userId === userId && !n.read) {
        n.read = true;
        count++;
      }
    }
    return count;
  }

  // Audit
  async logAudit(userId: string, action: string, details?: any, ip?: string): Promise<void> {
    this.auditLogs.push({
      id: 'aud_' + Math.random().toString(36).substring(2, 9),
      userId,
      action,
      details: details || {},
      ip,
      timestamp: new Date().toISOString(),
    });
  }
  async createAuditLog(log: Partial<IAuditLog>): Promise<IAuditLog> {
    const a: IAuditLog = {
      id: 'aud_' + Math.random().toString(36).substring(2, 9),
      userId: log.userId || '',
      action: log.action || '',
      details: log.details || {},
      ip: log.ip,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.push(a);
    return a;
  }
  async getAuditLogs(limit: number = 100): Promise<IAuditLog[]> {
    return this.auditLogs.slice(0, limit);
  }
  async getPlatformStats(): Promise<any> {
    return {
      totalUsers: this.users.size,
      totalDrivers: this.drivers.size,
      onlineDrivers: 0,
      totalRides: this.rides.size,
      completedRides: 0,
    };
  }

  // Sessions
  async createRefreshSession(session: any): Promise<IRefreshSession> {
    const s: IRefreshSession = {
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
    this.sessions.set(session.jti, s);
    return s;
  }
  async findRefreshSessionByJti(jti: string): Promise<IRefreshSession | null> {
    return this.sessions.get(jti) || null;
  }
  async revokeRefreshSession(jti: string, reason?: string): Promise<void> {
    const s = this.sessions.get(jti);
    if (s) {
      s.revoked = true;
      s.revokedReason = reason;
    }
  }
  async revokeAllSessionsForUser(userId: string, reason?: string): Promise<void> {
    for (const s of this.sessions.values()) {
      if (s.userId === userId) {
        s.revoked = true;
        s.revokedReason = reason;
      }
    }
  }
}
