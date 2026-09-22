import mongoose, { Schema, Document } from 'mongoose';

// 1. User Schema
export interface IUserDocument extends Document {
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: 'RIDER' | 'DRIVER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = new Schema<IUserDocument>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['RIDER', 'DRIVER', 'ADMIN'], default: 'RIDER' },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED', 'PENDING'], default: 'ACTIVE' },
    avatarUrl: { type: String },
  },
  { timestamps: true }
);

UserSchema.index({ email: 1 });
UserSchema.index({ phone: 1 });
UserSchema.index({ role: 1 });

// 2. Driver Schema
export interface IDriverDocument extends Document {
  userId: string;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  isOnline: boolean;
  currentLocation: {
    lat: number;
    lng: number;
    heading?: number;
    updatedAt: Date;
  };
  location?: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  rating: number;
  totalRides: number;
  licenseNumber: string;
  isBusy?: boolean;
  activeRideId?: string;
  documents: {
    licensePhoto?: string;
    vehicleRegistration?: string;
    idCardPhoto?: string;
  };
  earningsTotal: number;
  createdAt: Date;
  updatedAt: Date;
}

export const DriverSchema = new Schema<IDriverDocument>(
  {
    userId: { type: String, required: true, unique: true },
    approvalStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'],
      default: 'PENDING',
    },
    isOnline: { type: Boolean, default: false },
    isBusy: { type: Boolean, default: false, index: true },
    activeRideId: { type: String, default: null },
    currentLocation: {
      lat: { type: Number, default: 24.7136 },
      lng: { type: Number, default: 46.6753 },
      heading: { type: Number, default: 0 },
      updatedAt: { type: Date, default: Date.now },
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [lng, lat]
        default: [46.6753, 24.7136],
      },
    },
    rating: { type: Number, default: 5.0 },
    totalRides: { type: Number, default: 0 },
    licenseNumber: { type: String, required: true },
    documents: {
      licensePhoto: String,
      vehicleRegistration: String,
      idCardPhoto: String,
    },
    earningsTotal: { type: Number, default: 0 },
  },
  { timestamps: true }
);

DriverSchema.index({ isOnline: 1, approvalStatus: 1, isBusy: 1 });
DriverSchema.index({ location: '2dsphere' });
DriverSchema.index({ 'currentLocation.lat': 1, 'currentLocation.lng': 1 });

// 3. Vehicle Schema
export interface IVehicleDocument extends Omit<Document, 'model'> {
  driverId: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plateNumber: string;
  category: 'STANDARD' | 'COMFORT' | 'VIP' | 'ECO';
  createdAt: Date;
  updatedAt: Date;
}

export const VehicleSchema = new Schema<IVehicleDocument>(
  {
    driverId: { type: String, required: true, unique: true },
    make: { type: String, required: true },
    model: { type: String, required: true },
    year: { type: Number, required: true },
    color: { type: String, required: true },
    plateNumber: { type: String, required: true, unique: true },
    category: {
      type: String,
      enum: ['STANDARD', 'COMFORT', 'VIP', 'ECO'],
      default: 'STANDARD',
    },
  },
  { timestamps: true }
);

VehicleSchema.index({ driverId: 1 });
VehicleSchema.index({ category: 1 });

// 4. Ride Schema
export interface IRideDocument extends Document {
  riderId: string;
  driverId?: string;
  status: string;
  vehicleCategory: string;
  pickup: { lat: number; lng: number; address: string };
  destination: { lat: number; lng: number; address: string };
  currentDriverLocation?: { lat: number; lng: number };
  estimatedFare: number;
  finalFare?: number;
  tip?: number;
  distanceKm: number;
  durationMinutes: number;
  paymentMethod: string;
  paymentStatus: string;
  cancellationReason?: string;
  cancelledBy?: string;
  stateHistory?: Array<{
    status: string;
    timestamp: Date;
    byUserId?: string;
    reason?: string;
  }>;
  offeredDriverIds?: string[];
  currentOffer?: {
    driverId: string;
    offerId: string;
    expiresAt: Date;
  };
  searchRadiusKm?: number;
  retryCount?: number;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const RideSchema = new Schema<IRideDocument>(
  {
    riderId: { type: String, required: true },
    driverId: { type: String },
    status: {
      type: String,
      enum: [
        'REQUESTED',
        'SEARCHING_DRIVER',
        'DRIVER_ASSIGNED',
        'DRIVER_ARRIVING',
        'DRIVER_ARRIVED',
        'RIDE_STARTED',
        'RIDE_COMPLETED',
        'CANCELLED',
        'NO_DRIVER_FOUND',
      ],
      default: 'REQUESTED',
    },
    vehicleCategory: {
      type: String,
      enum: ['STANDARD', 'COMFORT', 'VIP', 'ECO'],
      default: 'STANDARD',
    },
    pickup: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      address: { type: String, required: true },
    },
    destination: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      address: { type: String, required: true },
    },
    currentDriverLocation: {
      lat: Number,
      lng: Number,
    },
    estimatedFare: { type: Number, required: true },
    finalFare: Number,
    tip: { type: Number, default: 0 },
    distanceKm: { type: Number, required: true },
    durationMinutes: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: ['WALLET', 'CASH', 'CREDIT_CARD'],
      default: 'WALLET',
    },
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'],
      default: 'PENDING',
    },
    cancellationReason: String,
    cancelledBy: String,
    stateHistory: [
      {
        status: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        byUserId: String,
        reason: String,
      },
    ],
    offeredDriverIds: { type: [String], default: [] },
    currentOffer: {
      driverId: String,
      offerId: String,
      expiresAt: Date,
    },
    searchRadiusKm: { type: Number, default: 3 },
    retryCount: { type: Number, default: 0 },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

