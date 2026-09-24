import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { generateId } from '../utils/id';
import { LocationService } from '../services/locationService';

export const driverRouter = Router();

driverRouter.use(authenticate);
driverRouter.use(requireRole('DRIVER', 'ADMIN'));

// Driver Profile & Vehicle
driverRouter.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const driver = await db.findDriverByUserId(req.user!.userId);
    if (!driver) throw new AppError('Driver profile not found', 404, 'NOT_FOUND');

    const user = await db.findUserById(driver.userId);
    const vehicle = await db.findVehicleByDriverId(driver.id);
    res.json({
      success: true,
      data: {
        ...driver,
        userName: user?.name,
        userAvatar: user?.avatarUrl,
        vehicle,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Toggle Online/Offline
driverRouter.put('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const driver = await db.findDriverByUserId(req.user!.userId);
    if (!driver) throw new AppError('Driver profile not found', 404, 'NOT_FOUND');

    if (driver.approvalStatus !== 'APPROVED') {
      throw new AppError('Driver account must be approved before going online', 403, 'NOT_APPROVED');
    }

    const { isOnline } = req.body;

    // Check outstanding commission debt threshold
    if (isOnline && (driver.outstandingDebt || 0) > 200) {
      throw new AppError(
        `Cannot go online: Outstanding platform commission debt (${driver.outstandingDebt?.toFixed(
          2
        )} SAR) exceeds maximum threshold (200 SAR). Please top up your wallet to settle.`,
        403,
        'DEBT_THRESHOLD_EXCEEDED'
      );
    }

    const updated = await db.updateDriver(driver.id, { isOnline: Boolean(isOnline) });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// Driver Location Update (Validated GPS with coordinate bounds, anti-spoofing & throttling)
driverRouter.put('/location', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const driver = await db.findDriverByUserId(req.user!.userId);
    if (!driver) throw new AppError('Driver profile not found', 404, 'NOT_FOUND');

    const { lat, lng, heading, timestamp } = req.body;

    const result = await LocationService.processDriverLocationUpdate({
      driverId: driver.id,
      userId: req.user!.userId,
      lat,
      lng,
      heading,
      timestamp,
    });

    if (!result.accepted) {
      if (result.reason === 'RATE_LIMIT_EXCEEDED') {
        throw new AppError('Location updates throttled. Maximum 1 update per second.', 429, 'RATE_LIMIT');
      }
      if (result.reason === 'UNREALISTIC_MOVEMENT_SPOOFING') {
        throw new AppError('Unrealistic GPS movement detected.', 400, 'GPS_ANOMALY_REJECTED');
      }
      if (result.reason === 'FUTURE_TIMESTAMP_REJECTED') {
        throw new AppError('Telemetry packet timestamp is in the future.', 400, 'FUTURE_TIMESTAMP_REJECTED');
      }
      if (result.reason === 'STALE_LOCATION_REJECTED') {
        throw new AppError('Telemetry packet timestamp is too old / stale.', 400, 'STALE_LOCATION_REJECTED');
      }
      if (result.reason === 'OUT_OF_ORDER_PACKET') {
        throw new AppError('Telemetry packet received out of order.', 400, 'OUT_OF_ORDER_PACKET');
      }
      if (result.reason === 'INVALID_HEADING_BOUNDS') {
        throw new AppError('Heading must be between 0 and 360 degrees.', 400, 'INVALID_HEADING');
      }
      throw new AppError('Invalid geographic coordinates (-90<=lat<=90, -180<=lng<=180)', 400, 'INVALID_COORDINATES');
    }

    res.json({ success: true, message: 'Location ingested' });
  } catch (err) {
    next(err);
  }
});

// Driver Ride History
driverRouter.get('/rides', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const driver = await db.findDriverByUserId(req.user!.userId);
    if (!driver) throw new AppError('Driver profile not found', 404, 'NOT_FOUND');

    const rides = await db.getRidesByDriverId(driver.id);
    res.json({ success: true, data: rides });
  } catch (err) {
    next(err);
  }
});

// Update vehicle or documents (Onboarding)
driverRouter.put('/onboarding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const driver = await db.findDriverByUserId(req.user!.userId);
    if (!driver) throw new AppError('Driver not found', 404, 'NOT_FOUND');

    const { vehicle, documents, licenseNumber } = req.body;

    if (vehicle) {
      if (
        !vehicle.make ||
        !vehicle.model ||
        !vehicle.year ||
        !vehicle.color ||
        !vehicle.plateNumber
      ) {
        throw new AppError(
          'Complete vehicle specifications (make, model, year, color, plateNumber) are required',
          400,
          'INVALID_VEHICLE_DATA'
        );
      }

      const existingVehicle = await db.findVehicleByDriverId(driver.id);
      if (existingVehicle) {
        await db.updateVehicle(existingVehicle.id, {
          make: vehicle.make.trim(),
          model: vehicle.model.trim(),
          year: Number(vehicle.year),
          color: vehicle.color.trim(),
          plateNumber: vehicle.plateNumber.trim(),
          category: vehicle.category || 'STANDARD',
        });
      } else {
        await db.createVehicle({
          id: generateId('veh'),
          driverId: driver.id,
          make: vehicle.make.trim(),
          model: vehicle.model.trim(),
          year: Number(vehicle.year),
          color: vehicle.color.trim(),
          plateNumber: vehicle.plateNumber.trim(),
          category: vehicle.category || 'STANDARD',
        });
      }
    }

    const updated = await db.updateDriver(driver.id, {
      ...(documents ? { documents: { ...driver.documents, ...documents } } : {}),
      ...(licenseNumber ? { licenseNumber: licenseNumber.trim() } : {}),
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});
