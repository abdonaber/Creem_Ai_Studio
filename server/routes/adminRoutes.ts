import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { io } from '../socket/socketHandler';
import { generateId } from '../utils/id';

export const adminRouter = Router();

adminRouter.use(authenticate);
adminRouter.use(requireRole('ADMIN'));

// System stats & Analytics
adminRouter.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await db.getPlatformStats();
    const financial = await db.getFinancialSummary();

    res.json({
      success: true,
      data: {
        totalRevenue: financial.totalGrossVolume,
        platformRevenue: financial.totalPlatformRevenue,
        driverPayouts: financial.totalDriverPayouts,
        outstandingDebt: financial.totalOutstandingDebt,
        transactionCount: financial.transactionCount,
        activeRidesCount: stats.activeRides || 0,
        completedRidesCount: stats.completedRides || 0,
        cancelledRidesCount: stats.cancelledRides || 0,
        totalDriversCount: stats.totalDrivers || 0,
        onlineDriversCount: stats.onlineDrivers || 0,
        pendingApprovalsCount: stats.pendingApprovals || 0,
        totalUsersCount: stats.totalUsers || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// All Rides (Paginated & Filterable)
adminRouter.get('/rides', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const status = req.query.status as string;
    const riderId = req.query.riderId as string;
    const driverId = req.query.driverId as string;
    const search = req.query.search as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const result = await db.getRidesPaginated({
      page,
      limit,
      status,
      riderId,
      driverId,
      search,
      startDate,
      endDate,
    });

    res.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
        limit,
      },
    });
  } catch (err) {
    next(err);
  }
});

// All Drivers (Paginated & Filterable)
adminRouter.get('/drivers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const approvalStatus = req.query.approvalStatus as string;
    const isOnline = req.query.isOnline !== undefined ? req.query.isOnline === 'true' : undefined;
    const search = req.query.search as string;

    const result = await db.getDriversPaginated({
      page,
      limit,
      approvalStatus,
      isOnline,
      search,
    });

    const enrichedDrivers = await Promise.all(
      result.data.map(async (d) => {
        const user = await db.findUserById(d.userId);
        const vehicle = await db.findVehicleByDriverId(d.id);
        return {
          ...d,
          userName: user?.name,
          userEmail: user?.email,
          userPhone: user?.phone,
          vehicle,
        };
      })
    );

    res.json({
      success: true,
      data: enrichedDrivers,
      pagination: {
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
        limit,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Approve or Reject Driver
adminRouter.put(
  '/drivers/:id/approve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body;
      if (!['APPROVED', 'REJECTED', 'SUSPENDED', 'PENDING'].includes(status)) {
        throw new AppError('Invalid approval status', 400, 'INVALID_STATUS');
      }

      // Hard validation: Before approving a driver, ensure valid vehicle details exist
      if (status === 'APPROVED') {
        const vehicle = await db.findVehicleByDriverId(req.params.id);
        const driver = await db.findDriverById(req.params.id);
        const hasVehicle = vehicle || driver?.vehicle;
        if (!hasVehicle || !hasVehicle.make || !hasVehicle.model || !hasVehicle.plateNumber) {
          throw new AppError(
            'Cannot approve driver without complete vehicle registration (make, model, plate number)',
            400,
            'INCOMPLETE_VEHICLE_INFO'
          );
        }
      }

      const updated = await db.updateDriver(req.params.id, { approvalStatus: status });
      if (!updated) throw new AppError('Driver not found', 404, 'NOT_FOUND');

      await db.logAudit(req.user!.userId, 'DRIVER_APPROVAL_UPDATED', {
        driverId: req.params.id,
        status,
      });

      if (io) {
        io.to(`user:${updated.userId}`).emit('notification:new', {
          title: status === 'APPROVED' ? 'تمت الموافقة على حسابك! 🎉' : 'تحديث حالة الحساب',
          body:
            status === 'APPROVED'
              ? 'تهانينا! يمكنك الآن استقبال طلبات الرحلات والبدء في تحقيق الأرباح.'
              : `حالة حسابك الآن: ${status}`,
          type: 'SYSTEM',
        });
      }

      await db.createNotification({
        id: generateId('notif'),
        userId: updated.userId,
        title: status === 'APPROVED' ? 'تمت الموافقة على حسابك! 🎉' : 'تحديث حالة الحساب',
        body:
          status === 'APPROVED'
            ? 'تهانينا! يمكنك الآن استقبال طلبات الرحلات والبدء في تحقيق الأرباح.'
            : `حالة حسابك الآن: ${status}`,
        type: 'SYSTEM',
        read: false,
        createdAt: new Date().toISOString(),
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// User Management: List (Paginated & Filterable)
adminRouter.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const role = req.query.role as string;
    const search = req.query.search as string;

    const result = await db.getUsersPaginated({
      page,
      limit,
      role,
      search,
    });

    res.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
        limit,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Platform Financial Ledger
adminRouter.get('/ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const rideId = req.query.rideId as string;
    const type = req.query.type as any;
    const status = req.query.status as any;

    const ledgerEntries = await db.getPlatformLedger(limit, {
      rideId,
      type,
      status,
    });

    res.json({ success: true, data: ledgerEntries });
  } catch (err) {
    next(err);
  }
});

// User Management: Change Status (Suspend / Activate)
adminRouter.put(
  '/users/:id/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body;
      if (!['ACTIVE', 'SUSPENDED', 'PENDING'].includes(status)) {
        throw new AppError('Invalid status', 400, 'INVALID_STATUS');
      }

      const updated = await db.updateUser(req.params.id, { status });
      if (!updated) throw new AppError('User not found', 404, 'NOT_FOUND');

      await db.logAudit(req.user!.userId, 'USER_STATUS_UPDATED', {
        targetUserId: req.params.id,
        status,
      });
      const { passwordHash: _, ...safe } = updated;

      res.json({ success: true, data: safe });
    } catch (err) {
      next(err);
    }
  }
);

// Audit Logs
adminRouter.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const logs = await db.getAuditLogs(limit);
    res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
});