RideSchema.index({ riderId: 1, createdAt: -1 });
RideSchema.index({ driverId: 1, createdAt: -1 });
RideSchema.index({ status: 1 });
RideSchema.index({ createdAt: -1 });
RideSchema.index({ status: 1, 'currentOffer.expiresAt': 1 });

// 4b. Ride Offer Schema (Tracks atomic, timed dispatch offers to drivers)
export interface IRideOfferDocument extends Document {
  rideId: string;
  driverId: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  expiresAt: Date;
  distanceKm: number;
  estimatedFare: number;
  createdAt: Date;
  updatedAt: Date;
}

export const RideOfferSchema = new Schema<IRideOfferDocument>(
  {
    rideId: { type: String, required: true, index: true },
    driverId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'],
      default: 'PENDING',
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    distanceKm: { type: Number, required: true },
    estimatedFare: { type: Number, required: true },
  },
  { timestamps: true }
);

RideOfferSchema.index({ rideId: 1, driverId: 1 });
RideOfferSchema.index({ status: 1, expiresAt: 1 });

// 5. Wallet Schema
export interface IWalletDocument extends Document {
  userId: string;
  balance: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export const WalletSchema = new Schema<IWalletDocument>(
  {
    userId: { type: String, required: true, unique: true },
    balance: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'SAR' },
  },
  { timestamps: true }
);

WalletSchema.index({ userId: 1 });

// 6. Wallet Transaction Schema
export interface IWalletTransactionDocument extends Document {
  walletId: string;
  userId: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  balanceAfter: number;
  reason: string;
  referenceId?: string;
  idempotencyKey?: string;
  createdAt: Date;
}

