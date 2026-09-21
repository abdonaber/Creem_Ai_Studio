import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { IUser, UserRole, IDriver, IVehicle } from '../types';

export class AuthService {
  private static readonly SALT_ROUNDS = 10;

  public static async register(data: {
    name: string;
    email: string;
    phone: string;
    password: string;
    role?: UserRole;
    vehicleDetails?: {
      make: string;
      model: string;
      year: number;
      color: string;
      plateNumber: string;
      category?: 'STANDARD' | 'COMFORT' | 'VIP' | 'ECO';
    };
    licenseNumber?: string;
  }): Promise<{ user: Omit<IUser, 'passwordHash'>; accessToken: string; refreshToken: string }> {
    const existingEmail = db.findUserByEmail(data.email);
    if (existingEmail) {
      throw new AppError('Email address already registered.', 409, 'EMAIL_EXISTS');
    }

    const existingPhone = db.findUserByPhone(data.phone);
    if (existingPhone) {
      throw new AppError('Phone number already registered.', 409, 'PHONE_EXISTS');
    }

    if (!data.password || data.password.length < 6) {
      throw new AppError('Password must be at least 6 characters long.', 400, 'WEAK_PASSWORD');
    }

    const passwordHash = await bcrypt.hash(data.password, this.SALT_ROUNDS);
    const userId = 'usr_' + Math.random().toString(36).substring(2, 9);
    const role: UserRole = data.role || 'RIDER';

    const user: IUser = {
      id: userId,
      name: data.name.trim(),
      email: data.email.toLowerCase().trim(),
      phone: data.phone.trim(),
      passwordHash,
      role,
      status: 'ACTIVE',
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${userId}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.createUser(user);
    db.getOrCreateWallet(userId); // Init wallet

    // If driver, initialize driver profile and vehicle
    if (role === 'DRIVER') {
      const driverId = 'drv_' + Math.random().toString(36).substring(2, 9);
      const vehicleId = 'veh_' + Math.random().toString(36).substring(2, 9);

      const vehicle: IVehicle = {
        id: vehicleId,
        driverId,
        make: data.vehicleDetails?.make || 'Toyota',
        model: data.vehicleDetails?.model || 'Camry',
        year: data.vehicleDetails?.year || 2024,
        color: data.vehicleDetails?.color || 'White',
        plateNumber: data.vehicleDetails?.plateNumber || `CRM-${Math.floor(1000 + Math.random() * 9000)}`,
        category: data.vehicleDetails?.category || 'STANDARD',
      };
      db.createVehicle(vehicle);

      const driver: IDriver = {
        id: driverId,
        userId,
        approvalStatus: 'APPROVED', // Auto-approved in demo/dev for immediate testing
        isOnline: true,
        currentLocation: {
          lat: 24.7136 + (Math.random() - 0.5) * 0.04,
          lng: 46.6753 + (Math.random() - 0.5) * 0.04,
          heading: Math.floor(Math.random() * 360),
          updatedAt: new Date().toISOString(),
        },
        vehicle,
        rating: 5.0,
        totalRides: 0,
        licenseNumber: data.licenseNumber || `LIC-${Math.floor(100000 + Math.random() * 900000)}`,
        documents: {
          licensePhoto: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=300',
          vehicleRegistration: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=300',
        },
        earningsTotal: 0,
      };
      db.createDriver(driver);
    }

    db.logAudit(userId, 'USER_REGISTERED', { email: user.email, role });

    const tokens = this.generateTokens(user);
    const { passwordHash: _, ...safeUser } = user;
    return { user: safeUser, ...tokens };
  }

  public static async login(credentials: {
    email: string;
    password: string;
  }): Promise<{ user: Omit<IUser, 'passwordHash'>; accessToken: string; refreshToken: string }> {
    const user = db.findUserByEmail(credentials.email);
    if (!user) {
      throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    }

    const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
    if (!isValid) {
      throw new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
    }

    if (user.status === 'SUSPENDED') {
      throw new AppError('Your account has been suspended.', 403, 'ACCOUNT_SUSPENDED');
    }

    const tokens = this.generateTokens(user);
    db.logAudit(user.id, 'USER_LOGIN', { email: user.email });

    const { passwordHash: _, ...safeUser } = user;
    return { user: safeUser, ...tokens };
  }

  public static rotateRefreshToken(oldRefreshToken: string): { accessToken: string; refreshToken: string } {
    try {
      const decoded = jwt.verify(oldRefreshToken, config.jwtRefreshSecret) as { userId: string };
      const savedToken = db.findRefreshToken(oldRefreshToken);

      if (!savedToken || savedToken.userId !== decoded.userId) {
        // Potential token reuse / theft! Revoke all tokens for this user
        db.revokeAllUserRefreshTokens(decoded.userId);
        throw new AppError('Session invalidated due to suspicious activity. Please sign in again.', 401, 'TOKEN_REUSED');
      }

      // Invalidate old token
      db.revokeRefreshToken(oldRefreshToken);

      const user = db.findUserById(decoded.userId);
      if (!user) {
        throw new AppError('User not found.', 401, 'USER_NOT_FOUND');
      }

      return this.generateTokens(user);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Invalid or expired refresh token.', 401, 'INVALID_REFRESH_TOKEN');
    }
  }

  public static logout(refreshToken?: string, userId?: string): void {
    if (refreshToken) {
      db.revokeRefreshToken(refreshToken);
    }
    if (userId) {
      db.logAudit(userId, 'USER_LOGOUT', {});
    }
  }

  private static generateTokens(user: IUser): { accessToken: string; refreshToken: string } {
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id, jti: Math.random().toString(36).substring(2) + Date.now().toString(36) },
      config.jwtRefreshSecret,
      { expiresIn: '7d' }
    );

    // Save refresh token with 7 days expiration in ms
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    db.saveRefreshToken(refreshToken, user.id, expiresAt);

    return { accessToken, refreshToken };
  }
}
