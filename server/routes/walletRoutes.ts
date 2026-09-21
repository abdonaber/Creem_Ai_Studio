import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { db } from '../db/store';
import { AppError } from '../middleware/errorHandler';

export const walletRouter = Router();

walletRouter.use(authenticate);

// Get Wallet & Transactions
walletRouter.get('/', (req: Request, res: Response) => {
  const wallet = db.getOrCreateWallet(req.user!.userId);
  const transactions = db.getWalletTransactions(req.user!.userId);

  res.json({
    success: true,
    data: {
      wallet,
      transactions,
    },
  });
});

// Top up Wallet Balance
walletRouter.post('/topup', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount, promoCode } = req.body;
    const numAmount = Number(amount);

    if (isNaN(numAmount) || numAmount <= 0) {
      throw new AppError('Top-up amount must be greater than zero', 400, 'INVALID_AMOUNT');
    }

    if (numAmount > 5000) {
      throw new AppError('Maximum single recharge limit is 5,000 SAR', 400, 'AMOUNT_LIMIT_EXCEEDED');
    }

    let bonus = 0;
    if (promoCode === 'CREEMY2026') {
      bonus = 25; // 25 SAR welcome promo bonus
    }

    const totalCredit = numAmount + bonus;
    const reason = bonus > 0 ? `Recharge (+${bonus} SAR Promo Bonus)` : 'Wallet Card Recharge';

    const tx = db.creditWallet(req.user!.userId, totalCredit, reason);
    db.logAudit(req.user!.userId, 'WALLET_TOPUP', { amount: totalCredit });

    res.json({
      success: true,
      data: {
        transaction: tx,
        newBalance: tx.balanceAfter,
      },
    });
  } catch (err) {
    next(err);
  }
});
