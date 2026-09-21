import bcrypt from 'bcryptjs';
import { db } from '../db/store';
import { IUser, IDriver, IVehicle, IRide } from '../types';

export async function seedInitialData(): Promise<void> {
  // If already seeded, skip
  if (db.users.size > 0) return;

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
  db.createUser(admin);
  db.getOrCreateWallet(admin.id);

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
  db.createUser(rider);
  const riderWallet = db.getOrCreateWallet(rider.id);
  riderWallet.balance = 250; // 250 SAR initial balance

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
  db.createUser(driverUser);
  const driverWallet = db.getOrCreateWallet(driverUser.id);
  driverWallet.balance = 1420;

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
  db.createVehicle(driverVehicle);

  const primaryDriver: IDriver = {
    id: 'drv_faisal',
    userId: driverUser.id,
    approvalStatus: 'APPROVED',
    isOnline: true,
    currentLocation: {
      lat: 24.7136, // Riyadh Center / Olaya
      lng: 46.6753,
      heading: 45,
      updatedAt: new Date().toISOString(),
    },
    vehicle: driverVehicle,
    rating: 4.95,
    totalRides: 184,
    licenseNumber: 'LIC-892401',
    documents: {
      licensePhoto: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=300',
      vehicleRegistration: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=300',
    },
    earningsTotal: 4850,
  };
  db.createDriver(primaryDriver);

  // 4. Additional Fleet Drivers for Riyadh City
  const sampleDrivers = [
    {
      name: 'كابتن طارق الحربي',
      email: 'tariq@creemy.app',
      phone: '+966500000004',
      lat: 24.721,
      lng: 46.668,
      category: 'STANDARD' as const,
      make: 'Hyundai',
      model: 'Sonata',
      color: 'White',
      plate: 'أ ب ج 1122',
      rating: 4.88,
    },
    {
      name: 'كابتن ماجد الدوسري',
      email: 'majed@creemy.app',
      phone: '+966500000005',
      lat: 24.708,
      lng: 46.685,
      category: 'COMFORT' as const,
      make: 'Toyota',
      model: 'Camry Hybrid',
      color: 'Silver',
      plate: 'د هـ و 3344',
      rating: 4.92,
    },
    {
      name: 'كابتن عمر الشهري',
      email: 'omar@creemy.app',
      phone: '+966500000006',
      lat: 24.735,
      lng: 46.689,
      category: 'ECO' as const,
      make: 'Nissan',
      model: 'Sunny',
      color: 'Dark Grey',
      plate: 'س ع ص 5566',
      rating: 4.81,
    },
  ];

  sampleDrivers.forEach((d, idx) => {
    const uid = `usr_fleet_${idx + 1}`;
    const did = `drv_fleet_${idx + 1}`;
    const vid = `veh_fleet_${idx + 1}`;

    const u: IUser = {
      id: uid,
      name: d.name,
      email: d.email,
      phone: d.phone,
      passwordHash: defaultPasswordHash,
      role: 'DRIVER',
      status: 'ACTIVE',
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${uid}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.createUser(u);

    const v: IVehicle = {
      id: vid,
      driverId: did,
      make: d.make,
      model: d.model,
      year: 2023,
      color: d.color,
      plateNumber: d.plate,
      category: d.category,
    };
    db.createVehicle(v);

    const drv: IDriver = {
      id: did,
      userId: uid,
      approvalStatus: 'APPROVED',
      isOnline: true,
      currentLocation: {
        lat: d.lat,
        lng: d.lng,
        heading: Math.floor(Math.random() * 360),
        updatedAt: new Date().toISOString(),
      },
      vehicle: v,
      rating: d.rating,
      totalRides: 60 + idx * 25,
      licenseNumber: `LIC-77${idx}921`,
      documents: {},
      earningsTotal: 1200 + idx * 800,
    };
    db.createDriver(drv);
  });

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
  db.createRide(samplePastRide);

  db.logAudit(undefined, 'SYSTEM_BOOTSTRAP_SEEDED', {
    driversCount: db.drivers.size,
    usersCount: db.users.size,
  });

  console.log('[Seed] CreemY demo ecosystem initialized with Rider, Driver, and Admin.');
}
