import bcrypt from 'bcryptjs';
import { db } from '../db/store';
import { IUser, IDriver, IVehicle, IRide } from '../types';

export async function seedInitialData(): Promise<void> {
  // If already seeded in DB or memory, skip
  const existingUsers = await db.getAllUsers();
  if (existingUsers.length > 0) return;

  const defaultPasswordHash = await bcrypt.hash('CreemY@2026', 10);

  // 1. Admin User
  const admin: IUser = {
    id: 'usr_admin',
    name: 'عبدالله المشرف (Admin)',
    email: 'admin@creemy.app',
    phone: '+966500000001',
    passwordHash: defaultPasswordHash,
    role: 'ADMIN',
    status: 'ACTIVE',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.createUser(admin);
  await db.getOrCreateWallet(admin.id);

  // 2. Rider User
  const rider: IUser = {
    id: 'usr_rider',
    name: 'سارة المنصور (Rider)',
    email: 'rider@creemy.app',
    phone: '+966500000002',
    passwordHash: defaultPasswordHash,
    role: 'RIDER',
    status: 'ACTIVE',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.createUser(rider);
  await db.creditWallet(rider.id, 250, 'Initial Welcome Balance');

  // 3. Driver User (Primary)
  const driverUser: IUser = {
    id: 'usr_driver',
    name: 'كابتن فيصل العتيبي (Driver)',
    email: 'driver@creemy.app',
    phone: '+966500000003',
    passwordHash: defaultPasswordHash,
    role: 'DRIVER',
    status: 'ACTIVE',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.createUser(driverUser);
  await db.creditWallet(driverUser.id, 1420, 'Initial Driver Earnings Balance');

  const driverVehicle: IVehicle = {
    id: 'veh_driver',
    driverId: 'drv_faisal',
    make: 'Lexus',
    model: 'ES 350',
    year: 2024,
    color: 'Titanium Pearl',
    plateNumber: 'ك ر م 2026',
    category: 'VIP',
  };
  await db.createVehicle(driverVehicle);

  const primaryDriver: IDriver = {
    id: 'drv_faisal',
    userId: driverUser.id,
    approvalStatus: 'APPROVED',
    isOnline: true,
    currentLocation: {
      lat: 24.7136,
      lng: 46.6753,
      heading: 45,
      updatedAt: new Date().toISOString(),
    },
    rating: 4.9,
    totalRides: 142,
    licenseNumber: 'SA-DL-9823145',
    documents: {
      licensePhoto: 'https://creemy.app/docs/license_sample.pdf',
      idCardPhoto: 'https://creemy.app/docs/national_id_sample.pdf',
      vehicleRegistration: 'https://creemy.app/docs/insurance_sample.pdf',
    },
    vehicle: driverVehicle,
    earningsTotal: 4890,
  };
  await db.createDriver(primaryDriver);

  // 4. Secondary Online Drivers in Riyadh for realistic fleet coverage
  const secondaryDriversData = [
    {
      user: {
        id: 'usr_drv_2',
        name: 'كابتن طارق الدوسري',
        email: 'tariq.driver@creemy.app',
        phone: '+966500000004',
        role: 'DRIVER' as const,
        status: 'ACTIVE' as const,
        avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
      },
      driverId: 'drv_tariq',
      category: 'STANDARD' as const,
      make: 'Toyota',
      model: 'Camry Hybrid',
      year: 2023,
      plateNumber: 'ط ر ق 1122',
      color: 'White Pearl',
      lat: 24.7219,
      lng: 46.6621,
      rating: 4.8,
    },
    {
      user: {
        id: 'usr_drv_3',
        name: 'كابتن عمر الحربي',
        email: 'omar.driver@creemy.app',
        phone: '+966500000005',
        role: 'DRIVER' as const,
        status: 'ACTIVE' as const,
        avatarUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150',
      },
      driverId: 'drv_omar',
      category: 'COMFORT' as const,
      make: 'Hyundai',
      model: 'Azera',
      year: 2024,
      plateNumber: 'ع م ر 5566',
      color: 'Midnight Black',
      lat: 24.6985,
      lng: 46.6894,
      rating: 4.95,
    },
    {
      user: {
        id: 'usr_drv_4',
        name: 'كابتن ماجد الشمري',
        email: 'majed.driver@creemy.app',
        phone: '+966500000006',
        role: 'DRIVER' as const,
        status: 'ACTIVE' as const,
        avatarUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150',
      },
      driverId: 'drv_majed',
      category: 'ECO' as const,
      make: 'Toyota',
      model: 'Yaris',
      year: 2023,
      plateNumber: 'م ج د 7788',
      color: 'Silver',
      lat: 24.7315,
      lng: 46.6912,
      rating: 4.7,
    },
  ];

  for (const item of secondaryDriversData) {
    const u: IUser = {
      ...item.user,
      passwordHash: defaultPasswordHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.createUser(u);
    await db.getOrCreateWallet(u.id);

    const veh: IVehicle = {
      id: `veh_${item.driverId}`,
      driverId: item.driverId,
      make: item.make,
      model: item.model,
      year: item.year,
      color: item.color,
      plateNumber: item.plateNumber,
      category: item.category,
    };
    await db.createVehicle(veh);

    const drv: IDriver = {
      id: item.driverId,
      userId: u.id,
      approvalStatus: 'APPROVED',
      isOnline: true,
      currentLocation: {
        lat: item.lat,
        lng: item.lng,
        heading: 90,
        updatedAt: new Date().toISOString(),
      },
      rating: item.rating,
      totalRides: 89,
      licenseNumber: `SA-DL-${Math.floor(1000000 + Math.random() * 9000000)}`,
      documents: {
        licensePhoto: 'https://creemy.app/docs/license_sample.pdf',
        idCardPhoto: 'https://creemy.app/docs/national_id_sample.pdf',
      },
      vehicle: veh,
      earningsTotal: 2300,
    };
    await db.createDriver(drv);
  }

  // 5. Sample Past Rides for History
  const samplePastRide: IRide = {
    id: 'ride_demo_hist_1',
    riderId: rider.id,
    driverId: primaryDriver.id,
    status: 'RIDE_COMPLETED',
    vehicleCategory: 'VIP',
    pickup: {
      lat: 24.7112,
      lng: 46.6744,
      address: 'برج المملكة - طريق العروبة، العليا',
    },
    destination: {
      lat: 24.7743,
      lng: 46.6386,
      address: 'مركز الملك عبدالله المالي (KAFD)، الرياض',
    },
    estimatedFare: 48.5,
    finalFare: 48.5,
    distanceKm: 8.4,
    durationMinutes: 16,
    paymentMethod: 'WALLET',
    paymentStatus: 'SUCCEEDED',
    startedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    completedAt: new Date(Date.now() - 3600000 * 3.7).toISOString(),
    createdAt: new Date(Date.now() - 3600000 * 4.2).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 3.7).toISOString(),
  };
  await db.createRide(samplePastRide);

  const allDrivers = await db.getAllDrivers();
  const allUsers = await db.getAllUsers();
  await db.logAudit(undefined, 'SYSTEM_BOOTSTRAP_SEEDED', {
    driversCount: allDrivers.length,
    usersCount: allUsers.length,
  });

  console.log('[Seed] CreemY demo ecosystem initialized with Rider, Driver, and Admin.');
}
