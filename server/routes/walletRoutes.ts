import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';

export const walletRouter = Router();

walletRouter.use(authenticate);

// Get Wallet & Transactions
walletRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wallet = await db.getOrCreateWallet(req.user!.userId);
    const transactions = await db.getTransactionsForUser(req.user!.userId);

    res.json({
      success: true,
      data: {
        wallet,
        transactions,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Top up Wallet Balance
walletRouter.post('/topup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount, promoCode } = req.body;
    const idempotencyKey =
      (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;
    const numAmount = Number(amount);

    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      throw new AppError('Top-up amount must be a finite number greater than zero', 400, 'INVALID_AMOUNT');
    }

    const decPart = String(numAmount).split('.')[1];
    if (decPart && decPart.length > 2) {
      throw new AppError('Maximum 2 decimal places allowed for SAR amounts', 400, 'INVALID_AMOUNT');
    }

    if (numAmount > 5000) {
      throw new AppError('Maximum single recharge limit is 5,000 SAR', 400, 'AMOUNT_LIMIT_EXCEEDED');
    }

    let bonus = 0;
    const normalizedPromo = promoCode ? String(promoCode).trim().toUpperCase() : '';
    if (normalizedPromo === 'CREEM2026' || normalizedPromo === 'CREEMY2026') {
      bonus = 25;
    }

    const totalCredit = Math.round((numAmount + bonus) * 100) / 100;
    const reason = bonus > 0 ? `Recharge (+${bonus} SAR Promo Bonus)` : 'Wallet Card Recharge';

    const result = await db.creditWallet(
      req.user!.userId,
      totalCredit,
      reason,
      undefined,
      idempotencyKey
    );

    await db.logAudit(req.user!.userId, 'WALLET_TOPUP', {
      amount: totalCredit,
      bonus,
      newBalance: result.wallet.balance,
    });

    res.json({
      success: true,
      data: {
        wallet: result.wallet,
        transaction: result.transaction,
        newBalance: result.wallet.balance,
      },
    });
  } catch (err) {
    next(err);
  }
});
