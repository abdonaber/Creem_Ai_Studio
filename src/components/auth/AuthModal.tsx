import React, { useState } from 'react';
import { api } from '../../lib/api';
import { IUser, UserRole } from '../../types';
import { reconnectSocketWithToken } from '../../lib/socket';
import { User, Lock, Mail, Phone, Car, Sparkles, X } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: IUser, token: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('RIDER');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      if (mode === 'register') {
        const res = await api.post<{ user: IUser; accessToken: string }>('/auth/register', {
          name,
          email,
          phone,
          password,
          role,
        });
        localStorage.setItem('creemy_token', res.accessToken);
        reconnectSocketWithToken(res.accessToken);
        onAuthSuccess(res.user, res.accessToken);
        onClose();
      } else {
        const res = await api.post<{ user: IUser; accessToken: string }>('/auth/login', {
          email,
          password,
        });
        localStorage.setItem('creemy_token', res.accessToken);
        reconnectSocketWithToken(res.accessToken);
        onAuthSuccess(res.user, res.accessToken);
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'فشلت عملية المصادقة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-5 text-right animate-in fade-in zoom-in-95 duration-200 border border-slate-200 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">
                {mode === 'login' ? 'تسجيل الدخول إلى CreemY' : 'إنشاء حساب جديد في CreemY'}
              </h3>
              <p className="text-xs text-slate-400">منصة النقل الذكية المعتمدة</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {mode === 'register' && (
            <>
              <div>
                <label className="font-bold text-slate-700 mb-1 block">الاسم الكامل</label>
                <div className="relative">
                  <User className="h-4 w-4 absolute right-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="محمد الخالدي"
                    className="w-full p-2.5 pr-9 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 mb-1 block">نوع الحساب</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole('RIDER')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                      role === 'RIDER'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-600'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    <User className="h-4 w-4" />
                    حساب راكب
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('DRIVER')}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                      role === 'DRIVER'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-600'
                        : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    <Car className="h-4 w-4" />
                    حساب كابتن
                  </button>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 mb-1 block">رقم الجوال</label>
                <div className="relative">
                  <Phone className="h-4 w-4 absolute right-3 top-3 text-slate-400" />
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+966501234567"
                    className="w-full p-2.5 pr-9 font-mono bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="font-bold text-slate-700 mb-1 block">البريد الإلكتروني</label>
            <div className="relative">
              <Mail className="h-4 w-4 absolute right-3 top-3 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full p-2.5 pr-9 font-mono bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
              />
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 mb-1 block">كلمة المرور</label>
            <div className="relative">
              <Lock className="h-4 w-4 absolute right-3 top-3 text-slate-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full p-2.5 pr-9 font-mono bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-md shadow-emerald-600/30 transition-colors mt-2"
          >
            {loading
              ? 'جاري التحقق...'
              : mode === 'login'
              ? 'تسجيل الدخول'
              : 'إنشاء الحساب والبدء'}
          </button>
        </form>

        {/* Toggle Mode */}
        <div className="text-center text-xs text-slate-500 pt-2 border-t border-slate-100">
          {mode === 'login' ? (
            <span>
              ليس لديك حساب بعد؟{' '}
              <button
                type="button"
                onClick={() => setMode('register')}
                className="font-bold text-emerald-700 hover:underline"
              >
                إنشاء حساب جديد
              </button>
            </span>
          ) : (
            <span>
              لديك حساب بالفعل؟{' '}
              <button
                type="button"
                onClick={() => setMode('login')}
                className="font-bold text-emerald-700 hover:underline"
              >
                تسجيل الدخول
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
