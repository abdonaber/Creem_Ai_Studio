import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '../server/services/authService';
import { db } from '../server/db/store';

describe('Authentication & Security Audit Tests', () => {
  beforeEach(() => {
    db.users.clear();
    db.wallets.clear();
    db.transactions.clear();
    db.refreshTokens.clear();
  });

  it('registers a user securely with hashed password and initialized wallet', async () => {
    const reg = await AuthService.register({
      name: 'Khalid Al-Otaibi',
      email: 'khalid@creemy.app',
      phone: '+966512345678',
      password: 'SecurePassword123!',
      role: 'RIDER',
    });

    expect(reg.user).toBeDefined();
    expect(reg.user.email).toBe('khalid@creemy.app');
    expect((reg.user as any).passwordHash).toBeUndefined(); // Stripped from response
    expect(reg.accessToken).toBeDefined();
    expect(reg.refreshToken).toBeDefined();

    // Verify wallet was created with initial promotional balance
    const wallet = db.getOrCreateWallet(reg.user.id);
    expect(wallet.balance).toBe(100);
  });

  it('authenticates user with valid credentials and rejects incorrect password', async () => {
    await AuthService.register({
      name: 'Nora Fahad',
      email: 'nora@creemy.app',
      phone: '+966587654321',
      password: 'CorrectPassword!',
      role: 'RIDER',
    });

    const successLogin = await AuthService.login({
      email: 'nora@creemy.app',
      password: 'CorrectPassword!',
    });
    expect(successLogin.accessToken).toBeDefined();

    await expect(
      AuthService.login({
        email: 'nora@creemy.app',
        password: 'WrongPassword!',
      })
    ).rejects.toThrow('Invalid email or password');
  });

  it('rotates refresh token and invalidates old token', async () => {
    const reg = await AuthService.register({
      name: 'Saud Abdullah',
      email: 'saud@creemy.app',
      phone: '+966599887766',
      password: 'StrongPassword2026',
      role: 'RIDER',
    });

    const rotated = AuthService.rotateRefreshToken(reg.refreshToken);
    expect(rotated.accessToken).toBeDefined();
    expect(rotated.refreshToken).toBeDefined();
    expect(rotated.refreshToken).not.toBe(reg.refreshToken);

    // Old token must now be rejected
    expect(() => AuthService.rotateRefreshToken(reg.refreshToken)).toThrow();
  });

  it('wallet safety: prevents debit exceeding balance', () => {
    const userId = 'usr_wallet_test';
    const wallet = db.getOrCreateWallet(userId);
    wallet.balance = 50;

    const debitOk = db.debitWallet(userId, 30, 'Trip Payment');
    expect(debitOk.success).toBe(true);
    expect(wallet.balance).toBe(20);

    const debitTooMuch = db.debitWallet(userId, 50, 'Excessive Payment');
    expect(debitTooMuch.success).toBe(false);
    expect(debitTooMuch.error).toContain('Insufficient');
    expect(wallet.balance).toBe(20); // Unchanged
  });
});