export const WalletTransactionSchema = new Schema<IWalletTransactionDocument>(
  {
    walletId: { type: String, required: true },
    userId: { type: String, required: true },
    type: { type: String, enum: ['CREDIT', 'DEBIT'], required: true },
    amount: { type: Number, required: true, min: 0.01 },
    balanceAfter: { type: Number, required: true },
    reason: { type: String, required: true },
    referenceId: String,
    idempotencyKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

WalletTransactionSchema.index({ userId: 1, createdAt: -1 });
WalletTransactionSchema.index({ walletId: 1, createdAt: -1 });

// 7. Payment Schema
export interface IPaymentDocument extends Document {
  rideId: string;
  userId: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  paymentMethod: 'WALLET' | 'CASH' | 'CREDIT_CARD';
  stripePaymentIntentId?: string;
  stripeClientSecret?: string;
  idempotencyKey?: string;
  refundAmount?: number;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export const PaymentSchema = new Schema<IPaymentDocument>(
  {
    rideId: { type: String, required: true },
    userId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'SAR' },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'],
      default: 'PENDING',
    },
    paymentMethod: {
      type: String,
      enum: ['WALLET', 'CASH', 'CREDIT_CARD'],
      required: true,
    },
    stripePaymentIntentId: { type: String, sparse: true, index: true },
    stripeClientSecret: String,
    idempotencyKey: { type: String, sparse: true, unique: true },
    refundAmount: { type: Number, default: 0 },
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true }
);

PaymentSchema.index({ rideId: 1 });
PaymentSchema.index({ userId: 1, createdAt: -1 });

// 8. Rating Schema
export interface IRatingDocument extends Document {
  rideId: string;
  fromUserId: string;
  toUserId: string;
  stars: number;
  comment?: string;
  createdAt: Date;
}

export const RatingSchema = new Schema<IRatingDocument>(
  {
    rideId: { type: String, required: true },
    fromUserId: { type: String, required: true },
    toUserId: { type: String, required: true },
    stars: { type: Number, required: true, min: 1, max: 5 },
    comment: String,
  },
  { timestamps: true }
);

RatingSchema.index({ rideId: 1, fromUserId: 1 }, { unique: true });
RatingSchema.index({ toUserId: 1 });

// 9. Message Schema
export interface IMessageDocument extends Document {
  rideId: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  content: string;
  read: boolean;
  createdAt: Date;
}

export const MessageSchema = new Schema<IMessageDocument>(
  {
    rideId: { type: String, required: true },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    recipientId: { type: String, required: true },
    content: { type: String, required: true, maxlength: 1000 },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

MessageSchema.index({ rideId: 1, createdAt: 1 });

// 10. Notification Schema
export interface INotificationDocument extends Document {
  userId: string;
  title: string;
  body: string;
  type: 'RIDE_UPDATE' | 'PAYMENT' | 'PROMO' | 'SYSTEM';
  metadata?: Record<string, any>;
  read: boolean;
  createdAt: Date;
}

export const NotificationSchema = new Schema<INotificationDocument>(
  {
    userId: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    type: {
      type: String,
      enum: ['RIDE_UPDATE', 'PAYMENT', 'PROMO', 'SYSTEM'],
      default: 'SYSTEM',
    },
    metadata: Schema.Types.Mixed,
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

NotificationSchema.index({ userId: 1, createdAt: -1 });

// 11. AuditLog Schema
export interface IAuditLogDocument extends Document {
  userId?: string;
  action: string;
  details?: Record<string, any>;
  ip?: string;
  userAgent?: string;
  timestamp: Date;
}

export const AuditLogSchema = new Schema<IAuditLogDocument>({
  userId: String,
  action: { type: String, required: true },
  details: Schema.Types.Mixed,
  ip: String,
  userAgent: String,
  timestamp: { type: Date, default: Date.now },
});

AuditLogSchema.index({ action: 1, timestamp: -1 });
AuditLogSchema.index({ userId: 1, timestamp: -1 });

// 12. RefreshSession Schema (for secure refresh token rotation & revocation)
export interface IRefreshSessionDocument extends Document {
  userId: string;
  jti: string;
  tokenHash: string;
  revoked: boolean;
  revokedReason?: string;
  expiresAt: Date;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const RefreshSessionSchema = new Schema<IRefreshSessionDocument>(
  {
    userId: { type: String, required: true, index: true },
    jti: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true },
    revoked: { type: Boolean, default: false, index: true },
    revokedReason: String,
    expiresAt: { type: Date, required: true, index: true },
    ip: String,
    userAgent: String,
  },
  { timestamps: true }
);

RefreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB TTL auto-cleanup

// 13. WebhookEvent Schema (for persistent webhook deduplication and idempotency)
export interface IWebhookEventDocument extends Document {
  eventId: string;
  source: string;
  type: string;
  payload?: Record<string, any>;
  processedAt: Date;
  status: 'PROCESSED' | 'FAILED';
  errorMessage?: string;
  createdAt: Date;
}

export const WebhookEventSchema = new Schema<IWebhookEventDocument>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    source: { type: String, default: 'stripe', index: true },
    type: { type: String, required: true },
    payload: Schema.Types.Mixed,
    processedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['PROCESSED', 'FAILED'], default: 'PROCESSED' },
    errorMessage: String,
  },
  { timestamps: true }
);

WebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // Auto-expire after 30 days

// Export Mongoose Models
export const UserModel = mongoose.models.User || mongoose.model<IUserDocument>('User', UserSchema);
export const DriverModel = mongoose.models.Driver || mongoose.model<IDriverDocument>('Driver', DriverSchema);
export const VehicleModel = mongoose.models.Vehicle || mongoose.model<IVehicleDocument>('Vehicle', VehicleSchema);
export const RideModel = mongoose.models.Ride || mongoose.model<IRideDocument>('Ride', RideSchema);
export const WalletModel = mongoose.models.Wallet || mongoose.model<IWalletDocument>('Wallet', WalletSchema);
export const WalletTransactionModel =
  mongoose.models.WalletTransaction || mongoose.model<IWalletTransactionDocument>('WalletTransaction', WalletTransactionSchema);
export const PaymentModel = mongoose.models.Payment || mongoose.model<IPaymentDocument>('Payment', PaymentSchema);
export const RatingModel = mongoose.models.Rating || mongoose.model<IRatingDocument>('Rating', RatingSchema);
export const MessageModel = mongoose.models.Message || mongoose.model<IMessageDocument>('Message', MessageSchema);
export const NotificationModel =
  mongoose.models.Notification || mongoose.model<INotificationDocument>('Notification', NotificationSchema);
export const AuditLogModel = mongoose.models.AuditLog || mongoose.model<IAuditLogDocument>('AuditLog', AuditLogSchema);
export const RefreshSessionModel =
  mongoose.models.RefreshSession || mongoose.model<IRefreshSessionDocument>('RefreshSession', RefreshSessionSchema);
export const WebhookEventModel =
  mongoose.models.WebhookEvent || mongoose.model<IWebhookEventDocument>('WebhookEvent', WebhookEventSchema);
export const RideOfferModel =
  mongoose.models.RideOffer || mongoose.model<IRideOfferDocument>('RideOffer', RideOfferSchema);
