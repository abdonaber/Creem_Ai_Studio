import Stripe from 'stripe';
import { config } from '../config';
import { AppError } from '../middleware/errorHandler';

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = config.stripeSecretKey;
    if (!key) {
      throw new AppError(
        'STRIPE_SECRET_KEY environment variable is required to process real card transactions.',
        500,
        'STRIPE_NOT_CONFIGURED'
      );
    }
    stripeClient = new Stripe(key, {
      apiVersion: '2025-02-24.acacia' as any,
    });
  }
  return stripeClient;
}

export class StripeService {
  /**
   * Creates a genuine Stripe PaymentIntent for a ride or wallet top-up
   */
  public static async createPaymentIntent(params: {
    amount: number;
    currency?: string;
    rideId?: string;
    userId: string;
    idempotencyKey?: string;
    metadata?: Record<string, string>;
  }): Promise<{
    intentId: string;
    clientSecret: string;
    status: string;
  }> {
    const stripe = getStripe();
    // Stripe amounts are in smallest currency unit (e.g. Halalas for SAR, Cents for USD)
    const amountInSmallestUnit = Math.round(params.amount * 100);

    const intent = await stripe.paymentIntents.create(
      {
        amount: amountInSmallestUnit,
        currency: (params.currency || 'sar').toLowerCase(),
        metadata: {
          userId: params.userId,
          rideId: params.rideId || '',
          ...params.metadata,
        },
        automatic_payment_methods: {
          enabled: true,
        },
      },
      params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined
    );

    return {
      intentId: intent.id,
      clientSecret: intent.client_secret || '',
      status: intent.status,
    };
  }

  /**
   * Constructs and validates a Stripe Webhook event using raw payload and signature
   */
  public static constructWebhookEvent(payload: Buffer | string, signature: string): Stripe.Event {
    const stripe = getStripe();
    const webhookSecret = config.stripeWebhookSecret;

    if (!webhookSecret) {
      throw new AppError('STRIPE_WEBHOOK_SECRET is not configured on the server.', 500, 'WEBHOOK_SECRET_MISSING');
    }

    try {
      return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
      throw new AppError(`Webhook signature verification failed: ${err.message}`, 400, 'INVALID_WEBHOOK_SIGNATURE');
    }
  }

  /**
   * Refunds a payment intent with robust validation
   */
  public static async refundPayment(
    paymentIntentId: string,
    amount?: number,
    reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'
  ): Promise<{ refundId: string; status: string; amountRefunded?: number }> {
    if (!paymentIntentId || typeof paymentIntentId !== 'string' || paymentIntentId.trim().length === 0) {
      throw new AppError('paymentIntentId is required for refund', 400, 'INVALID_PAYMENT_INTENT');
    }

    let parsedAmountCents: number | undefined = undefined;
    if (amount !== undefined && amount !== null) {
      if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount)) {
        throw new AppError('Refund amount must be a valid, finite number', 400, 'INVALID_REFUND_AMOUNT');
      }
      if (amount <= 0) {
        throw new AppError('Refund amount must be greater than 0', 400, 'INVALID_REFUND_AMOUNT');
      }
      // Enforce 2 decimal places precision
      const roundedAmount = Math.round(amount * 100) / 100;
      parsedAmountCents = Math.round(roundedAmount * 100);
    }

    const stripe = getStripe();
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId.trim(),
      amount: parsedAmountCents,
      reason,
    });

    return {
      refundId: refund.id,
      status: refund.status || 'succeeded',
      amountRefunded: refund.amount ? refund.amount / 100 : undefined,
    };
  }

  /**
   * Retrieves a charge by ID from Stripe
   */
  public static async retrieveCharge(chargeId: string): Promise<any> {
    if (!chargeId || typeof chargeId !== 'string') {
      throw new AppError('chargeId is required', 400, 'INVALID_CHARGE_ID');
    }
    const stripe = getStripe();
    return await stripe.charges.retrieve(chargeId.trim());
  }

  /**
   * Retrieves a payment intent by ID from Stripe
   */
  public static async retrievePaymentIntent(paymentIntentId: string): Promise<any> {
    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      throw new AppError('paymentIntentId is required', 400, 'INVALID_PAYMENT_INTENT');
    }
    const stripe = getStripe();
    return await stripe.paymentIntents.retrieve(paymentIntentId.trim());
  }
}
