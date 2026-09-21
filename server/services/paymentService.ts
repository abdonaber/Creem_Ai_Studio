import { config } from '../config';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';

export interface PaymentIntentResult {
  intentId: string;
  status: 'SUCCEEDED' | 'PENDING' | 'FAILED';
  clientSecret?: string;
  provider: 'STRIPE' | 'SANDBOX';
}

export interface IPaymentProvider {
  createIntent(
    amount: number,
    currency: string,
    idempotencyKey?: string,
    metadata?: Record<string, unknown>
  ): Promise<PaymentIntentResult>;
  confirmPayment(intentId: string): Promise<{ success: boolean; status: string }>;
  refund(intentId: string, amount?: number): Promise<{ success: boolean }>;
  verifyWebhook(payload: string, signature: string): boolean;
}

class SandboxPaymentProvider implements IPaymentProvider {
  private processedIntents: Map<string, { amount: number; status: string }> = new Map();
  private idempotencyKeys: Map<string, PaymentIntentResult> = new Map();

  async createIntent(
    amount: number,
    currency: string,
    idempotencyKey?: string,
    metadata?: Record<string, unknown>
  ): Promise<PaymentIntentResult> {
    if (idempotencyKey && this.idempotencyKeys.has(idempotencyKey)) {
      return this.idempotencyKeys.get(idempotencyKey)!;
    }

    const intentId = 'pi_test_' + Math.random().toString(36).substring(2, 12);
    const result: PaymentIntentResult = {
      intentId,
      status: 'SUCCEEDED', // Simulated successful charge in sandbox
      clientSecret: `test_sec_${intentId}`,
      provider: 'SANDBOX',
    };

    this.processedIntents.set(intentId, { amount, status: 'SUCCEEDED' });
    if (idempotencyKey) {
      this.idempotencyKeys.set(idempotencyKey, result);
    }
    return result;
  }

  async confirmPayment(intentId: string): Promise<{ success: boolean; status: string }> {
    const item = this.processedIntents.get(intentId);
    if (!item) return { success: false, status: 'NOT_FOUND' };
    item.status = 'SUCCEEDED';
    return { success: true, status: 'SUCCEEDED' };
  }

  async refund(intentId: string): Promise<{ success: boolean }> {
    const item = this.processedIntents.get(intentId);
    if (!item) return { success: false };
    item.status = 'REFUNDED';
    return { success: true };
  }

  verifyWebhook(payload: string, signature: string): boolean {
    return signature === 'test_valid_signature' || !config.isProduction;
  }
}

export class PaymentService {
  private static provider: IPaymentProvider = new SandboxPaymentProvider();
  private static processedWebhooks: Set<string> = new Set();

  public static async processRidePayment(
    rideId: string,
    userId: string,
    amount: number,
    method: 'WALLET' | 'CASH' | 'CREDIT_CARD',
    idempotencyKey?: string
  ): Promise<{ success: boolean; paymentStatus: string; transactionId?: string }> {
    const ride = db.findRideById(rideId);
    if (!ride) {
      throw new AppError('Ride not found', 404, 'RIDE_NOT_FOUND');
    }

    // IDOR check: only the rider or driver of this ride can trigger payment processing
    if (ride.riderId !== userId && ride.driverId !== userId) {
      throw new AppError('Unauthorized to process payment for this ride', 403, 'FORBIDDEN');
    }

    if (ride.paymentStatus === 'SUCCEEDED') {
      return { success: true, paymentStatus: 'SUCCEEDED' };
    }

    if (method === 'WALLET') {
      const debitResult = db.debitWallet(
        ride.riderId,
        amount,
        `Payment for ride #${rideId.slice(0, 8)}`,
        rideId
      );
      if (!debitResult.success) {
        db.updateRide(rideId, { paymentStatus: 'FAILED' });
        throw new AppError(
          debitResult.error || 'Insufficient wallet balance. Please top up or pay by cash.',
          400,
          'INSUFFICIENT_FUNDS'
        );
      }

      // Credit driver's wallet (80% net earnings after 20% platform commission)
      if (ride.driverId) {
        const driver = db.findDriverById(ride.driverId);
        if (driver) {
          const driverEarning = Math.round(amount * 0.8 * 100) / 100;
          db.creditWallet(driver.userId, driverEarning, `Earnings for ride #${rideId.slice(0, 8)}`, rideId);
          db.updateDriver(driver.id, {
            earningsTotal: (driver.earningsTotal || 0) + driverEarning,
          });
        }
      }

      db.updateRide(rideId, {
        paymentStatus: 'SUCCEEDED',
        paymentMethod: 'WALLET',
        finalFare: amount,
      });

      return {
        success: true,
        paymentStatus: 'SUCCEEDED',
        transactionId: debitResult.transaction?.id,
      };
    } else if (method === 'CASH') {
      // Cash paid directly to driver
      if (ride.driverId) {
        const driver = db.findDriverById(ride.driverId);
        if (driver) {
          const platformFee = Math.round(amount * 0.2 * 100) / 100;
          // Platform fee deduction from driver wallet
          db.debitWallet(driver.userId, platformFee, `Platform commission (20%) for cash ride #${rideId.slice(0, 8)}`, rideId);
          db.updateDriver(driver.id, {
            earningsTotal: (driver.earningsTotal || 0) + (amount - platformFee),
          });
        }
      }

      db.updateRide(rideId, {
        paymentStatus: 'SUCCEEDED',
        paymentMethod: 'CASH',
        finalFare: amount,
      });

      return { success: true, paymentStatus: 'SUCCEEDED' };
    } else {
      // Card payment via provider
      const intent = await this.provider.createIntent(amount, 'SAR', idempotencyKey, {
        rideId,
        userId: ride.riderId,
      });

      db.updateRide(rideId, {
        paymentStatus: intent.status,
        paymentMethod: 'CREDIT_CARD',
        paymentIntentId: intent.intentId,
        finalFare: amount,
      });

      return {
        success: intent.status === 'SUCCEEDED',
        paymentStatus: intent.status,
        transactionId: intent.intentId,
      };
    }
  }

  public static handleWebhook(payload: string, signature: string, eventId: string): boolean {
    if (this.processedWebhooks.has(eventId)) {
      // Replay attack / duplicate webhook prevention
      console.warn(`[Payment] Duplicate webhook detected: ${eventId}`);
      return true;
    }

    const isValid = this.provider.verifyWebhook(payload, signature);
    if (!isValid) {
      throw new AppError('Invalid webhook signature', 400, 'INVALID_SIGNATURE');
    }

    this.processedWebhooks.add(eventId);
    return true;
  }
}
