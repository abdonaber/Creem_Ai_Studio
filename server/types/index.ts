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

export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
export type PaymentMethod = 'WALLET' | 'CASH' | 'CREDIT_CARD';

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
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
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
  isBusy?: boolean;
  activeRideId?: string;
  currentLocation?: {
    lat: number;
    lng: number;
    heading?: number;
    updatedAt: string;
  };
  vehicle?: IVehicle;
  rating: number;
  totalRides: number;
  licenseNumber: string;
  documents: {
    licensePhoto?: string;
    vehicleRegistration?: string;
    idCardPhoto?: string;
  };
  earningsTotal: number;
  outstandingDebt?: number;
}

export interface IRideOffer {
  id: string;
  rideId: string;
  driverId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  expiresAt: string;
  distanceKm: number;
  estimatedFare: number;
  createdAt: string;
  updatedAt?: string;
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
  paymentIntentId?: string;
  cancellationReason?: string;
  cancelledBy?: 'RIDER' | 'DRIVER' | 'SYSTEM' | 'ADMIN';
  stateHistory?: Array<{
    status: RideStatus;
    timestamp: string;
    byUserId?: string;
    reason?: string;
  }>;
  offeredDriverIds?: string[];
  currentOffer?: {
    driverId: string;
    offerId: string;
    expiresAt: string;
  };
  searchRadiusKm?: number;
  retryCount?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IWallet {
  id: string;
  userId: string;
  balance: number;
  currency: string;
  createdAt?: string;
  updatedAt: string;
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

export interface IRating {
  id: string;
  rideId: string;
  fromUserId: string;
  toUserId: string;
  stars: number;
  comment?: string;
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
  metadata?: Record<string, unknown>;
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

export interface IPayment {
  id: string;
  rideId: string;
  userId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: PaymentMethod;
  stripePaymentIntentId?: string;
  stripeClientSecret?: string;
  idempotencyKey?: string;
  refundAmount?: number;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface IPlatformLedger {
  id: string;
  rideId: string;
  type:
    | 'RIDER_FARE'
    | 'DRIVER_EARNING'
    | 'PLATFORM_COMMISSION'
    | 'COMMISSION_DEBT'
    | 'DEBT_RECOVERY'
    | 'REFUND';
  amount: number;
  currency: string;
  fromAccount: string;
  toAccount: string;
  status: 'COMMITTED' | 'OUTSTANDING' | 'SETTLED';
  idempotencyKey?: string;
  createdAt: string;
}

