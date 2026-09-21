import React from 'react';
import { IUser, UserRole } from '../../types';
import {
  Car,
  ShieldCheck,
  User,
  Wallet,
  Bell,
  LogOut,
  Sparkles,
  Wifi,
  ChevronDown
} from 'lucide-react';

interface HeaderProps {
  currentUser: IUser | null;
  walletBalance: number;
  unreadNotifications: number;
  socketConnected: boolean;
  onSwitchRole: (role: UserRole) => void;
  onOpenWallet: () => void;
  onOpenNotifications: () => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  activeView: 'rider' | 'driver' | 'admin';
  setActiveView: (view: 'rider' | 'driver' | 'admin') => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  walletBalance,
  unreadNotifications,
  socketConnected,
  onSwitchRole,
  onOpenWallet,
  onOpenNotifications,
  onOpenAuth,
  onLogout,
  activeView,
  setActiveView,
}) => {
  const [roleDropdownOpen, setRoleDropdownOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo & Tagline */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setActiveView('rider')}>
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
              <Car className="h-6 w-6 stroke-[2.2]" />
            </div>
            <div>
              <span className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-1">
                Creem<span className="text-emerald-600">Y</span>
              </span>
              <span className="hidden sm:inline-block text-[10px] text-slate-400 font-medium -mt-1 block">
                منصة النقل الذكية
              </span>
            </div>
          </div>

          {/* Real-time Socket Indicator */}
          <div
            className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              socketConnected
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
            title={socketConnected ? 'متصل بالخادم في الوقت الحقيقي' : 'جاري إعادة الاتصال...'}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                socketConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            <span className="text-[11px] font-sans">
              {socketConnected ? 'Live Socket' : 'Connecting'}
            </span>
          </div>
        </div>

        {/* Center: Mode / View Switcher Tabs */}
        <div className="hidden sm:flex items-center bg-slate-100/80 p-1 rounded-xl border border-slate-200 text-sm font-medium">
          <button
            onClick={() => {
              setActiveView('rider');
              if (currentUser?.role !== 'RIDER') onSwitchRole('RIDER');
            }}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-2 ${
              activeView === 'rider'
                ? 'bg-white text-emerald-700 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <User className="h-4 w-4" />
            الراكب (Rider)
          </button>
          <button
            onClick={() => {
              setActiveView('driver');
              if (currentUser?.role !== 'DRIVER') onSwitchRole('DRIVER');
            }}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-2 ${
              activeView === 'driver'
                ? 'bg-white text-emerald-700 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Car className="h-4 w-4" />
            الكابتن (Driver)
          </button>
          <button
            onClick={() => {
              setActiveView('admin');
              if (currentUser?.role !== 'ADMIN') onSwitchRole('ADMIN');
            }}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-2 ${
              activeView === 'admin'
                ? 'bg-white text-emerald-700 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            لوحة الإدارة (Admin)
          </button>
        </div>

        {/* Right Actions: Wallet, Notifications, Role Switcher */}
        <div className="flex items-center gap-2.5">
          {/* Wallet Balance Pill */}
          {currentUser && (
            <button
              onClick={onOpenWallet}
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100/80 text-emerald-800 rounded-xl border border-emerald-200 transition-colors text-xs sm:text-sm font-semibold shadow-xs"
            >
              <Wallet className="h-4 w-4 text-emerald-600" />
              <span>{walletBalance.toFixed(1)} SAR</span>
            </button>
          )}

          {/* Notifications Bell */}
          <button
            onClick={onOpenNotifications}
            className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
            title="الإشعارات"
          >
            <Bell className="h-5 w-5" />
            {unreadNotifications > 0 && (
              <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </span>
            )}
          </button>

          {/* Quick Demo Switcher Dropdown */}
          <div className="relative">
            <button
              onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
              className="flex items-center gap-2 p-1.5 pr-2.5 pl-2 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all text-xs font-medium text-slate-800"
            >
              {currentUser?.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.name}
                  className="h-7 w-7 rounded-lg object-cover ring-1 ring-emerald-500"
                />
              ) : (
                <div className="h-7 w-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                  {currentUser?.name?.[0] || 'U'}
                </div>
              )}
              <div className="hidden lg:block text-right">
                <div className="font-semibold text-slate-900 leading-tight">
                  {currentUser?.name || 'زائر'}
                </div>
                <div className="text-[10px] text-slate-400 capitalize">
                  {currentUser?.role === 'RIDER'
                    ? 'راكب'
                    : currentUser?.role === 'DRIVER'
                    ? 'كابتن'
                    : 'مدير النظام'}
                </div>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>

            {/* Dropdown Menu */}
            {roleDropdownOpen && (
              <div
                className="absolute left-0 sm:right-0 sm:left-auto mt-2 w-64 rounded-2xl bg-white shadow-2xl border border-slate-200/80 p-2 z-50 text-sm"
                onClick={() => setRoleDropdownOpen(false)}
              >
                <div className="px-3 py-2 border-b border-slate-100">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    التبديل الفوري بين أدوار Demo
                  </div>
                </div>

                <div className="py-1 space-y-1">
                  <button
                    onClick={() => {
                      onSwitchRole('RIDER');
                      setActiveView('rider');
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-right hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                        س
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800 text-xs">سارة المنصور</div>
                        <div className="text-[10px] text-slate-400">حساب الراكب (Rider)</div>
                      </div>
                    </div>
                    {currentUser?.role === 'RIDER' && (
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    )}
                  </button>

                  <button
                    onClick={() => {
                      onSwitchRole('DRIVER');
                      setActiveView('driver');
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-right hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
                        ف
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800 text-xs">كابتن فيصل العتيبي</div>
                        <div className="text-[10px] text-slate-400">حساب الكابتن (Driver - Lexus VIP)</div>
                      </div>
                    </div>
                    {currentUser?.role === 'DRIVER' && (
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    )}
                  </button>

                  <button
                    onClick={() => {
                      onSwitchRole('ADMIN');
                      setActiveView('admin');
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-right hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                        ع
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800 text-xs">عبدالله المشرف</div>
                        <div className="text-[10px] text-slate-400">لوحة التحكم المركزية (Admin)</div>
                      </div>
                    </div>
                    {currentUser?.role === 'ADMIN' && (
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    )}
                  </button>
                </div>

                <div className="pt-2 mt-1 border-t border-slate-100 space-y-1">
                  <button
                    onClick={onOpenAuth}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-600 hover:bg-slate-50 transition-colors text-right"
                  >
                    <User className="h-4 w-4 text-slate-400" />
                    تسجيل دخول / إنشاء حساب مخصص
                  </button>
                  <button
                    onClick={onLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-rose-600 hover:bg-rose-50 transition-colors text-right"
                  >
                    <LogOut className="h-4 w-4" />
                    تسجيل الخروج
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
