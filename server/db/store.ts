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
  RideStatus,
} from '../types';

interface RefreshTokenEntry {
  token: string;
  userId: string;
  expiresAt: number;
}

class DatabaseStore {
  public users: Map<string, IUser> = new Map();
  public drivers: Map<string, IDriver> = new Map();
  public vehicles: Map<string, IVehicle> = new Map();
  public rides: Map<string, IRide> = new Map();
  public wallets: Map<string, IWallet> = new Map();
  public transactions: Map<string, IWalletTransaction> = new Map();
  public ratings: Map<string, IRating> = new Map();
  public messages: Map<string, IMessage> = new Map();
  public notifications: Map<string, INotification> = new Map();
  public auditLogs: IAuditLog[] = [];
  public refreshTokens: Map<string, RefreshTokenEntry> = new Map();

  // Ride dispatch atomic lock: prevents multiple drivers from claiming the same ride simultaneously
  private rideLocks: Map<string, boolean> = new Map();

  // USER CRUD
  public createUser(user: IUser): IUser {
    this.users.set(user.id, { ...user });
    return user;
  }

  public findUserById(id: string): IUser | null {
    return this.users.get(id) || null;
  }

  public findUserByEmail(email: string): IUser | null {
    const lower = email.toLowerCase().trim();
    for (const u of this.users.values()) {
      if (u.email.toLowerCase().trim() === lower) return u;
    }
    return null;
  }

  public findUserByPhone(phone: string): IUser | null {
    const trimmed = phone.trim();
    for (const u of this.users.values()) {
      if (u.phone.trim() === trimmed) return u;
    }
    return null;
  }

  public updateUser(id: string, updates: Partial<IUser>): IUser | null {
    const user = this.users.get(id);
    if (!user) return null;
    const updated = { ...user, ...updates, updatedAt: new Date().toISOString() };
    this.users.set(id, updated);
    return updated;
  }

  // DRIVER CRUD
  public createDriver(driver: IDriver): IDriver {
    this.drivers.set(driver.id, { ...driver });
    return driver;
  }

  public findDriverById(id: string): IDriver | null {
    return this.drivers.get(id) || null;
  }

  public findDriverByUserId(userId: string): IDriver | null {
    for (const d of this.drivers.values()) {
      if (d.userId === userId) return d;
    }
    return null;
  }

  public updateDriver(id: string, updates: Partial<IDriver>): IDriver | null {
    const driver = this.drivers.get(id);
    if (!driver) return null;
    const updated = { ...driver, ...updates };
    this.drivers.set(id, updated);
    return updated;
  }

  public getAllDrivers(): IDriver[] {
    return Array.from(this.drivers.values());
  }

  public getOnlineApprovedDrivers(): IDriver[] {
    return Array.from(this.drivers.values()).filter(
      (d) => d.isOnline && d.approvalStatus === 'APPROVED'
    );
  }

  // VEHICLE CRUD
  public createVehicle(vehicle: IVehicle): IVehicle {
    this.vehicles.set(vehicle.id, { ...vehicle });
    return vehicle;
  }

  public findVehicleByDriverId(driverId: string): IVehicle | null {
    for (const v of this.vehicles.values()) {
      if (v.driverId === driverId) return v;
    }
    return null;
  }

  // RIDE CRUD & ATOMIC DISPATCH
  public createRide(ride: IRide): IRide {
    this.rides.set(ride.id, { ...ride });
    return ride;
  }

  public findRideById(id: string): IRide | null {
    return this.rides.get(id) || null;
  }

  public updateRide(id: string, updates: Partial<IRide>): IRide | null {
    const ride = this.rides.get(id);
    if (!ride) return null;
    const updated = { ...ride, ...updates, updatedAt: new Date().toISOString() };
    this.rides.set(id, updated);
    return updated;
  }

