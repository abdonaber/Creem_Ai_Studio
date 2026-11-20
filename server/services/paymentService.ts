import { PaymentStatus } from '../types';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { StripeService } from './stripeService';
import { io } from '../socket/socketHandler';
import { acquireLock, releaseLock } from '../redis/redisClient';
import { logger } from '../utils/logger';

function resolvePaymentIntentIdFromObject(obj: any): string | undefined {
  if (!obj) return undefined;
  if (typeof obj.payment_intent === 'string' && obj.payment_intent.startsWith('pi_')) {
    return obj.payment_intent;
  }
  if (obj.payment_intent?.id && typeof obj.payment_intent.id === 'string' && obj.payment_intent.id.startsWith('pi_')) {
    return obj.payment_intent.id;
  }
  if (obj.object === 'payment_intent' && typeof obj.id === 'string' && obj.id.startsWith('pi_')) {
    return obj.id;
  }
  return undefined;
}

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

    const serverAuthoritativeFare = ride.finalFare ?? ride.estimatedFare;
    if (serverAuthoritativeFare === undefined || serverAuthoritativeFare === null || serverAuthoritativeFare <= 0) {
      throw new AppError('Ride has no valid fare calculated.', 400, 'INVALID_RIDE_FARE');
    }
    const finalAmount = Math.round(serverAuthoritativeFare * 100) / 100;

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
      const decimalPart = amount.toString().split('.')[1];
      if (decimalPart && decimalPart.length > 2) {
        throw new AppError('Payment amount precision abuse: maximum 2 decimal places allowed.', 400, 'DECIMAL_PRECISION_ABUSE');
      }
      if (Math.abs(amount - finalAmount) > 0.01) {
        throw new AppError(
          `FARE_MISMATCH: Provided payment amount (${amount}) does not match server-calculated fare (${finalAmount}).`,
          400,
          'FARE_MISMATCH'
        );
      }
    }

    const lockKey = `payment:${rideId}`;
    const lock = await acquireLock(lockKey, 10000);
    if (!lock.acquired) {
      throw new AppError('Payment is currently being processed for this ride.', 409, 'CONCURRENT_PAYMENT_CONFLICT');
    }

    try {
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
        logger.warn(`[Payment] Webhook event ${effectiveEventId} is already being processed concurrently.`);
        return true;
      }
    }

    try {
      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object as any;
        const settleResult = await db.settleStripePaymentSucceeded({
          paymentIntentId: paymentIntent.id,
          eventId: effectiveEventId,
          amount: paymentIntent.amount ? Math.round(Number(paymentIntent.amount)) / 100 : undefined,
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
      } else if (event.type === 'payment_intent.canceled') {
        const paymentIntent = event.data.object as any;
        const payment = await db.findPaymentByStripeIntent(paymentIntent.id);
        if (payment && payment.status !== 'SUCCEEDED' && payment.status !== 'REFUNDED' && payment.status !== 'PARTIALLY_REFUNDED') {
          await db.updatePayment(payment.id, { status: 'CANCELED' });
          await db.updateRide(payment.rideId, { paymentStatus: 'FAILED' });
          if (io) {
            io.to(`ride:${payment.rideId}`).emit('ride:payment_failed', {
              rideId: payment.rideId,
              status: 'CANCELED',
              reason: paymentIntent.cancellation_reason || 'Payment intent was canceled',
            });
          }
        }
      } else if (event.type === 'refund.failed') {
        const obj = event.data.object as any;
        logger.warn(`Stripe refund ${obj.id} failed: ${obj.failure_reason || obj.reason}`);
        let paymentIntentId = resolvePaymentIntentIdFromObject(obj);
        if (!paymentIntentId && obj.charge) {
          const localPayment = await db.findPaymentByStripeCharge(obj.charge);
          paymentIntentId = localPayment?.stripePaymentIntentId;
        }
        if (paymentIntentId) {
          await db.trackRefundState({
            paymentIntentId,
            refundId: obj.id,
            amount: obj.amount ? Math.round(Number(obj.amount)) / 100 : 0,
            status: 'failed',
            eventId: effectiveEventId,
            reason: obj.failure_reason || obj.reason,
          });
        }
        if (effectiveEventId) {
          await db.recordProcessedWebhook(
            effectiveEventId,
            'stripe',
            event.type,
            { id: event.id, type: event.type, refundId: obj.id, status: 'failed' },
            'FAILED',
            obj.failure_reason || 'Refund failed in Stripe'
          );
        }
        return true;
      } else if (
        event.type === 'charge.refunded' ||
        event.type === 'refund.created' ||
        event.type === 'refund.updated'
      ) {
        const obj = event.data.object as any;

        // 1. Only settle financially when Stripe status is 'succeeded'
        if (event.type === 'refund.created' || event.type === 'refund.updated') {
          if (obj.status !== 'succeeded') {
            logger.info(`Stripe refund event ${event.type} status is '${obj.status}'. Skipping ledger settlement until succeeded.`, {
              refundId: obj.id,
              status: obj.status,
            });
            let piId = resolvePaymentIntentIdFromObject(obj);
            if (!piId && obj.charge) {
              const localPay = await db.findPaymentByStripeCharge(obj.charge);
              piId = localPay?.stripePaymentIntentId;
            }
            if (piId) {
              await db.trackRefundState({
                paymentIntentId: piId,
                refundId: obj.id,
                amount: obj.amount ? Math.round(Number(obj.amount)) / 100 : 0,
                status: obj.status,
                eventId: effectiveEventId,
                reason: obj.cancellation_reason || obj.reason || obj.failure_reason,
              });
            }
            if (effectiveEventId) {
              await db.recordProcessedWebhook(
                effectiveEventId,
                'stripe',
                event.type,
                { id: event.id, type: event.type, refundId: obj.id, status: obj.status },
                obj.status === 'failed' || obj.status === 'canceled' ? 'FAILED' : 'PROCESSED'
              );
            }
            return true;
          }
        }

        // 2. Resolve PaymentIntent cleanly (never treat re_* as pi_*)
        let paymentIntentId = resolvePaymentIntentIdFromObject(obj);
        const chargeIdToCheck =
          typeof obj.charge === 'string'
            ? obj.charge
            : obj.object === 'charge' && typeof obj.id === 'string'
            ? obj.id
            : undefined;

        if (!paymentIntentId && chargeIdToCheck) {
          const localPayment = await db.findPaymentByStripeCharge(chargeIdToCheck);
          if (localPayment?.stripePaymentIntentId) {
            paymentIntentId = localPayment.stripePaymentIntentId;
          } else {
            try {
              const charge = await StripeService.retrieveCharge(chargeIdToCheck);
              if (typeof charge?.payment_intent === 'string' && charge.payment_intent.startsWith('pi_')) {
                paymentIntentId = charge.payment_intent;
              } else if (charge?.payment_intent?.id && String(charge.payment_intent.id).startsWith('pi_')) {
                paymentIntentId = charge.payment_intent.id;
              }
            } catch (e: any) {
              logger.warn(`Could not retrieve charge ${chargeIdToCheck} to resolve payment_intent: ${e.message}`);
            }
          }
        }

        if (!paymentIntentId) {
          logger.error('CRITICAL: Refund webhook received without valid payment_intent and charge resolution failed. Routing to reconciliation.', {
            eventId: effectiveEventId,
            eventType: event.type,
            refundId: obj.id,
            chargeId: chargeIdToCheck,
          });
          await db.recordReconciliationDiscrepancy({
            type: 'UNRESOLVABLE_REFUND_PAYMENT_INTENT',
            id: obj.id || 'unknown_refund',
            details: `Refund webhook received without valid payment_intent. eventId=${effectiveEventId}, chargeId=${chargeIdToCheck}`,
          });
          if (effectiveEventId) {
            await db.recordProcessedWebhook(
              effectiveEventId,
              'stripe',
              event.type,
              { id: event.id, type: event.type, refundId: obj.id, charge: chargeIdToCheck },
              'REQUIRES_RECONCILIATION',
              'Missing or unresolvable payment_intent'
            );
          }
          return true;
        }

        // Unified refund lock shared with refundRidePayment
        const refundLockKey = `payment:refund:${paymentIntentId}`;
        const refundLock = await acquireLock(refundLockKey, 15000);
        if (!refundLock.acquired) {
          throw new AppError(`Refund lock busy for ${paymentIntentId}`, 409, 'CONCURRENT_REFUND_CONFLICT');
        }

        try {
          const currency = obj.currency ? String(obj.currency).toUpperCase() : undefined;
          const refundsArray: any[] = Array.isArray(obj.refunds?.data) ? obj.refunds.data : [];

          if (event.type === 'charge.refunded' && refundsArray.length > 0) {
            // Process every refund in charge.refunded refunds.data cleanly by stripeRefundId
            for (const item of refundsArray) {
              const itemAmount = item.amount !== undefined ? Math.round(Number(item.amount)) / 100 : 0;
              if (item.status && item.status !== 'succeeded') {
                await db.trackRefundState({
                  paymentIntentId,
                  refundId: item.id,
                  amount: itemAmount,
                  status: item.status,
                  eventId: effectiveEventId,
                  reason: item.reason || item.failure_reason || item.cancellation_reason,
                });
                continue;
              }

              if (itemAmount > 0) {
                const settleResult = await db.settleStripeRefund({
                  paymentIntentId,
                  eventId: effectiveEventId,
                  refundDelta: itemAmount,
                  currency: item.currency ? String(item.currency).toUpperCase() : currency,
                  refundId: item.id,
                  reason: item.reason || obj.reason,
                });

                if (io && settleResult.success && !settleResult.alreadyRefunded && (settleResult.refundDelta ?? 0) > 0) {
                  const payment = await db.findPaymentByStripeIntent(paymentIntentId);
                  if (payment) {
                    io.to(`ride:${payment.rideId}`).emit('ride:payment_refunded', {
                      rideId: payment.rideId,
                      status: settleResult.status || payment.status,
                      amount: settleResult.refundAmount,
                      refundDelta: settleResult.refundDelta,
                      isPartial: settleResult.isPartial,
                    });
                  }
                }
              }
            }
          } else {
            let cumulativeAmountRefunded: number | undefined = undefined;
            let refundDelta: number | undefined = undefined;

            if (obj.amount_refunded !== undefined && obj.amount_refunded !== null) {
              cumulativeAmountRefunded = Math.round(Number(obj.amount_refunded)) / 100;
            } else if (obj.object === 'refund' && obj.amount !== undefined) {
              refundDelta = Math.round(Number(obj.amount)) / 100;
            } else if (obj.amount !== undefined) {
              refundDelta = Math.round(Number(obj.amount)) / 100;
            }

            const refundId = obj.refunds?.data?.[0]?.id || (obj.object === 'refund' ? obj.id : undefined);

            const settleResult = await db.settleStripeRefund({
              paymentIntentId,
              eventId: effectiveEventId,
              cumulativeAmountRefunded,
              refundDelta,
              refundAmount: cumulativeAmountRefunded,
              currency,
              refundId,
              reason: obj.cancellation_reason || obj.reason || obj.failure_reason,
            });

            if (io && settleResult.success && !settleResult.alreadyRefunded && (settleResult.refundDelta ?? 0) > 0) {
              const payment = await db.findPaymentByStripeIntent(paymentIntentId);
              if (payment) {
                io.to(`ride:${payment.rideId}`).emit('ride:payment_refunded', {
                  rideId: payment.rideId,
                  status: settleResult.status || payment.status,
                  amount: settleResult.refundAmount,
                  refundDelta: settleResult.refundDelta,
                  isPartial: settleResult.isPartial,
                });
              }
            }
          }
        } finally {
          await releaseLock(refundLockKey, refundLock.token);
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

  /**
   * Initiates a verified refund for a ride's payment with pre-persisted idempotency tracking
   */
  public static async refundRidePayment(params: {
    rideId?: string;
    paymentIntentId?: string;
    amount?: number;
    reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
    requestedByUserId?: string;
    idempotencyKey?: string;
  }): Promise<{
    success: boolean;
    refundId: string;
    status: string;
    amountRefunded?: number;
    paymentStatus: PaymentStatus;
  }> {
    const { rideId, paymentIntentId, amount, reason } = params;

    let payment: any = null;
    if (paymentIntentId) {
      payment = await db.findPaymentByStripeIntent(paymentIntentId);
    } else if (rideId) {
      payment = await db.findPaymentByRideId(rideId);
    }

    if (!payment) {
      throw new AppError('Payment not found for refund request', 404, 'PAYMENT_NOT_FOUND');
    }

    if (params.requestedByUserId) {
      if (payment.userId !== params.requestedByUserId) {
        const requestingUser = await db.findUserById(params.requestedByUserId);
        if (requestingUser?.role !== 'ADMIN') {
          throw new AppError('Unauthorized to request refund for this payment', 403, 'FORBIDDEN');
        }
      }
    }

    // Use the exact same lock namespace as handleWebhook so API refunds and webhooks never race
    const lockKey = `payment:refund:${payment.stripePaymentIntentId || payment.id}`;
    const lock = await acquireLock(lockKey, 15000);
    if (!lock.acquired) {
      throw new AppError('A refund is currently being processed for this payment.', 409, 'CONCURRENT_REFUND_CONFLICT');
    }

    try {
      const freshPayment = await db.findPaymentById(payment.id);
      if (!freshPayment) {
        throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
      }

      if (freshPayment.status !== 'SUCCEEDED' && freshPayment.status !== 'PARTIALLY_REFUNDED') {
        throw new AppError(
          `Cannot refund payment in '${freshPayment.status}' status. Only SUCCEEDED or PARTIALLY_REFUNDED payments can be refunded.`,
          400,
          'INVALID_PAYMENT_STATUS_FOR_REFUND'
        );
      }

      const totalAmount = Math.round(freshPayment.amount * 100) / 100;
      const existingRefunded = Math.round((freshPayment.refundAmount || 0) * 100) / 100;
      const remainingBalance = Math.round((totalAmount - existingRefunded) * 100) / 100;

      if (remainingBalance <= 0) {
        throw new AppError('Payment is already fully refunded', 400, 'PAYMENT_ALREADY_REFUNDED');
      }

      let parsedAmount: number | undefined = undefined;
      if (amount !== undefined && amount !== null) {
        if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount)) {
          throw new AppError('Refund amount must be a finite, valid number', 400, 'INVALID_REFUND_AMOUNT');
        }
        if (amount <= 0) {
          throw new AppError('Refund amount must be greater than 0', 400, 'INVALID_REFUND_AMOUNT');
        }
        const decimalStr = String(amount).split('.')[1];
        if (decimalStr && decimalStr.length > 2) {
          throw new AppError('Refund amount cannot have more than 2 decimal places', 400, 'INVALID_REFUND_PRECISION');
        }
        parsedAmount = Math.round(amount * 100) / 100;

        if (parsedAmount > totalAmount) {
          throw new AppError(
            `Refund amount (${parsedAmount} ${freshPayment.currency}) exceeds original payment amount (${totalAmount} ${freshPayment.currency})`,
            400,
            'REFUND_AMOUNT_EXCEEDS_BALANCE'
          );
        }
        if (parsedAmount > remainingBalance) {
          throw new AppError(
            `Refund amount (${parsedAmount} ${freshPayment.currency}) exceeds remaining refundable balance (${remainingBalance} ${freshPayment.currency})`,
            400,
            'REFUND_AMOUNT_EXCEEDS_BALANCE'
          );
        }
      }

      const targetAmount = parsedAmount ?? remainingBalance;
      const existingRequests = freshPayment.refundRequests ? [...freshPayment.refundRequests] : [];

      if (params.idempotencyKey) {
        const duplicateReq = existingRequests.find((r) => r.idempotencyKey === params.idempotencyKey);
        if (duplicateReq && duplicateReq.stripeRefundId) {
          return {
            success: true,
            refundId: duplicateReq.stripeRefundId,
            status: duplicateReq.status,
            amountRefunded: duplicateReq.amount,
            paymentStatus: freshPayment.status,
          };
        }
      }

      const intentToRefund = freshPayment.stripePaymentIntentId;
      if (!intentToRefund) {
        throw new AppError('Payment does not have an associated Stripe payment intent', 400, 'STRIPE_INTENT_MISSING');
      }

      const stripeIdempotencyKey =
        params.idempotencyKey ||
        `refund_${freshPayment.id}_${Math.round(targetAmount * 100)}_${existingRequests.length}`;

      // Persist refund attempt BEFORE executing Stripe network call
      const reqEntry = {
        requestKey: stripeIdempotencyKey,
        idempotencyKey: stripeIdempotencyKey,
        amount: targetAmount,
        status: 'requested',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await db.updatePayment(freshPayment.id, {
        refundRequests: [...existingRequests, reqEntry],
      });

      const stripeResult = await StripeService.refundPayment(
        intentToRefund,
        parsedAmount,
        reason,
        stripeIdempotencyKey
      );

      // Record returned Stripe refund ID & status
      const updatedRequests = [...existingRequests, { ...reqEntry, stripeRefundId: stripeResult.refundId, status: stripeResult.status, updatedAt: new Date().toISOString() }];
      await db.updatePayment(freshPayment.id, { refundRequests: updatedRequests });

      const effectiveRefundDelta = stripeResult.amountRefunded ?? targetAmount;
      let resultingPaymentStatus: PaymentStatus = freshPayment.status;

      if (stripeResult.status === 'succeeded') {
        const settleRes = await db.settleStripeRefund({
          paymentIntentId: intentToRefund,
          eventId: `api_refund_${stripeResult.refundId}`,
          refundDelta: effectiveRefundDelta,
          refundId: stripeResult.refundId,
          reason,
        });
        resultingPaymentStatus = settleRes.status;

        if (io && !settleRes.alreadyRefunded && settleRes.refundDelta > 0) {
          io.to(`ride:${freshPayment.rideId}`).emit('ride:payment_refunded', {
            rideId: freshPayment.rideId,
            status: settleRes.status,
            amount: settleRes.refundAmount,
            refundDelta: settleRes.refundDelta,
            isPartial: settleRes.isPartial,
          });
        }
      } else {
        await db.trackRefundState({
          paymentIntentId: intentToRefund,
          refundId: stripeResult.refundId,
          amount: effectiveRefundDelta,
          status: (stripeResult.status as any) || 'pending',
          reason,
        });
      }

      return {
        success: true,
        refundId: stripeResult.refundId,
        status: stripeResult.status,
        amountRefunded: effectiveRefundDelta,
        paymentStatus: resultingPaymentStatus,
      };
    } finally {
      await releaseLock(lockKey, lock.token);
    }
  }
}
