import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService } from '../server/services/authService';
import { db } from '../server/db/store';

describe('Authentication & Security Audit Tests', () => {
  beforeEach(() => {
    db.clearAll();
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

    // Verify wallet was created with initial 0 balance
    const wallet = await db.getOrCreateWallet(reg.user.id);
    expect(wallet.balance).toBe(0);
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

    const rotated = await AuthService.rotateRefreshToken(reg.refreshToken);
    expect(rotated.accessToken).toBeDefined();
    expect(rotated.refreshToken).toBeDefined();
    expect(rotated.refreshToken).not.toBe(reg.refreshToken);

    // Old token must now be rejected
    await expect(AuthService.rotateRefreshToken(reg.refreshToken)).rejects.toThrow();
  });

  it('wallet safety: prevents debit exceeding balance', async () => {
    const userId = 'usr_wallet_test';
    const wallet = await db.getOrCreateWallet(userId);
    wallet.balance = 50;

    const debitOk = await db.debitWallet(userId, 30, 'Trip Payment');
    expect(debitOk.wallet.balance).toBe(20);

    await expect(db.debitWallet(userId, 50, 'Excessive Payment')).rejects.toThrow('INSUFFICIENT_FUNDS');
    const finalWallet = await db.getOrCreateWallet(userId);
    expect(finalWallet.balance).toBe(20); // Unchanged
  });
});
