import mongoose, { Schema, Document } from 'mongoose';

// User Schema
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

export const UserSchema = new Schema<IUserDocument>({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['RIDER', 'DRIVER', 'ADMIN'], default: 'RIDER' },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED', 'PENDING'], default: 'ACTIVE' },
  avatarUrl: { type: String },
}, { timestamps: true });

UserSchema.index({ email: 1 });
UserSchema.index({ phone: 1 });
UserSchema.index({ role: 1 });

// Driver Schema
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
  rating: number;
  totalRides: number;
  licenseNumber: string;
  documents: {
    licensePhoto?: string;
    vehicleRegistration?: string;
    idCardPhoto?: string;
  };
  earningsTotal: number;
}

export const DriverSchema = new Schema<IDriverDocument>({
  userId: { type: String, required: true, unique: true },
  approvalStatus: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'], default: 'PENDING' },
  isOnline: { type: Boolean, default: false },
  currentLocation: {
    lat: { type: Number, default: 24.7136 },
    lng: { type: Number, default: 46.6753 },
    heading: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },
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
}, { timestamps: true });

DriverSchema.index({ isOnline: 1, approvalStatus: 1 });
DriverSchema.index({ 'currentLocation.lat': 1, 'currentLocation.lng': 1 });

// Vehicle Schema
export interface IVehicleDocument extends Omit<Document, 'model'> {
  driverId: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plateNumber: string;
  category: 'STANDARD' | 'COMFORT' | 'VIP' | 'ECO';
}

export const VehicleSchema = new Schema<IVehicleDocument>({
  driverId: { type: String, required: true, unique: true },
  make: { type: String, required: true },
  model: { type: String, required: true },
  year: { type: Number, required: true },
  color: { type: String, required: true },
  plateNumber: { type: String, required: true, unique: true },
  category: { type: String, enum: ['STANDARD', 'COMFORT', 'VIP', 'ECO'], default: 'STANDARD' },
}, { timestamps: true });

// Ride Schema
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
  startedAt?: Date;
  completedAt?: Date;
}

export const RideSchema = new Schema<IRideDocument>({
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
  vehicleCategory: { type: String, enum: ['STANDARD', 'COMFORT', 'VIP', 'ECO'], default: 'STANDARD' },
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
  paymentMethod: { type: String, enum: ['WALLET', 'CASH', 'CREDIT_CARD'], default: 'WALLET' },
  paymentStatus: { type: String, enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'], default: 'PENDING' },
  cancellationReason: String,
  cancelledBy: String,
  startedAt: Date,
  completedAt: Date,
}, { timestamps: true });

RideSchema.index({ riderId: 1, createdAt: -1 });
RideSchema.index({ driverId: 1, createdAt: -1 });
RideSchema.index({ status: 1 });

// Wallet & Transaction Schemas
export const WalletSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  balance: { type: Number, default: 0 },
  currency: { type: String, default: 'SAR' },
}, { timestamps: true });

export const WalletTransactionSchema = new Schema({
  walletId: { type: String, required: true },
  userId: { type: String, required: true },
  type: { type: String, enum: ['CREDIT', 'DEBIT'], required: true },
  amount: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  reason: { type: String, required: true },
  referenceId: String,
}, { timestamps: true });

WalletTransactionSchema.index({ userId: 1, createdAt: -1 });

// Message Schema
export const MessageSchema = new Schema({
  rideId: { type: String, required: true },
  senderId: { type: String, required: true },
  senderName: { type: String, required: true },
  recipientId: { type: String, required: true },
  content: { type: String, required: true },
  read: { type: Boolean, default: false },
}, { timestamps: true });

MessageSchema.index({ rideId: 1, createdAt: 1 });

// Rating Schema
export const RatingSchema = new Schema({
  rideId: { type: String, required: true },
  fromUserId: { type: String, required: true },
  toUserId: { type: String, required: true },
  stars: { type: Number, required: true, min: 1, max: 5 },
  comment: String,
}, { timestamps: true });

RatingSchema.index({ toUserId: 1 });

// Notification Schema
export const NotificationSchema = new Schema({
  userId: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  type: { type: String, enum: ['RIDE_UPDATE', 'PAYMENT', 'PROMO', 'SYSTEM'], default: 'SYSTEM' },
  metadata: Schema.Types.Mixed,
  read: { type: Boolean, default: false },
}, { timestamps: true });

NotificationSchema.index({ userId: 1, createdAt: -1 });

// AuditLog Schema
export const AuditLogSchema = new Schema({
  userId: String,
  action: { type: String, required: true },
  details: Schema.Types.Mixed,
  ip: String,
  timestamp: { type: Date, default: Date.now },
});

AuditLogSchema.index({ action: 1, timestamp: -1 });

// Export Mongoose Models if connected
export const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
export const DriverModel = mongoose.models.Driver || mongoose.model('Driver', DriverSchema);
export const VehicleModel = mongoose.models.Vehicle || mongoose.model('Vehicle', VehicleSchema);
export const RideModel = mongoose.models.Ride || mongoose.model('Ride', RideSchema);
export const WalletModel = mongoose.models.Wallet || mongoose.model('Wallet', WalletSchema);
export const WalletTransactionModel = mongoose.models.WalletTransaction || mongoose.model('WalletTransaction', WalletTransactionSchema);
export const MessageModel = mongoose.models.Message || mongoose.model('Message', MessageSchema);
export const RatingModel = mongoose.models.Rating || mongoose.model('Rating', RatingSchema);
export const NotificationModel = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
export const AuditLogModel = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
