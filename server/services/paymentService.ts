import { config } from '../config';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { StripeService } from './stripeService';
import { io } from '../socket/socketHandler';

export class PaymentService {
  public static async processRidePayment(
    rideId: string,
    userId: string,
    amount: number,
    method: 'WALLET' | 'CASH' | 'CREDIT_CARD',
    idempotencyKey?: string
  ): Promise<{ success: boolean; paymentStatus: string; transactionId?: string; clientSecret?: string }> {
    const ride = await db.findRideById(rideId);
    if (!ride) {
      throw new AppError('Ride not found', 404, 'RIDE_NOT_FOUND');
    }

    // IDOR check: only the rider, driver, or admin can trigger payment
    if (ride.riderId !== userId && ride.driverId !== userId) {
      const user = await db.findUserById(userId);
      if (user?.role !== 'ADMIN') {
        throw new AppError('Unauthorized to process payment for this ride', 403, 'FORBIDDEN');
      }
    }

    if (ride.paymentStatus === 'SUCCEEDED') {
      return { success: true, paymentStatus: 'SUCCEEDED' };
    }

    if (method === 'WALLET') {
      try {
        const settleResult = await db.settleRidePaymentWallet({
          rideId,
          riderId: ride.riderId,
          driverId: ride.driverId,
          amount,
          idempotencyKey,
        });

        if (io) {
          io.to(`ride:${rideId}`).emit('ride:payment_completed', {
            rideId,
            status: 'SUCCEEDED',
            method: 'WALLET',
            amount,
          });
        }

        return {
          success: true,
          paymentStatus: 'SUCCEEDED',
          transactionId: settleResult.transactionId,
        };
      } catch (err: any) {
        await db.updateRide(rideId, { paymentStatus: 'FAILED' });
        throw new AppError(
          err.message || 'Insufficient wallet balance. Please top up or pay by cash.',
          err.statusCode || 400,
          err.code || 'INSUFFICIENT_FUNDS'
        );
      }
    } else if (method === 'CASH') {
      // Cash paid directly by rider to driver
      if (ride.driverId) {
        const driver = await db.findDriverById(ride.driverId);
        if (driver) {
          const platformFee = Math.round(amount * 0.2 * 100) / 100;
          try {
            // Deduct platform commission from driver's wallet
            await db.debitWallet(
              driver.userId,
              platformFee,
              `Platform commission (20%) for cash ride #${rideId.slice(0, 8)}`,
              rideId,
              idempotencyKey ? `${idempotencyKey}_commission` : undefined
            );
          } catch {
            console.warn(`[Payment] Driver ${driver.id} wallet debit deferred for cash commission.`);
          }

          await db.updateDriver(driver.id, {
            earningsTotal: (driver.earningsTotal || 0) + (amount - platformFee),
          });
        }
      }

      await db.updateRide(rideId, {
        paymentStatus: 'SUCCEEDED',
        paymentMethod: 'CASH',
        finalFare: amount,
      });

      const payment = await db.createPayment({
        rideId,
        userId: ride.riderId,
        amount,
        currency: 'SAR',
        status: 'SUCCEEDED',
        paymentMethod: 'CASH',
        idempotencyKey,
      });

      if (io) {
        io.to(`ride:${rideId}`).emit('ride:payment_completed', {
          rideId,
          status: 'SUCCEEDED',
          method: 'CASH',
          amount,
        });
      }

      return { success: true, paymentStatus: 'SUCCEEDED', transactionId: payment.id };
    } else {
      // Credit card via Stripe
      const intent = await StripeService.createPaymentIntent({
        amount,
        currency: 'SAR',
        rideId,
        userId: ride.riderId,
        idempotencyKey,
        metadata: { rideId, userId: ride.riderId },
      });

      await db.updateRide(rideId, {
        paymentStatus: 'PENDING',
        paymentMethod: 'CREDIT_CARD',
        finalFare: amount,
      });

      const payment = await db.createPayment({
        rideId,
        userId: ride.riderId,
        amount,
        currency: 'SAR',
        status: 'PENDING',
        paymentMethod: 'CREDIT_CARD',
        stripePaymentIntentId: intent.intentId,
        stripeClientSecret: intent.clientSecret,
        idempotencyKey,
      });

      return {
        success: true,
        paymentStatus: 'PENDING',
        transactionId: intent.intentId,
        clientSecret: intent.clientSecret,
      };
    }
  }

  public static async handleWebhook(
    payload: Buffer | string,
    signature: string,
    eventId?: string
  ): Promise<boolean> {
    if (!signature) {
      throw new AppError('Missing webhook signature.', 400, 'INVALID_SIGNATURE');
    }

    // Persistent deduplication check
    if (eventId) {
      const alreadyProcessed = await db.isWebhookProcessed(eventId);
      if (alreadyProcessed) {
        console.warn(`[Payment] Duplicate webhook detected and safely skipped: ${eventId}`);
        return true;
      }
    }

    const event = StripeService.constructWebhookEvent(payload, signature);
    const effectiveEventId = eventId || event.id;

    if (effectiveEventId) {
      const alreadyProcessed = await db.isWebhookProcessed(effectiveEventId);
      if (alreadyProcessed) {
        return true;
      }
    }

    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as any;
      const payment = await db.findPaymentByStripeIntent(paymentIntent.id);
      if (payment) {
        await db.updatePayment(payment.id, { status: 'SUCCEEDED' });
        await db.updateRide(payment.rideId, { paymentStatus: 'SUCCEEDED' });

        const ride = await db.findRideById(payment.rideId);
        if (ride?.driverId) {
          const driver = await db.findDriverById(ride.driverId);
          if (driver) {
            const driverEarning = Math.round(payment.amount * 0.8 * 100) / 100;
            await db.creditWallet(
              driver.userId,
              driverEarning,
              `Earnings for card ride #${payment.rideId.slice(0, 8)}`,
              payment.rideId
            );
            await db.updateDriver(driver.id, {
              earningsTotal: (driver.earningsTotal || 0) + driverEarning,
            });
          }
        }

        if (io) {
          io.to(`ride:${payment.rideId}`).emit('ride:payment_completed', {
            rideId: payment.rideId,
            status: 'SUCCEEDED',
            method: 'CREDIT_CARD',
            amount: payment.amount,
          });
        }
      }
    }

    if (effectiveEventId) {
      await db.recordProcessedWebhook(
        effectiveEventId,
        'stripe',
        event.type,
        { id: event.id, type: event.type },
        'PROCESSED'
      );
    }

    return true;
  }
}
