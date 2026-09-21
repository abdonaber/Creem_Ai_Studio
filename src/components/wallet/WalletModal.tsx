import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { IWallet, IWalletTransaction } from '../../types';
import {
  Wallet,
  X,
  PlusCircle,
  Sparkles,
  CreditCard,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2
} from 'lucide-react';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBalanceUpdated: (newBalance: number) => void;
}

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
  onBalanceUpdated,
}) => {
  const [wallet, setWallet] = useState<IWallet | null>(null);
  const [transactions, setTransactions] = useState<IWalletTransaction[]>([]);
  const [amount, setAmount] = useState<number>(100);
  const [promoCode, setPromoCode] = useState<string>('CREEMY2026');
  const [loading, setLoading] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchWalletData = async () => {
    try {
      const res = await api.get<{ wallet: IWallet; transactions: IWalletTransaction[] }>('/wallet');
      if (res) {
        setWallet(res.wallet);
        setTransactions(res.transactions);
      }
    } catch (err) {
      console.error('Wallet error:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchWalletData();
    }
  }, [isOpen]);

  const handleTopup = async () => {
    setLoading(true);
    setSuccessMessage(null);
    try {
      const res = await api.post<{ transaction: IWalletTransaction; newBalance: number }>('/wallet/topup', {
        amount,
        promoCode: promoCode.trim() || undefined,
      });

      setSuccessMessage(
        promoCode === 'CREEMY2026'
          ? `تم شحن ${amount} SAR بنجاح وإضافة مكافأة الكود الترويجي (+25 SAR)!`
          : `تم شحن ${amount} SAR بنجاح!`
      );
      onBalanceUpdated(res.newBalance);
      fetchWalletData();
    } catch (err: any) {
      alert(err.message || 'فشل في شحن الرصيد');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-6 text-right animate-in fade-in zoom-in-95 duration-200 border border-slate-200 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-lg">محفظة CreemY الرقمية</h3>
              <p className="text-xs text-slate-400">إدارة الرصيد والمدفوعات الفورية</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Balance Card */}
        <div className="p-6 rounded-3xl bg-gradient-to-tr from-emerald-800 to-slate-900 text-white shadow-xl space-y-3">
          <div className="text-xs text-emerald-300 font-medium">الرصيد المتوفر الحالي</div>
          <div className="text-4xl font-black font-sans tracking-tight">
            {wallet?.balance.toFixed(1) || '0.0'}{' '}
            <span className="text-lg font-normal text-emerald-300">SAR</span>
          </div>
          <div className="text-[11px] text-slate-300 flex items-center gap-1.5 pt-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            جاهز للاستخدام في جميع رحلات وفئات CreemY
          </div>
        </div>

        {/* Recharge Section */}
        <div className="space-y-4">
          <div className="text-xs font-bold text-slate-700">شحن الرصيد الفوري</div>

          {/* Quick Amounts */}
          <div className="grid grid-cols-4 gap-2">
            {[50, 100, 200, 500].map((val) => (
              <button
                key={val}
                onClick={() => setAmount(val)}
                className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${
                  amount === val
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
              >
                {val} SAR
              </button>
            ))}
          </div>

          {/* Promo Code Box */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              كود الخصم والمكافأة الترويجية
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder="CREEMY2026"
                className="flex-1 text-xs p-3 font-mono font-bold bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
              />
              <span className="px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-bold flex items-center">
                +25 SAR بونص
              </span>
            </div>
          </div>

          {successMessage && (
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-medium border border-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              {successMessage}
            </div>
          )}

          <button
            disabled={loading}
            onClick={handleTopup}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-xs shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all active:scale-98"
          >
            <CreditCard className="h-4 w-4" />
            {loading ? 'جاري معالجة الشحن الآمن...' : `تأكيد شحن ${amount} SAR الآن`}
          </button>
        </div>

        {/* Recent Transactions List */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <div className="text-xs font-bold text-slate-700">سجل العمليات المالية الأخير</div>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {transactions.length === 0 ? (
              <div className="text-center text-xs text-slate-400 py-4">لا توجد حركات سابقة</div>
            ) : (
              transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`h-7 w-7 rounded-lg flex items-center justify-center ${
                        tx.type === 'CREDIT'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {tx.type === 'CREDIT' ? (
                        <ArrowDownLeft className="h-4 w-4" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4" />
                      )}
                    </div>
                    <div>
                      <div className="font-bold text-slate-800">{tx.reason}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {new Date(tx.createdAt).toLocaleDateString('ar-SA')}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`font-black font-sans ${
                      tx.type === 'CREDIT' ? 'text-emerald-600' : 'text-slate-800'
                    }`}
                  >
                    {tx.type === 'CREDIT' ? '+' : '-'}
                    {tx.amount.toFixed(1)} SAR
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
