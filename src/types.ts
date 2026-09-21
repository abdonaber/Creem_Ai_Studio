export type UserRole = 'RIDER' | 'DRIVER' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING';
export type DriverApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type VehicleCategory = 'STANDARD' | 'COMFORT' | 'VIP' | 'ECO';

export type RideStatus =
  | 'REQUESTED'
  | 'SEARCHING_DRIVER'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVING'
  | 'DRIVER_ARRIVED'
  | 'RIDE_STARTED'
  | 'RIDE_COMPLETED'
  | 'CANCELLED'
  | 'NO_DRIVER_FOUND';

export type PaymentMethod = 'WALLET' | 'CASH' | 'CREDIT_CARD';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';

export interface LocationCoordinate {
  lat: number;
  lng: number;
  address: string;
}

export interface IUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  avatarUrl?: string;
  createdAt: string;
}

export interface IVehicle {
  id: string;
  driverId: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plateNumber: string;
  category: VehicleCategory;
}

export interface IDriver {
  id: string;
  userId: string;
  approvalStatus: DriverApprovalStatus;
  isOnline: boolean;
  currentLocation: {
    lat: number;
    lng: number;
    heading?: number;
    updatedAt: string;
  };
  vehicle?: IVehicle;
  rating: number;
  totalRides: number;
  licenseNumber: string;
  earningsTotal: number;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
}

export interface IRide {
  id: string;
  riderId: string;
  driverId?: string;
  status: RideStatus;
  vehicleCategory: VehicleCategory;
  pickup: LocationCoordinate;
  destination: LocationCoordinate;
  currentDriverLocation?: { lat: number; lng: number };
  estimatedFare: number;
  finalFare?: number;
  tip?: number;
  distanceKm: number;
  durationMinutes: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  cancellationReason?: string;
  cancelledBy?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  driver?: {
    id: string;
    name?: string;
    phone?: string;
    avatarUrl?: string;
    rating: number;
    vehicle?: IVehicle;
    currentLocation?: { lat: number; lng: number };
  } | null;
  rider?: {
    id: string;
    name: string;
    phone: string;
    avatarUrl?: string;
  } | null;
}

export interface IWallet {
  id: string;
  userId: string;
  balance: number;
  currency: string;
}

export interface IWalletTransaction {
  id: string;
  walletId: string;
  userId: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  balanceAfter: number;
  reason: string;
  referenceId?: string;
  createdAt: string;
}

export interface IMessage {
  id: string;
  rideId: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  content: string;
  createdAt: string;
  read: boolean;
}

export interface INotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: 'RIDE_UPDATE' | 'PAYMENT' | 'PROMO' | 'SYSTEM';
  read: boolean;
  createdAt: string;
}

export interface IAuditLog {
  id: string;
  userId?: string;
  action: string;
  details: Record<string, unknown>;
  ip?: string;
  timestamp: string;
}
