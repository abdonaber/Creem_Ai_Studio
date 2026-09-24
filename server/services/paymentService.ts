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
      if (!ride.driverId) {
        throw new AppError('Cannot settle cash payment without an assigned driver', 400, 'NO_DRIVER_ASSIGNED');
      }

      try {
        const settleResult = await db.settleCashPayment({
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
            method: 'CASH',
            amount,
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
        const payment = await db.findPaymentByStripeIntent(paymentIntent.id);
        if (payment && payment.status !== 'SUCCEEDED') {
          await db.updatePayment(payment.id, { status: 'SUCCEEDED' });
          await db.updateRide(payment.rideId, { paymentStatus: 'SUCCEEDED', finalFare: payment.amount });

          await db.recordLedgerEntry({
            rideId: payment.rideId,
            type: 'RIDER_FARE',
            amount: payment.amount,
            currency: 'SAR',
            fromAccount: `rider:${payment.userId}`,
            toAccount: 'platform:escrow',
            status: 'SETTLED',
            idempotencyKey: `webhook_${effectiveEventId}_fare`,
          });

          const ride = await db.findRideById(payment.rideId);
          if (ride?.driverId) {
            const driver = await db.findDriverById(ride.driverId);
            if (driver) {
              const driverEarning = Math.round(payment.amount * 0.8 * 100) / 100;
              const platformCommission = Math.round((payment.amount - driverEarning) * 100) / 100;

              // Offset cash commission debt if any
              let debtRecovery = 0;
              if (driver.outstandingDebt && driver.outstandingDebt > 0) {
                debtRecovery = Math.min(driverEarning, driver.outstandingDebt);
              }

              const netPayout = driverEarning - debtRecovery;
              if (netPayout > 0) {
                await db.creditWallet(
                  driver.userId,
                  netPayout,
                  `Earnings for card ride #${payment.rideId.slice(0, 8)} (minus debt recovery)`,
                  payment.rideId,
                  `webhook_${effectiveEventId}_credit`
                );
              }

              if (debtRecovery > 0) {
                await db.updateDriver(driver.id, {
                  outstandingDebt: Math.max(0, (driver.outstandingDebt || 0) - debtRecovery),
                });
                await db.recordLedgerEntry({
                  rideId: payment.rideId,
                  type: 'DEBT_RECOVERY',
                  amount: debtRecovery,
                  currency: 'SAR',
                  fromAccount: `driver:${driver.id}`,
                  toAccount: 'platform:commission',
                  status: 'SETTLED',
                  idempotencyKey: `webhook_${effectiveEventId}_debt_rec`,
                });
              }

              await db.recordLedgerEntry({
                rideId: payment.rideId,
                type: 'PLATFORM_COMMISSION',
                amount: platformCommission,
                currency: 'SAR',
                fromAccount: 'platform:escrow',
                toAccount: 'platform:revenue',
                status: 'COMMITTED',
                idempotencyKey: `webhook_${effectiveEventId}_comm`,
              });

              await db.updateDriver(driver.id, {
                earningsTotal: (driver.earningsTotal || 0) + driverEarning,
                totalRides: (driver.totalRides || 0) + 1,
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
