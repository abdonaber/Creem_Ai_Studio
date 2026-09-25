import { config } from '../config';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { StripeService } from './stripeService';
import { io } from '../socket/socketHandler';
import { acquireLock, releaseLock } from '../redis/redisClient';

export class PaymentService {
  public static async processRidePayment(
    rideId: string,
    userId: string,
    amount?: number,
    method: 'WALLET' | 'CASH' | 'CREDIT_CARD' = 'WALLET',
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

    if (ride.status === 'CANCELLED') {
      throw new AppError('Cannot process regular payment for a cancelled ride.', 400, 'RIDE_CANCELLED');
    }

    // Server-Authoritative Fare Security (Phase 5 Hardening)
    const serverAuthoritativeFare = ride.finalFare ?? ride.estimatedFare;
    if (serverAuthoritativeFare === undefined || serverAuthoritativeFare === null || serverAuthoritativeFare <= 0) {
      throw new AppError('Ride has no valid fare calculated.', 400, 'INVALID_RIDE_FARE');
    }
    const finalAmount = Math.round(serverAuthoritativeFare * 100) / 100;

    // Validate client-supplied amount if present (rejecting tampering, negative, NaN, Infinity, decimal abuse)
    if (amount !== undefined && amount !== null) {
      if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount)) {
        throw new AppError('Payment amount must be a valid finite number.', 400, 'INVALID_AMOUNT');
      }
      if (amount <= 0) {
        throw new AppError('Payment amount must be greater than zero.', 400, 'INVALID_AMOUNT');
      }
      if (amount > 100000) {
        throw new AppError('Payment amount exceeds maximum allowable transaction limit.', 400, 'AMOUNT_EXCEEDS_LIMIT');
      }
      // Check decimal precision (maximum 2 decimal places)
      const decimalPart = amount.toString().split('.')[1];
      if (decimalPart && decimalPart.length > 2) {
        throw new AppError('Payment amount precision abuse: maximum 2 decimal places allowed.', 400, 'DECIMAL_PRECISION_ABUSE');
      }
      // Strict match check against server fare
      if (Math.abs(amount - finalAmount) > 0.01) {
        throw new AppError(
          `FARE_MISMATCH: Provided payment amount (${amount}) does not match server-calculated fare (${finalAmount}).`,
          400,
          'FARE_MISMATCH'
        );
      }
    }

    // Distributed lock to prevent concurrent double payment attempts for the same ride
    const lockKey = `payment:${rideId}`;
    const lock = await acquireLock(lockKey, 10000);
    if (!lock.acquired) {
      throw new AppError('Payment is currently being processed for this ride.', 409, 'CONCURRENT_PAYMENT_CONFLICT');
    }

    try {
      // Re-verify paymentStatus inside lock
      const freshRide = await db.findRideById(rideId);
      if (freshRide?.paymentStatus === 'SUCCEEDED') {
        return { success: true, paymentStatus: 'SUCCEEDED' };
      }

      if (method === 'WALLET') {
        try {
          const settleResult = await db.settleRidePaymentWallet({
            rideId,
            riderId: ride.riderId,
            driverId: ride.driverId,
            amount: finalAmount,
            idempotencyKey,
          });

          if (io) {
            io.to(`ride:${rideId}`).emit('ride:payment_completed', {
              rideId,
              status: 'SUCCEEDED',
              method: 'WALLET',
              amount: finalAmount,
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
        if (!ride.driverId) {
          throw new AppError('Cannot settle cash payment without an assigned driver', 400, 'NO_DRIVER_ASSIGNED');
        }

        try {
          const settleResult = await db.settleCashPayment({
            rideId,
            riderId: ride.riderId,
            driverId: ride.driverId,
            amount: finalAmount,
            idempotencyKey,
          });

          if (io) {
            io.to(`ride:${rideId}`).emit('ride:payment_completed', {
              rideId,
              status: 'SUCCEEDED',
              method: 'CASH',
              amount: finalAmount,
            });
          }

          return { success: true, paymentStatus: 'SUCCEEDED', transactionId: settleResult.transactionId };
        } catch (err: any) {
          await db.updateRide(rideId, { paymentStatus: 'REQUIRES_RECONCILIATION' });
          throw new AppError(
            `Cash payment settlement failed: ${err.message}. Flagged for reconciliation.`,
            err.statusCode || 500,
            'CASH_SETTLEMENT_FAILED'
          );
        }
      } else {
        // Credit card via Stripe
        const intent = await StripeService.createPaymentIntent({
          amount: finalAmount,
          currency: 'SAR',
          rideId,
          userId: ride.riderId,
          idempotencyKey,
          metadata: { rideId, userId: ride.riderId },
        });

        await db.updateRide(rideId, {
          paymentStatus: 'PENDING',
          paymentMethod: 'CREDIT_CARD',
          finalFare: finalAmount,
        });

        await db.createPayment({
          rideId,
          userId: ride.riderId,
          amount: finalAmount,
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
    } finally {
      await releaseLock(lockKey, lock.token);
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

    const event = StripeService.constructWebhookEvent(payload, signature);
    const effectiveEventId = eventId || event.id;

    if (effectiveEventId) {
      const claim = await db.claimWebhookEvent(effectiveEventId, 'stripe', event.type);
      if (!claim.claimed) {
        if (claim.alreadyProcessed) {
          return true;
        }
        console.warn(`[Payment] Webhook event ${effectiveEventId} is already being processed concurrently.`);
        return true;
      }
    }

    try {
      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object as any;
        const settleResult = await db.settleStripePaymentSucceeded({
          paymentIntentId: paymentIntent.id,
          eventId: effectiveEventId,
          amount: paymentIntent.amount ? paymentIntent.amount / 100 : undefined,
        });

        if (io && settleResult.success) {
          const payment = await db.findPaymentByStripeIntent(paymentIntent.id);
          if (payment) {
            io.to(`ride:${payment.rideId}`).emit('ride:payment_completed', {
              rideId: payment.rideId,
              status: 'SUCCEEDED',
              method: 'CREDIT_CARD',
              amount: payment.amount,
            });
          }
        }
      } else if (event.type === 'payment_intent.payment_failed') {
        const paymentIntent = event.data.object as any;
        const payment = await db.findPaymentByStripeIntent(paymentIntent.id);
        if (payment && payment.status !== 'SUCCEEDED') {
          await db.updatePayment(payment.id, { status: 'FAILED' });
          await db.updateRide(payment.rideId, { paymentStatus: 'FAILED' });
          if (io) {
            io.to(`ride:${payment.rideId}`).emit('ride:payment_failed', {
              rideId: payment.rideId,
              status: 'FAILED',
              reason: paymentIntent.last_payment_error?.message || 'Payment failed',
            });
          }
        }
      } else if (event.type === 'charge.refunded' || event.type === 'payment_intent.canceled') {
        const obj = event.data.object as any;
        const paymentIntentId = obj.payment_intent || obj.id;
        const payment = await db.findPaymentByStripeIntent(paymentIntentId);
        if (payment) {
          const refundAmount = obj.amount_refunded ? obj.amount_refunded / 100 : payment.amount;
          await db.updatePayment(payment.id, { status: 'REFUNDED', refundAmount });
          await db.updateRide(payment.rideId, { paymentStatus: 'REFUNDED' });
          await db.recordLedgerEntry({
            rideId: payment.rideId,
            type: 'REFUND',
            amount: refundAmount,
            currency: 'SAR',
            fromAccount: 'platform:escrow',
            toAccount: `rider:${payment.userId}`,
            status: 'SETTLED',
            idempotencyKey: `webhook_${effectiveEventId}_refund`,
          });
          if (io) {
            io.to(`ride:${payment.rideId}`).emit('ride:payment_refunded', {
              rideId: payment.rideId,
              status: 'REFUNDED',
              amount: refundAmount,
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
    } catch (err: any) {
      if (effectiveEventId) {
        await db.recordProcessedWebhook(
          effectiveEventId,
          'stripe',
          event.type,
          { id: event.id, type: event.type },
          'FAILED',
          err.message
        );
      }
      throw err;
    }
  }
}

