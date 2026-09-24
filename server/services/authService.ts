import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { IUser, UserRole, IDriver, IVehicle, DriverApprovalStatus } from '../types';
import { generateId } from '../utils/id';

export class AuthService {
  private static readonly SALT_ROUNDS = 10;

  public static async register(
    data: {
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
    },
    clientInfo?: { ip?: string; userAgent?: string }
  ): Promise<{ user: Omit<IUser, 'passwordHash'>; accessToken: string; refreshToken: string }> {
    const existingEmail = await db.findUserByEmail(data.email);
    if (existingEmail) {
      throw new AppError('Email address already registered.', 409, 'EMAIL_EXISTS');
    }

    const existingPhone = await db.findUserByPhone(data.phone);
    if (existingPhone) {
      throw new AppError('Phone number already registered.', 409, 'PHONE_EXISTS');
    }

    // Strong password policy
    if (!data.password || data.password.length < 8) {
      throw new AppError('Password must be at least 8 characters long.', 400, 'WEAK_PASSWORD');
    }

    // Phase 12 Security Hardening: Prevent public admin registration
    if (data.role === 'ADMIN') {
      throw new AppError('Public registration for the administrator role is strictly forbidden.', 403, 'FORBIDDEN_ROLE');
    }

    const passwordHash = await bcrypt.hash(data.password, this.SALT_ROUNDS);
    const userId = generateId('usr');
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

    await db.createUser(user);
    await db.getOrCreateWallet(userId); // Init wallet

    // If driver, initialize real driver profile
    if (role === 'DRIVER') {
      const driverId = generateId('drv');
      let vehicle: IVehicle | undefined = undefined;

      // If vehicle details are supplied during registration, persist them directly
      if (
        data.vehicleDetails?.make &&
        data.vehicleDetails?.model &&
        data.vehicleDetails?.year &&
        data.vehicleDetails?.color &&
        data.vehicleDetails?.plateNumber
      ) {
        const vehicleId = generateId('veh');
        vehicle = {
          id: vehicleId,
          driverId,
          make: data.vehicleDetails.make.trim(),
          model: data.vehicleDetails.model.trim(),
          year: Number(data.vehicleDetails.year),
          color: data.vehicleDetails.color.trim(),
          plateNumber: data.vehicleDetails.plateNumber.trim(),
          category: data.vehicleDetails.category || 'STANDARD',
        };
        await db.createVehicle(vehicle);
      }

      // In production and real operation, newly registered drivers require admin verification
      const approvalStatus: DriverApprovalStatus = 'PENDING';

      const driver: IDriver = {
        id: driverId,
        userId,
        approvalStatus,
        isOnline: false, // Never online until admin approval and driver toggle
        vehicle,
        rating: 5.0,
        totalRides: 0,
        licenseNumber: data.licenseNumber?.trim() || '',
        documents: {},
        earningsTotal: 0,
        outstandingDebt: 0,
      };
      await db.createDriver(driver);
    }

    await db.createAuditLog({
      id: generateId('aud'),
      userId,
      action: 'USER_REGISTERED',
      details: { email: user.email, role },
      ip: clientInfo?.ip,
      timestamp: new Date().toISOString(),
    });

    const tokens = await this.generateTokens(user, clientInfo);
    const { passwordHash: _, ...safeUser } = user;
    return { user: safeUser, ...tokens };
  }

  public static async login(
    credentials: {
      email: string;
      password: string;
    },
    clientInfo?: { ip?: string; userAgent?: string }
  ): Promise<{ user: Omit<IUser, 'passwordHash'>; accessToken: string; refreshToken: string }> {
    const user = await db.findUserByEmail(credentials.email);
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

    const tokens = await this.generateTokens(user, clientInfo);

    await db.createAuditLog({
      id: generateId('aud'),
      userId: user.id,
      action: 'USER_LOGIN',
      details: { email: user.email },
      ip: clientInfo?.ip,
      timestamp: new Date().toISOString(),
    });

    const { passwordHash: _, ...safeUser } = user;
    return { user: safeUser, ...tokens };
  }

  public static async rotateRefreshToken(
    oldRefreshToken: string,
    clientInfo?: { ip?: string; userAgent?: string }
  ): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const decoded = jwt.verify(oldRefreshToken, config.jwtRefreshSecret) as {
        userId: string;
        jti: string;
      };

      if (!decoded.jti || !decoded.userId) {
        throw new AppError('Malformed refresh token.', 401, 'INVALID_REFRESH_TOKEN');
      }

      const session = await db.findRefreshSessionByJti(decoded.jti);

      if (!session || session.revoked) {
        // TOKEN REUSE ATTACK DETECTED!
        // Immediately revoke all sessions for this user across all devices
        await db.revokeAllSessionsForUser(decoded.userId, 'REPLAY_ATTACK_DETECTED');
        await db.createAuditLog({
          id: generateId('aud'),
          userId: decoded.userId,
          action: 'SECURITY_ALERT_TOKEN_REPLAY',
          details: { jti: decoded.jti, reason: 'Attempted reuse of rotated/revoked token' },
          ip: clientInfo?.ip,
          timestamp: new Date().toISOString(),
        });

        throw new AppError(
          'Security alert: Session invalidated due to suspicious activity. Please sign in again.',
          401,
          'TOKEN_REUSED'
        );
      }

      // Invalidate the consumed refresh token session
      await db.revokeRefreshSession(decoded.jti, 'ROTATED');

      const user = await db.findUserById(decoded.userId);
      if (!user) {
        throw new AppError('User not found.', 401, 'USER_NOT_FOUND');
      }

      if (user.status === 'SUSPENDED') {
        throw new AppError('Account is suspended.', 403, 'ACCOUNT_SUSPENDED');
      }

      return await this.generateTokens(user, clientInfo);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Invalid or expired refresh token.', 401, 'INVALID_REFRESH_TOKEN');
    }
  }

  public static async logout(refreshToken?: string, userId?: string): Promise<void> {
    if (refreshToken) {
      try {
        const decoded = jwt.decode(refreshToken) as { jti?: string } | null;
        if (decoded?.jti) {
          await db.revokeRefreshSession(decoded.jti, 'USER_LOGOUT');
        }
      } catch {
        // ignore
      }
    }
    if (userId) {
      await db.createAuditLog({
        id: generateId('aud'),
        userId,
        action: 'USER_LOGOUT',
        details: {},
        timestamp: new Date().toISOString(),
      });
    }
  }

  public static async logoutAll(userId: string): Promise<void> {
    await db.revokeAllSessionsForUser(userId, 'USER_LOGOUT_ALL');
    await db.createAuditLog({
      id: generateId('aud'),
      userId,
      action: 'USER_LOGOUT_ALL_SESSIONS',
      details: {},
      timestamp: new Date().toISOString(),
    });
  }

  private static async generateTokens(
    user: IUser,
    clientInfo?: { ip?: string; userAgent?: string }
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: '15m' }
    );

    const jti = crypto.randomBytes(16).toString('hex');
    const refreshToken = jwt.sign(
      { userId: user.id, jti },
      config.jwtRefreshSecret,
      { expiresIn: '7d' }
    );

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.createRefreshSession({
      userId: user.id,
      jti,
      tokenHash,
      expiresAt,
      ip: clientInfo?.ip,
      userAgent: clientInfo?.userAgent,
    });

    return { accessToken, refreshToken };
  }
}
