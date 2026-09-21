import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { PaymentService } from '../services/paymentService';
import { AppError } from '../middleware/errorHandler';

export const paymentRouter = Router();

// Process ride payment
paymentRouter.post('/process', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rideId, amount, paymentMethod = 'WALLET', idempotencyKey } = req.body;

    if (!rideId || !amount) {
      throw new AppError('rideId and amount are required', 400, 'INVALID_INPUT');
    }

    const result = await PaymentService.processRidePayment(
      rideId,
      req.user!.userId,
      Number(amount),
      paymentMethod,
      idempotencyKey
    );

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Secure Payment Gateway Webhook
paymentRouter.post('/webhook', (req: Request, res: Response, next: NextFunction) => {
  try {
    const sigHeader = req.headers['stripe-signature'] || req.headers['x-webhook-signature'] || '';
    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    const eventIdHeader = req.headers['x-event-id'] || '';
    const eventId = (req.body && req.body.id) || (Array.isArray(eventIdHeader) ? eventIdHeader[0] : eventIdHeader) || `evt_${Date.now()}`;
    const rawPayload = JSON.stringify(req.body);

    const verified = PaymentService.handleWebhook(rawPayload, signature, eventId);
    res.json({ received: true, verified });
  } catch (err) {
    next(err);
  }
});