  public getRidesByRiderId(riderId: string): IRide[] {
    return Array.from(this.rides.values())
      .filter((r) => r.riderId === riderId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public getRidesByDriverId(driverId: string): IRide[] {
    return Array.from(this.rides.values())
      .filter((r) => r.driverId === driverId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public getAllRides(): IRide[] {
    return Array.from(this.rides.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  // Atomic driver acceptance lock (Prevents race conditions where 2 drivers accept the same ride)
  public atomicAcceptRide(rideId: string, driverId: string): { success: boolean; ride?: IRide; message: string } {
    if (this.rideLocks.get(rideId)) {
      return { success: false, message: 'Ride is currently being claimed by another driver.' };
    }

    this.rideLocks.set(rideId, true);
    try {
      const ride = this.rides.get(rideId);
      if (!ride) {
        return { success: false, message: 'Ride not found' };
      }
      if (ride.status !== 'REQUESTED' && ride.status !== 'SEARCHING_DRIVER') {
        return { success: false, message: `Ride cannot be accepted in status: ${ride.status}` };
      }
      if (ride.driverId && ride.driverId !== driverId) {
        return { success: false, message: 'Ride already accepted by another driver' };
      }

      ride.driverId = driverId;
      ride.status = 'DRIVER_ASSIGNED';
      ride.updatedAt = new Date().toISOString();
      this.rides.set(rideId, { ...ride });

      return { success: true, ride: { ...ride }, message: 'Ride successfully assigned' };
    } finally {
      this.rideLocks.delete(rideId);
    }
  }

  // Atomic state machine transition with validation
  public atomicTransitionRide(
    rideId: string,
    newStatus: RideStatus,
    allowedFrom: RideStatus[],
    additionalUpdates?: Partial<IRide>
  ): { success: boolean; ride?: IRide; error?: string } {
    const ride = this.rides.get(rideId);
    if (!ride) {
      return { success: false, error: 'Ride not found' };
    }

    if (!allowedFrom.includes(ride.status)) {
      return {
        success: false,
        error: `Illegal state transition from ${ride.status} to ${newStatus}. Allowed from: [${allowedFrom.join(', ')}]`,
      };
    }

    const updated: IRide = {
      ...ride,
      ...additionalUpdates,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    };
    this.rides.set(rideId, updated);
    return { success: true, ride: updated };
  }

  // WALLET & TRANSACTIONS
  public getOrCreateWallet(userId: string): IWallet {
    for (const w of this.wallets.values()) {
      if (w.userId === userId) return w;
    }
    const newWallet: IWallet = {
      id: 'w_' + Math.random().toString(36).substring(2, 9),
      userId,
      balance: 100, // Initial signup promotional credit (100 SAR)
      currency: 'SAR',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.wallets.set(newWallet.id, newWallet);
    return newWallet;
  }

  public creditWallet(userId: string, amount: number, reason: string, referenceId?: string): IWalletTransaction {
    const wallet = this.getOrCreateWallet(userId);
    wallet.balance += amount;
    wallet.updatedAt = new Date().toISOString();

    const tx: IWalletTransaction = {
      id: 'tx_' + Math.random().toString(36).substring(2, 10),
      walletId: wallet.id,
      userId,
      type: 'CREDIT',
      amount,
      balanceAfter: wallet.balance,
      reason,
      referenceId,
      createdAt: new Date().toISOString(),
    };
    this.transactions.set(tx.id, tx);
    return tx;
  }

  public debitWallet(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string
  ): { success: boolean; transaction?: IWalletTransaction; error?: string } {
    const wallet = this.getOrCreateWallet(userId);
    if (wallet.balance < amount) {
      return { success: false, error: 'Insufficient wallet balance' };
    }

    wallet.balance -= amount;
    wallet.updatedAt = new Date().toISOString();

    const tx: IWalletTransaction = {
      id: 'tx_' + Math.random().toString(36).substring(2, 10),
      walletId: wallet.id,
      userId,
      type: 'DEBIT',
      amount,
      balanceAfter: wallet.balance,
      reason,
      referenceId,
      createdAt: new Date().toISOString(),
    };
    this.transactions.set(tx.id, tx);
    return { success: true, transaction: tx };
  }

  public getWalletTransactions(userId: string): IWalletTransaction[] {
    return Array.from(this.transactions.values())
      .filter((t) => t.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // CHAT MESSAGES
  public addMessage(message: IMessage): IMessage {
    this.messages.set(message.id, { ...message });
    return message;
  }

  public getRideMessages(rideId: string): IMessage[] {
    return Array.from(this.messages.values())
      .filter((m) => m.rideId === rideId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // RATINGS
  public addRating(rating: IRating): IRating {
    this.ratings.set(rating.id, { ...rating });
    return rating;
  }

  public getUserRatings(userId: string): IRating[] {
    return Array.from(this.ratings.values()).filter((r) => r.toUserId === userId);
  }

  // NOTIFICATIONS
  public addNotification(notif: INotification): INotification {
    this.notifications.set(notif.id, { ...notif });
    return notif;
  }

  public getUserNotifications(userId: string): INotification[] {
    return Array.from(this.notifications.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public markNotificationAsRead(id: string, userId: string): boolean {
    const notif = this.notifications.get(id);
    if (notif && notif.userId === userId) {
      notif.read = true;
      return true;
    }
    return false;
  }

  // AUDIT LOGS
  public logAudit(userId: string | undefined, action: string, details: Record<string, unknown>, ip?: string): void {
    this.auditLogs.unshift({
      id: 'log_' + Math.random().toString(36).substring(2, 9),
      userId,
      action,
      details,
      ip,
      timestamp: new Date().toISOString(),
    });
    // Keep max 1000 logs in memory
    if (this.auditLogs.length > 1000) {
      this.auditLogs.pop();
    }
  }

  // REFRESH TOKENS (Session revocation & rotation)
  public saveRefreshToken(token: string, userId: string, expiresAt: number): void {
    this.refreshTokens.set(token, { token, userId, expiresAt });
  }

  public findRefreshToken(token: string): RefreshTokenEntry | null {
    const entry = this.refreshTokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.refreshTokens.delete(token);
      return null;
    }
    return entry;
  }

  public revokeRefreshToken(token: string): void {
    this.refreshTokens.delete(token);
  }

  public revokeAllUserRefreshTokens(userId: string): void {
    for (const [token, entry] of this.refreshTokens.entries()) {
      if (entry.userId === userId) {
        this.refreshTokens.delete(token);
      }
    }
  }
}

export const db = new DatabaseStore();
