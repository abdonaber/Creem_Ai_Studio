import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';

export const driverRouter = Router();

driverRouter.use(authenticate);
driverRouter.use(requireRole('DRIVER', 'ADMIN'));

// Driver Profile & Vehicle
driverRouter.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const driver = await db.findDriverByUserId(req.user!.userId);
    if (!driver) throw new AppError('Driver profile not found', 404, 'NOT_FOUND');

    const vehicle = await db.findVehicleByDriverId(driver.id);
    res.json({
      success: true,
      data: {
        ...driver,
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
    const updated = await db.updateDriver(driver.id, { isOnline: Boolean(isOnline) });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// Driver Location Update (Validated GPS with coordinate bounds)
driverRouter.put('/location', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const driver = await db.findDriverByUserId(req.user!.userId);
    if (!driver) throw new AppError('Driver profile not found', 404, 'NOT_FOUND');

    const { lat, lng, heading } = req.body;
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new AppError('Valid geographic coordinates required (-90<=lat<=90, -180<=lng<=180)', 400, 'INVALID_INPUT');
    }

    const updatedLoc = {
      lat,
      lng,
      heading: typeof heading === 'number' ? heading : 0,
      updatedAt: new Date().toISOString(),
    };

    const updated = await db.updateDriver(driver.id, { currentLocation: updatedLoc });
    res.json({ success: true, data: updated });
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
      let v = await db.findVehicleByDriverId(driver.id);
      if (v) {
        await db.updateVehicle(v.id, vehicle);
      } else {
        await db.createVehicle({
          id: 'veh_' + Math.random().toString(36).substring(2, 9),
          driverId: driver.id,
          make: vehicle.make || 'Toyota',
          model: vehicle.model || 'Camry',
          year: vehicle.year || 2024,
          color: vehicle.color || 'White',
          plateNumber: vehicle.plateNumber || 'CRM-9999',
          category: vehicle.category || 'STANDARD',
        });
      }
    }

    const updated = await db.updateDriver(driver.id, {
      ...(documents ? { documents: { ...driver.documents, ...documents } } : {}),
      ...(licenseNumber ? { licenseNumber } : {}),
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});
