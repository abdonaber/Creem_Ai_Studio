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
    // In demo or when Stripe is not configured, simulate sandbox intent
    if (!config.stripeSecretKey || config.demoMode) {
      const mockId = 'pi_test_' + Math.random().toString(36).substring(2, 12);
      return {
        intentId: mockId,
        clientSecret: `pi_test_${mockId}_secret_test123`,
        status: 'requires_payment_method',
      };
    }

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
   * Refunds a payment intent
   */
  public static async refundPayment(paymentIntentId: string, amount?: number): Promise<{ refundId: string; status: string }> {
    if (!config.stripeSecretKey || config.demoMode) {
      return {
        refundId: 're_test_' + Math.random().toString(36).substring(2, 10),
        status: 'succeeded',
      };
    }

    const stripe = getStripe();
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount ? Math.round(amount * 100) : undefined,
    });

    return {
      refundId: refund.id,
      status: refund.status || 'succeeded',
    };
  }
}
