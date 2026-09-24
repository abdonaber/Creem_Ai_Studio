import { IDatabaseStore, IRefreshSession } from '../server/db/store';
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
} from '../server/types';
import { AppError } from '../server/middleware/errorHandler';
import { generateId } from '../server/utils/id';

export class TestDatabaseStore implements IDatabaseStore {
  public users = new Map<string, IUser>();
  public drivers = new Map<string, IDriver>();
  public vehicles = new Map<string, IVehicle>();
  public rides = new Map<string, IRide>();
  public offers = new Map<string, IRideOffer>();
  public wallets = new Map<string, IWallet>();
  public transactions = new Map<string, IWalletTransaction[]>();
  public payments = new Map<string, IPayment>();
  public ledger: IPlatformLedger[] = [];
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
    const id = user.id || generateId('usr');
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
    const id = driver.id || generateId('drv');
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
    const id = vehicle.id || generateId('veh');
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
    const id = ride.id || generateId('ride');
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
    const driver = this.drivers.get(driverId);
    if (driver) {
      driver.isBusy = true;
      driver.activeRideId = rideId;
    }
    ride.driverId = driverId;
    ride.status = 'DRIVER_ASSIGNED';
    ride.updatedAt = new Date().toISOString();
    return { success: true, ride };
  }

  async freeDriver(driverId: string, rideId?: string): Promise<boolean> {
    const driver = this.drivers.get(driverId);
    if (driver) {
      if (!rideId || driver.activeRideId === rideId) {
        driver.isBusy = false;
        driver.activeRideId = undefined;
        return true;
      }
    }
    return false;
  }

  async findNearbyEligibleDrivers(params: {
    pickupLat: number;
    pickupLng: number;
    radiusKm: number;
    category?: VehicleCategory;
    excludedDriverIds?: string[];
  }): Promise<Array<{ driver: IDriver; distanceKm: number }>> {
    const { pickupLat, pickupLng, radiusKm, category, excludedDriverIds = [] } = params;
    const results: Array<{ driver: IDriver; distanceKm: number }> = [];

    for (const driver of this.drivers.values()) {
      if (!driver.isOnline || driver.approvalStatus !== 'APPROVED' || driver.isBusy || !driver.currentLocation) continue;
      if (excludedDriverIds.includes(driver.id)) continue;
      if (category && driver.vehicle && driver.vehicle.category !== category) continue;

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

  async createRideOffer(offer: Partial<IRideOffer>): Promise<IRideOffer> {
    const id = offer.id || generateId('offer');
    const created: IRideOffer = {
      id,
      rideId: offer.rideId!,
      driverId: offer.driverId!,
      status: offer.status || 'PENDING',
      expiresAt: offer.expiresAt || new Date(Date.now() + 25000).toISOString(),
      distanceKm: offer.distanceKm || 1,
      estimatedFare: offer.estimatedFare || 25,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.offers.set(id, created);
    return created;
  }

  async findOfferById(offerId: string): Promise<IRideOffer | null> {
    return this.offers.get(offerId) || null;
  }

  async findActiveOfferForRide(rideId: string): Promise<IRideOffer | null> {
    for (const o of this.offers.values()) {
      if (o.rideId === rideId && o.status === 'PENDING') return o;
    }
    return null;
  }

  async updateRideOfferStatus(
    offerId: string,
    status: 'ACCEPTED' | 'REJECTED' | 'EXPIRED'
  ): Promise<void> {
    const offer = this.offers.get(offerId);
    if (offer) {
      offer.status = status;
      offer.updatedAt = new Date().toISOString();
    }
  }

  async getPendingOffersExpiredBefore(date: Date): Promise<IRideOffer[]> {
    const expired: IRideOffer[] = [];
    const targetMs = date.getTime();
    for (const o of this.offers.values()) {
      if (o.status === 'PENDING' && new Date(o.expiresAt).getTime() < targetMs) {
        expired.push(o);
      }
    }
    return expired;
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
      id: generateId('tx'),
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
      id: generateId('tx'),
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
    const id = payment.id || generateId('pay');
    const p: IPayment = {
      id,
      rideId: payment.rideId!,
      userId: payment.userId!,
      amount: payment.amount || 0,
      currency: payment.currency || 'SAR',
      status: payment.status || 'PENDING',
      paymentMethod: payment.paymentMethod || 'WALLET',
      stripePaymentIntentId: payment.stripePaymentIntentId,
      stripeClientSecret: payment.stripeClientSecret,
      idempotencyKey: payment.idempotencyKey,
      refundAmount: payment.refundAmount,
      metadata: payment.metadata,
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
  async claimWebhookEvent(
    eventId: string,
    source: string,
    type: string
  ): Promise<{ claimed: boolean; alreadyProcessed: boolean }> {
    if (this.processedWebhooks.has(eventId)) {
      return { claimed: false, alreadyProcessed: true };
    }
    this.processedWebhooks.add(eventId);
    return { claimed: true, alreadyProcessed: false };
  }
  async recordProcessedWebhook(eventId: string): Promise<void> {
    this.processedWebhooks.add(eventId);
  }

  // Ledger & Cash Settlement
  async recordLedgerEntry(entry: Omit<IPlatformLedger, 'id' | 'createdAt'>): Promise<IPlatformLedger> {
    const l: IPlatformLedger = {
      id: generateId('led'),
      rideId: entry.rideId,
      type: entry.type,
      amount: entry.amount,
      currency: entry.currency || 'SAR',
      fromAccount: entry.fromAccount,
      toAccount: entry.toAccount,
      status: entry.status || 'COMMITTED',
      idempotencyKey: entry.idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    this.ledger.push(l);
    return l;
  }
  async getPlatformLedger(limit: number = 100, filter?: Partial<IPlatformLedger>): Promise<IPlatformLedger[]> {
    let result = [...this.ledger];
    if (filter?.rideId) result = result.filter((x) => x.rideId === filter.rideId);
    if (filter?.type) result = result.filter((x) => x.type === filter.type);
    if (filter?.status) result = result.filter((x) => x.status === filter.status);
    return result.slice(0, limit);
  }
  async settleCashPayment(params: {
    rideId: string;
    riderId: string;
    driverId: string;
    amount: number;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; transactionId: string; platformFee: number; commissionDebt: number }> {
    const platformFee = Math.round(params.amount * 0.2 * 100) / 100;
    let debtIncurred = 0;

    const payment = await this.createPayment({
      rideId: params.rideId,
      userId: params.riderId,
      amount: params.amount,
      currency: 'SAR',
      status: 'SUCCEEDED',
      paymentMethod: 'CASH',
      idempotencyKey: params.idempotencyKey,
    });

    // Record Rider cash payment ledger entry
    await this.recordLedgerEntry({
      rideId: params.rideId,
      type: 'RIDER_FARE',
      amount: params.amount,
      currency: 'SAR',
      fromAccount: `rider:${params.riderId}`,
      toAccount: `driver:${params.driverId}`,
      status: 'COMMITTED',
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}_rider` : undefined,
    });

    // Process driver commission
    const driver = await this.findDriverById(params.driverId);
    if (driver) {
      const driverWallet = await this.getOrCreateWallet(driver.userId);
      if (driverWallet.balance >= platformFee) {
        await this.debitWallet(
          driver.userId,
          platformFee,
          `Platform commission (20%) for cash ride #${params.rideId.slice(0, 8)}`,
          params.rideId
        );
        await this.recordLedgerEntry({
          rideId: params.rideId,
          type: 'PLATFORM_COMMISSION',
          amount: platformFee,
          currency: 'SAR',
          fromAccount: `driver:${driver.id}`,
          toAccount: 'platform:commission',
          status: 'COMMITTED',
        });
      } else {
        debtIncurred = platformFee;
        driver.outstandingDebt = (driver.outstandingDebt || 0) + debtIncurred;
        await this.recordLedgerEntry({
          rideId: params.rideId,
          type: 'COMMISSION_DEBT',
          amount: debtIncurred,
          currency: 'SAR',
          fromAccount: `driver:${driver.id}`,
          toAccount: 'platform:debt',
          status: 'OUTSTANDING',
        });
      }
    }

    await this.updateRide(params.rideId, {
      paymentStatus: 'SUCCEEDED',
      paymentMethod: 'CASH',
      finalFare: params.amount,
    });

    return {
      success: true,
      transactionId: payment.id,
      platformFee,
      commissionDebt: debtIncurred,
    };
  }

  // Ratings
  async createRating(rating: Partial<IRating>): Promise<IRating> {
    const r: IRating = {
      id: generateId('rat'),
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
      id: generateId('msg'),
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
      id: generateId('notif'),
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
      id: generateId('aud'),
      userId,
      action,
      details: details || {},
      ip,
      timestamp: new Date().toISOString(),
    });
  }
  async createAuditLog(log: Partial<IAuditLog>): Promise<IAuditLog> {
    const a: IAuditLog = {
      id: generateId('aud'),
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

  async getRidesPaginated(options: {
    page?: number;
    limit?: number;
    status?: string;
    riderId?: string;
    driverId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ data: IRide[]; total: number; page: number; totalPages: number }> {
    let arr = Array.from(this.rides.values());
    if (options.status) arr = arr.filter((r) => r.status === options.status);
    if (options.riderId) arr = arr.filter((r) => r.riderId === options.riderId);
    if (options.driverId) arr = arr.filter((r) => r.driverId === options.driverId);

    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const total = arr.length;
    const skip = (page - 1) * limit;

    return {
      data: arr.slice(skip, skip + limit),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getUsersPaginated(options: {
    page?: number;
    limit?: number;
    role?: string;
    search?: string;
  }): Promise<{ data: Omit<IUser, 'passwordHash'>[]; total: number; page: number; totalPages: number }> {
    let arr = Array.from(this.users.values()).map((u) => {
      const { passwordHash: _, ...safe } = u as any;
      return safe;
    });
    if (options.role) arr = arr.filter((u) => u.role === options.role);
    if (options.search) {
      const s = options.search.toLowerCase();
      arr = arr.filter((u) => u.name?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s));
    }

    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const total = arr.length;
    const skip = (page - 1) * limit;

    return {
      data: arr.slice(skip, skip + limit),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getDriversPaginated(options: {
    page?: number;
    limit?: number;
    approvalStatus?: string;
    isOnline?: boolean;
    search?: string;
  }): Promise<{ data: IDriver[]; total: number; page: number; totalPages: number }> {
    let arr = Array.from(this.drivers.values());
    if (options.approvalStatus) arr = arr.filter((d) => d.approvalStatus === options.approvalStatus);
    if (options.isOnline !== undefined) arr = arr.filter((d) => d.isOnline === options.isOnline);

    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const total = arr.length;
    const skip = (page - 1) * limit;

    return {
      data: arr.slice(skip, skip + limit),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getFinancialSummary(): Promise<{
    totalGrossVolume: number;
    totalPlatformRevenue: number;
    totalDriverPayouts: number;
    totalOutstandingDebt: number;
    transactionCount: number;
  }> {
    const succeeded = Array.from(this.payments.values()).filter((p) => p.status === 'SUCCEEDED');
    const totalGrossVolume = succeeded.reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalPlatformRevenue = Math.round(totalGrossVolume * 0.2 * 100) / 100;
    const totalDriverPayouts = Math.round((totalGrossVolume - totalPlatformRevenue) * 100) / 100;
    const totalOutstandingDebt = Array.from(this.drivers.values()).reduce(
      (sum, d) => sum + ((d as any).outstandingDebt || 0),
      0
    );

    return {
      totalGrossVolume,
      totalPlatformRevenue,
      totalDriverPayouts,
      totalOutstandingDebt,
      transactionCount: succeeded.length,
    };
  }

  async reconcileFinancialIntegrity(): Promise<{
    healthy: boolean;
    discrepanciesCount: number;
    discrepancies: Array<{
      type: 'WALLET_MISMATCH' | 'PAYMENT_RIDE_MISMATCH' | 'COMMISSION_MISMATCH' | 'DRIVER_DEBT_MISMATCH';
      id: string;
      details: string;
    }>;
  }> {
    const discrepancies: Array<{
      type: 'WALLET_MISMATCH' | 'PAYMENT_RIDE_MISMATCH' | 'COMMISSION_MISMATCH' | 'DRIVER_DEBT_MISMATCH';
      id: string;
      details: string;
    }> = [];

    // 1. Audit Wallets against transactions
    for (const [userId, wallet] of this.wallets.entries()) {
      const userTxs = this.transactions.get(userId) || [];
      const calculatedBalance = userTxs.reduce((sum, tx) => {
        return tx.type === 'CREDIT' ? sum + tx.amount : sum - tx.amount;
      }, 0);
      const diff = Math.abs(wallet.balance - calculatedBalance);
      if (diff > 0.05) {
        discrepancies.push({
          type: 'WALLET_MISMATCH',
          id: userId,
          details: `Wallet balance (${wallet.balance.toFixed(2)} SAR) does not match sum of transactions (${calculatedBalance.toFixed(2)} SAR). Difference: ${diff.toFixed(2)} SAR.`,
        });
      }
    }

    // 2. Audit Completed Rides vs Payments
    for (const [rideId, ride] of this.rides.entries()) {
      if (ride.status === 'RIDE_COMPLETED') {
        const payment = Array.from(this.payments.values()).find((p) => p.rideId === rideId);
        if (!payment) {
          discrepancies.push({
            type: 'PAYMENT_RIDE_MISMATCH',
            id: rideId,
            details: `Completed ride #${rideId} has no payment record.`,
          });
        } else if (ride.paymentStatus === 'SUCCEEDED' && payment.status !== 'SUCCEEDED') {
          discrepancies.push({
            type: 'PAYMENT_RIDE_MISMATCH',
            id: rideId,
            details: `Ride marked paymentStatus: SUCCEEDED but payment record #${payment.id} is status: ${payment.status}.`,
          });
        }
      }
    }

    // 3. Audit Driver Outstanding Debt against Ledger
    for (const [driverId, driver] of this.drivers.entries()) {
      if ((driver.outstandingDebt || 0) > 0) {
        const debtLedgers = this.ledger.filter(
          (l) => l.fromAccount === `driver:${driverId}` && l.type === 'COMMISSION_DEBT'
        );
        const recoveryLedgers = this.ledger.filter(
          (l) => l.fromAccount === `driver:${driverId}` && l.type === 'DEBT_RECOVERY'
        );

        const totalIncurred = debtLedgers.reduce((acc, l) => acc + l.amount, 0);
        const totalRecovered = recoveryLedgers.reduce((acc, l) => acc + l.amount, 0);
        const expectedDebt = Math.max(0, Math.round((totalIncurred - totalRecovered) * 100) / 100);

        if (Math.abs((driver.outstandingDebt || 0) - expectedDebt) > 0.05) {
          discrepancies.push({
            type: 'DRIVER_DEBT_MISMATCH',
            id: driverId,
            details: `Driver debt record (${driver.outstandingDebt} SAR) does not match ledger balance (${expectedDebt} SAR).`,
          });
        }
      }
    }

    return {
      healthy: discrepancies.length === 0,
      discrepanciesCount: discrepancies.length,
      discrepancies,
    };
  }

  // Sessions
  async createRefreshSession(session: any): Promise<IRefreshSession> {
    const s: IRefreshSession = {
      id: generateId('ses'),
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
