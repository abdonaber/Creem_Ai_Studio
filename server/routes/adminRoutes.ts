import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { io } from '../socket/socketHandler';

export const adminRouter = Router();

adminRouter.use(authenticate);
adminRouter.use(requireRole('ADMIN'));

// System stats & Analytics
adminRouter.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allRides = await db.getAllRides();
    const allDrivers = await db.getAllDrivers();
    const allUsers = await db.getAllUsers();

    const completedRides = allRides.filter((r) => r.status === 'RIDE_COMPLETED');
    const activeRides = allRides.filter((r) =>
      [
        'REQUESTED',
        'SEARCHING_DRIVER',
        'DRIVER_ASSIGNED',
        'DRIVER_ARRIVING',
        'DRIVER_ARRIVED',
        'RIDE_STARTED',
      ].includes(r.status)
    );
    const cancelledRides = allRides.filter((r) => r.status === 'CANCELLED');

    const totalRevenue = completedRides.reduce(
      (acc, curr) => acc + (curr.finalFare || curr.estimatedFare || 0),
      0
    );
    const platformRevenue = Math.round(totalRevenue * 0.2 * 100) / 100; // 20% platform share

    const onlineDrivers = allDrivers.filter((d) => d.isOnline);
    const pendingApprovals = allDrivers.filter((d) => d.approvalStatus === 'PENDING');

    res.json({
      success: true,
      data: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        platformRevenue,
        activeRidesCount: activeRides.length,
        completedRidesCount: completedRides.length,
        cancelledRidesCount: cancelledRides.length,
        totalDriversCount: allDrivers.length,
        onlineDriversCount: onlineDrivers.length,
        pendingApprovalsCount: pendingApprovals.length,
        totalUsersCount: allUsers.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// All Rides
adminRouter.get('/rides', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rides = await db.getAllRides();
    res.json({ success: true, data: rides });
  } catch (err) {
    next(err);
  }
});

// All Drivers
adminRouter.get('/drivers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const drivers = await db.getAllDrivers();
    const enrichedDrivers = await Promise.all(
      drivers.map(async (d) => {
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
    res.json({ success: true, data: enrichedDrivers });
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
      if (!['APPROVED', 'REJECTED', 'SUSPENDED'].includes(status)) {
        throw new AppError('Invalid approval status', 400, 'INVALID_STATUS');
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
        id: 'notif_' + Math.random().toString(36).substring(2, 9),
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

// User Management: List
adminRouter.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const all = await db.getAllUsers();
    const safeUsers = all.map(({ passwordHash: _, ...u }) => u);
    res.json({ success: true, data: safeUsers });
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
