import React from 'react';
import { IUser } from '../../types';
import {
  Car,
  ShieldCheck,
  User,
  Wallet,
  Bell,
  LogOut,
  ChevronDown,
  LogIn,
} from 'lucide-react';

interface HeaderProps {
  currentUser: IUser | null;
  walletBalance: number;
  unreadNotifications: number;
  socketConnected: boolean;
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
  onOpenWallet,
  onOpenNotifications,
  onOpenAuth,
  onLogout,
  activeView,
  setActiveView,
}) => {
  const [profileDropdownOpen, setProfileDropdownOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo & Tagline */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2.5 cursor-pointer"
            onClick={() => setActiveView(currentUser?.role === 'DRIVER' ? 'driver' : 'rider')}
          >
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
            title={socketConnected ? 'متصل بالخادم في الوقت الحقيقي' : 'جاري الاتصال...'}
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

        {/* Center: Authorized View Switcher */}
        {currentUser && (
          <div className="hidden sm:flex items-center bg-slate-100/80 p-1 rounded-xl border border-slate-200 text-sm font-medium">
            {(currentUser.role === 'RIDER' || currentUser.role === 'ADMIN') && (
              <button
                onClick={() => setActiveView('rider')}
                className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-2 ${
                  activeView === 'rider'
                    ? 'bg-white text-emerald-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <User className="h-4 w-4" />
                الراكب (Rider)
              </button>
            )}

            {(currentUser.role === 'DRIVER' || currentUser.role === 'ADMIN') && (
              <button
                onClick={() => setActiveView('driver')}
                className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-2 ${
                  activeView === 'driver'
                    ? 'bg-white text-emerald-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Car className="h-4 w-4" />
                الكابتن (Driver)
              </button>
            )}

            {currentUser.role === 'ADMIN' && (
              <button
                onClick={() => setActiveView('admin')}
                className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-2 ${
                  activeView === 'admin'
                    ? 'bg-white text-emerald-700 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
                لوحة الإدارة (Admin)
              </button>
            )}
          </div>
        )}

        {/* Right Actions: Wallet, Notifications, Profile / Login */}
        <div className="flex items-center gap-2.5">
          {currentUser ? (
            <>
              {/* Wallet Balance Pill */}
              <button
                onClick={onOpenWallet}
                className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100/80 text-emerald-800 rounded-xl border border-emerald-200 transition-colors text-xs sm:text-sm font-semibold shadow-xs"
              >
                <Wallet className="h-4 w-4 text-emerald-600" />
                <span>{walletBalance.toFixed(1)} SAR</span>
              </button>

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

              {/* User Profile Menu */}
              <div className="relative">
                <button
                  onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                  className="flex items-center gap-2 p-1.5 pr-2.5 pl-2 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all text-xs font-medium text-slate-800"
                >
                  {currentUser.avatarUrl ? (
                    <img
                      src={currentUser.avatarUrl}
                      alt={currentUser.name}
                      className="h-7 w-7 rounded-lg object-cover ring-1 ring-emerald-500"
                    />
                  ) : (
                    <div className="h-7 w-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                      {currentUser.name?.[0] || 'U'}
                    </div>
                  )}
                  <div className="hidden lg:block text-right">
                    <div className="font-semibold text-slate-900 leading-tight">
                      {currentUser.name}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {currentUser.role === 'RIDER'
                        ? 'راكب معتمد'
                        : currentUser.role === 'DRIVER'
                        ? 'كابتن معتمد'
                        : 'مدير النظام'}
                    </div>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                </button>

                {profileDropdownOpen && (
                  <div
                    className="absolute left-0 sm:right-0 sm:left-auto mt-2 w-56 rounded-2xl bg-white shadow-2xl border border-slate-200/80 p-2 z-50 text-sm"
                    onClick={() => setProfileDropdownOpen(false)}
                  >
                    <div className="px-3 py-2 border-b border-slate-100 text-right">
                      <div className="font-bold text-slate-900 text-xs">{currentUser.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">{currentUser.email}</div>
                    </div>

                    <div className="pt-2 space-y-1">
                      <button
                        onClick={onOpenWallet}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-700 hover:bg-slate-50 transition-colors text-right"
                      >
                        <Wallet className="h-4 w-4 text-slate-400" />
                        المحفظة والرصيد
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
            </>
          ) : (
            <button
              onClick={onOpenAuth}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-md shadow-emerald-600/20 transition-all"
            >
              <LogIn className="h-4 w-4" />
              تسجيل الدخول
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
