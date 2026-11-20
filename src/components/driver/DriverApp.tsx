import React, { useState, useEffect, useCallback } from 'react';
import { IDriver, IRide, IUser, RideStatus, VehicleCategory } from '../../types';
import { api } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { MapView } from '../map/MapView';
import {
  Power,
  DollarSign,
  Star,
  Navigation,
  CheckCircle2,
  MessageSquare,
  Phone,
  TrendingUp,
  AlertCircle,
  Car,
} from 'lucide-react';

interface DriverAppProps {
  currentUser: IUser | null;
  onOpenAuth: () => void;
  onOpenChat: (rideId: string) => void;
}

export const DriverApp: React.FC<DriverAppProps> = ({
  currentUser,
  onOpenAuth,
  onOpenChat,
}) => {
  const [driver, setDriver] = useState<IDriver | null>(null);
  const [driverRides, setDriverRides] = useState<IRide[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [activeRide, setActiveRide] = useState<IRide | null>(null);
  const [incomingOffer, setIncomingOffer] = useState<any | null>(null);
  const [offerCountdown, setOfferCountdown] = useState<number>(15);
  const [loadingAction, setLoadingAction] = useState<boolean>(false);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'error' | 'success' | 'info';
    text: string;
  } | null>(null);

  // Onboarding form state
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [licenseNumber, setLicenseNumber] = useState<string>('');
  const [make, setMake] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [color, setColor] = useState<string>('');
  const [plateNumber, setPlateNumber] = useState<string>('');
  const [category, setCategory] = useState<VehicleCategory>('STANDARD');

  const fetchDriverProfile = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await api.get<IDriver>('/drivers/me');
      setDriver(res);
      setIsOnline(Boolean(res.isOnline));
      setLicenseNumber(res.licenseNumber || '');
      if (res.vehicle) {
        setMake(res.vehicle.make || '');
        setModel(res.vehicle.model || '');
        setYear(res.vehicle.year || new Date().getFullYear());
        setColor(res.vehicle.color || '');
        setPlateNumber(res.vehicle.plateNumber || '');
        setCategory(res.vehicle.category || 'STANDARD');
      }
    } catch {
      // May not have driver profile if admin previewing
    }
  }, [currentUser]);

  const fetchDriverRides = useCallback(async () => {
    if (!currentUser) return;
    try {
      const rides = await api.get<IRide[]>('/drivers/rides');
      setDriverRides(rides || []);
    } catch {
      // ignore
    }
  }, [currentUser]);

  const fetchActiveRide = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await api.get<IRide | null>('/rides/active');
      if (res) {
        setActiveRide(res);
        const socket = getSocket();
        socket.emit('ride:join', { rideId: res.id });
      } else {
        setActiveRide(null);
      }
    } catch {
      // ignore
    }
  }, [currentUser]);

  useEffect(() => {
    fetchDriverProfile();
    fetchDriverRides();
    fetchActiveRide();
  }, [fetchDriverProfile, fetchDriverRides, fetchActiveRide]);

  // Listen to Socket events for new ride offers & status changes
  useEffect(() => {
    if (!currentUser) return;
    const socket = getSocket();

    const handleIncomingOffer = (data: any) => {
      setIncomingOffer(data);
      const remainingSeconds = data.expiresAt
        ? Math.max(1, Math.ceil((new Date(data.expiresAt).getTime() - Date.now()) / 1000))
        : 20;
      setOfferCountdown(remainingSeconds);
    };

    const handleStatusChanged = (data: { rideId: string; status: RideStatus; ride?: IRide }) => {
      if (activeRide && activeRide.id === data.rideId) {
        if (data.status === 'RIDE_COMPLETED' || data.status === 'CANCELLED') {
          setActiveRide(null);
          fetchDriverProfile();
          fetchDriverRides();
        } else if (data.ride) {
          setActiveRide(data.ride);
        } else {
          setActiveRide((prev) => (prev ? { ...prev, status: data.status } : null));
        }
      }
    };

    socket.on('ride:new_offer', handleIncomingOffer);
    socket.on('ride:incoming_request', handleIncomingOffer);
    socket.on('ride:status_changed', handleStatusChanged);

    return () => {
      socket.off('ride:new_offer', handleIncomingOffer);
      socket.off('ride:incoming_request', handleIncomingOffer);
      socket.off('ride:status_changed', handleStatusChanged);
    };
  }, [activeRide, currentUser, fetchDriverProfile, fetchDriverRides]);

  // Countdown timer for incoming offer
  useEffect(() => {
    if (!incomingOffer) return;
    if (offerCountdown <= 0) {
      setIncomingOffer(null);
      return;
    }
    const timer = setInterval(() => setOfferCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [incomingOffer, offerCountdown]);

  // Real device GPS tracking when online
  useEffect(() => {
    if (!isOnline || !currentUser) return;

    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const updatedLoc = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading || 0,
            updatedAt: new Date().toISOString(),
          };
          const socket = getSocket();
          socket.emit('driver:location_update', updatedLoc);

          setDriver((prev) => (prev ? { ...prev, currentLocation: updatedLoc } : null));
          if (activeRide) {
            setActiveRide((prev) =>
              prev ? { ...prev, currentDriverLocation: updatedLoc } : null
            );
          }
        },
        (err) => {
          console.warn('[Driver GPS] Geolocation watch error:', err.message);
        },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, [isOnline, activeRide?.id, currentUser]);

  // Toggle Online/Offline
  const handleToggleOnline = async () => {
    setFeedbackBanner(null);
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    try {
      const newStatus = !isOnline;
      await api.put('/drivers/status', { isOnline: newStatus });
      setIsOnline(newStatus);
      if (driver) setDriver({ ...driver, isOnline: newStatus });
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', text: err.message || 'تعذر تغيير حالة الاتصال' });
    }
  };

  // Accept Ride Offer
  const handleAcceptOffer = async () => {
    if (!incomingOffer) return;
    setLoadingAction(true);
    setFeedbackBanner(null);
    try {
      const ride = await api.post<IRide>(`/rides/${incomingOffer.rideId}/accept`);
      setActiveRide(ride);
      setIncomingOffer(null);
      const socket = getSocket();
      socket.emit('ride:join', { rideId: ride.id });
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        text: err.message || 'عذراً، تم قبول الطلب من قبل كابتن آخر أو انتهت صلاحيته',
      });
      setIncomingOffer(null);
    } finally {
      setLoadingAction(false);
    }
  };

  // Real Decline Ride Offer wired to backend dispatch endpoint
  const handleDeclineOffer = async () => {
    if (!incomingOffer) return;
    const offerToDecline = incomingOffer;
    setIncomingOffer(null);
    try {
      await api.post(`/rides/${offerToDecline.rideId}/decline`, {
        offerId: offerToDecline.offerId,
      });
    } catch {
      // Offer may have expired in the meantime
    }
  };

  // Transition Ride State
  const handleTransitionRide = async (nextStatus: RideStatus) => {
    if (!activeRide) return;
    setLoadingAction(true);
    setFeedbackBanner(null);
    try {
      const updated = await api.post<IRide>(`/rides/${activeRide.id}/transition`, {
        status: nextStatus,
      });
      if (nextStatus === 'RIDE_COMPLETED') {
        setActiveRide(null);
        await Promise.all([fetchDriverProfile(), fetchDriverRides()]);
        setFeedbackBanner({
          type: 'success',
          text: 'تم إكمال الرحلة بنجاح وتحديث سجل أرباحك!',
        });
      } else {
        setActiveRide(updated);
      }
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', text: err.message || 'فشل في تحديث حالة الرحلة' });
    } finally {
      setLoadingAction(false);
    }
  };

  // Save Driver Vehicle Onboarding
  const handleSubmitOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingAction(true);
    setFeedbackBanner(null);
    try {
      const updated = await api.put<IDriver>('/drivers/onboarding', {
        licenseNumber,
        vehicle: {
          make,
          model,
          year: Number(year),
          color,
          plateNumber,
          category,
        },
      });
      setDriver(updated);
      setShowOnboarding(false);
      setFeedbackBanner({
        type: 'success',
        text: 'تم حفظ بيانات المركبة والرخصة بنجاح.',
      });
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', text: err.message || 'تعذر حفظ بيانات المركبة' });
    } finally {
      setLoadingAction(false);
    }
  };

  // Compute genuine today earnings and completed count from real rides
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const completedToday = driverRides.filter(
    (r) =>
      r.status === 'RIDE_COMPLETED' &&
      new Date(r.completedAt || r.updatedAt).getTime() >= todayStart.getTime()
  );
  const todayNetEarnings = completedToday.reduce(
    (sum, r) => sum + Math.round(((r.finalFare ?? r.estimatedFare ?? 0) * 0.8) * 100) / 100,
    0
  );

  const needsVehicleOnboarding =
    driver && (!driver.vehicle?.make || !driver.vehicle?.plateNumber || showOnboarding);

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full flex flex-col md:flex-row overflow-hidden bg-slate-100">
      {/* Sidebar: Captain Cockpit & Stats */}
      <div className="w-full md:w-[460px] lg:w-[480px] h-auto md:h-full bg-white z-20 flex flex-col shadow-2xl border-l border-slate-200 overflow-y-auto">
        {/* Captain Identity & Online Toggle */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-3">
            {driver?.userAvatar ? (
              <img
                src={driver.userAvatar}
                alt={driver.userName || 'كابتن'}
                className="h-12 w-12 rounded-2xl object-cover ring-2 ring-emerald-400"
              />
            ) : (
              <div className="h-12 w-12 rounded-2xl bg-emerald-600 text-white font-black text-lg flex items-center justify-center ring-2 ring-emerald-400">
                {driver?.userName?.[0] || currentUser?.name?.[0] || 'ك'}
              </div>
            )}
            <div>
              <h3 className="font-bold text-base leading-tight">
                {driver?.userName || currentUser?.name || 'لوحة الكابتن'}
              </h3>
              <div className="flex items-center gap-2 text-xs text-slate-300 mt-0.5">
                <span className="flex items-center gap-1 text-amber-400 font-bold">
                  <Star className="h-3 w-3 fill-amber-400" />
                  {(driver?.rating ?? 5.0).toFixed(2)}
                </span>
                <span>•</span>
                <span>{driver?.totalRides ?? 0} رحلة منجزة</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleToggleOnline}
            className={`px-4 py-2 rounded-2xl font-bold text-xs flex items-center gap-2 transition-all shadow-md ${
              isOnline
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
            }`}
          >
            <Power className="h-4 w-4" />
            {isOnline ? 'متاح الآن' : 'غير متصل'}
          </button>
        </div>

        {feedbackBanner && (
          <div
            className={`mx-4 mt-3 p-3 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 ${
              feedbackBanner.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : feedbackBanner.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-sky-50 border-sky-200 text-sky-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{feedbackBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              className="text-slate-400 hover:text-slate-700 font-bold"
            >
              ×
            </button>
          </div>
        )}

        {/* Approval warning when driver is PENDING or REJECTED */}
        {driver && driver.approvalStatus !== 'APPROVED' && (
          <div className="mx-5 mt-4 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
            <div className="font-bold">
              حالة اعتماد الحساب:{' '}
              {driver.approvalStatus === 'PENDING'
                ? 'قيد مراجعة الإدارة'
                : driver.approvalStatus === 'REJECTED'
                ? 'مرفوض'
                : 'موقوف'}
            </div>
            <p className="opacity-85">
              يجب إكمال بيانات المركبة واعتماد الحساب من قبل الإدارة قبل التمكن من استقبال الطلبات.
            </p>
          </div>
        )}

        {/* ACTIVE RIDE CONTROLS */}
        {activeRide ? (
          <div className="p-5 flex-1 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold bg-emerald-600 text-white px-2.5 py-0.5 rounded-full">
                    مرحلة الرحلة الحالية
                  </span>
                  <span className="font-mono text-xs font-bold text-emerald-800">
                    أجرة مقدرة: {activeRide.estimatedFare.toFixed(1)} SAR
                  </span>
                </div>

                <div className="text-sm font-bold text-slate-900 pt-1">
                  {activeRide.status === 'DRIVER_ASSIGNED' && 'توجه إلى موقع الراكب'}
                  {activeRide.status === 'DRIVER_ARRIVING' && 'في الطريق إلى نقطة الالتقاء'}
                  {activeRide.status === 'DRIVER_ARRIVED' && 'أنت الآن في موقع الراكب (بانتظار الصعود)'}
                  {activeRide.status === 'RIDE_STARTED' && 'الرحلة جارية نحو الوجهة النهائية'}
                </div>
              </div>

              {/* Rider Info Card */}
              <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {activeRide.rider?.avatarUrl ? (
                      <img
                        src={activeRide.rider.avatarUrl}
                        alt={activeRide.rider.name}
                        className="h-12 w-12 rounded-xl object-cover ring-1 ring-slate-300"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-xl bg-slate-100 text-slate-700 font-black flex items-center justify-center">
                        {activeRide.rider?.name?.[0] || 'ر'}
                      </div>
                    )}
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">
                        {activeRide.rider?.name || 'راكب Creem'}
                      </h4>
                      <div className="text-xs text-slate-400">
                        طريقة الدفع:{' '}
                        {activeRide.paymentMethod === 'WALLET'
                          ? 'المحفظة الإلكترونية'
                          : activeRide.paymentMethod === 'CREDIT_CARD'
                          ? 'البطاقة البنكية'
                          : 'نقداً'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenChat(activeRide.id)}
                      className="p-2.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl transition-colors"
                      title="محادثة الراكب"
                    >
                      <MessageSquare className="h-5 w-5" />
                    </button>
                    {activeRide.rider?.phone && (
                      <a
                        href={`tel:${activeRide.rider.phone}`}
                        className="p-2.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl transition-colors"
                        title="اتصال بالراكب"
                      >
                        <Phone className="h-5 w-5" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
                  <div>
                    <span className="font-bold text-slate-700">الانطلاق: </span>
                    <span className="text-slate-500">{activeRide.pickup.address}</span>
                  </div>
                  <div>
                    <span className="font-bold text-slate-700">الوجهة: </span>
                    <span className="text-slate-500">{activeRide.destination.address}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* State Machine Action Controls */}
            <div className="space-y-2 pt-4 border-t border-slate-100">
              {['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(activeRide.status) && (
                <button
                  type="button"
                  disabled={loadingAction}
                  onClick={() => handleTransitionRide('DRIVER_ARRIVED')}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all"
                >
                  <CheckCircle2 className="h-5 w-5" />
                  وصلت إلى نقطة الالتقاء بالراكب
                </button>
              )}

              {activeRide.status === 'DRIVER_ARRIVED' && (
                <button
                  type="button"
                  disabled={loadingAction}
                  onClick={() => handleTransitionRide('RIDE_STARTED')}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all"
                >
                  <Navigation className="h-5 w-5" />
                  صعد الراكب - بدء الرحلة الآن
                </button>
              )}

              {activeRide.status === 'RIDE_STARTED' && (
                <button
                  type="button"
                  disabled={loadingAction}
                  onClick={() => handleTransitionRide('RIDE_COMPLETED')}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all"
                >
                  <CheckCircle2 className="h-5 w-5" />
                  وصلنا للوجهة - إنهاء الرحلة وتحصيل الأجرة
                </button>
              )}
            </div>
          </div>
        ) : (
          /* IDLE CAPTAIN DASHBOARD */
          <div className="p-5 flex-1 flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              {/* Radar Status Banner */}
              <div
                className={`p-4 rounded-2xl border transition-all ${
                  isOnline
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-slate-100 border-slate-200 text-slate-600'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                      isOnline ? 'bg-emerald-600 text-white animate-pulse' : 'bg-slate-300 text-slate-600'
                    }`}
                  >
                    <Navigation className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">
                      {isOnline ? 'رادار الطلبات نشط' : 'أنت في وضع غير متصل'}
                    </h4>
                    <p className="text-xs opacity-80 mt-0.5">
                      {isOnline
                        ? 'أنت جاهز لاستقبال طلبات الركاب القريبة'
                        : 'قم بتفعيل زر الاتصال للبدء في استقبال المشاوير'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Real Computed Earnings & Performance Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                    أرباح اليوم
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    {todayNetEarnings.toFixed(1)} SAR
                  </div>
                  <div className="text-[10px] text-slate-500 font-semibold">
                    {completedToday.length} رحلة مكتملة اليوم
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5 text-indigo-600" />
                    إجمالي الأرباح
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    {(driver?.earningsTotal ?? 0).toFixed(1)} SAR
                  </div>
                  <div className="text-[10px] text-slate-500 font-semibold">
                    {(driver?.outstandingDebt ?? 0) > 0
                      ? `مديونية عمولة: ${(driver?.outstandingDebt ?? 0).toFixed(1)} SAR`
                      : 'لا توجد مستحقات معلقة'}
                  </div>
                </div>
              </div>

              {/* Vehicle Onboarding / Details Card */}
              {needsVehicleOnboarding ? (
                <form
                  onSubmit={handleSubmitOnboarding}
                  className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Car className="h-4 w-4 text-emerald-600" />
                      تسجيل بيانات المركبة ورخصة القيادة
                    </div>
                    {driver?.vehicle && (
                      <button
                        type="button"
                        onClick={() => setShowOnboarding(false)}
                        className="text-slate-500 hover:text-slate-800"
                      >
                        إلغاء
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      placeholder="رقم رخصة القيادة"
                      className="p-2 bg-white border border-slate-200 rounded-xl col-span-2"
                    />
                    <input
                      type="text"
                      required
                      value={make}
                      onChange={(e) => setMake(e.target.value)}
                      placeholder="الشركة المصنعة (مثل: تويوتا)"
                      className="p-2 bg-white border border-slate-200 rounded-xl"
                    />
                    <input
                      type="text"
                      required
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="الموديل (مثل: كامري)"
                      className="p-2 bg-white border border-slate-200 rounded-xl"
                    />
                    <input
                      type="number"
                      required
                      min={1995}
                      max={new Date().getFullYear() + 1}
                      value={year}
                      onChange={(e) => setYear(Number(e.target.value))}
                      placeholder="سنة الصنع"
                      className="p-2 bg-white border border-slate-200 rounded-xl"
                    />
                    <input
                      type="text"
                      required
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      placeholder="اللون"
                      className="p-2 bg-white border border-slate-200 rounded-xl"
                    />
                    <input
                      type="text"
                      required
                      value={plateNumber}
                      onChange={(e) => setPlateNumber(e.target.value)}
                      placeholder="رقم اللوحة"
                      className="p-2 bg-white border border-slate-200 rounded-xl"
                    />
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as VehicleCategory)}
                      className="p-2 bg-white border border-slate-200 rounded-xl"
                    >
                      <option value="ECO">ECO</option>
                      <option value="STANDARD">STANDARD</option>
                      <option value="COMFORT">COMFORT</option>
                      <option value="VIP">VIP</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={loadingAction}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold"
                  >
                    {loadingAction ? 'جاري الحفظ...' : 'حفظ بيانات المركبة'}
                  </button>
                </form>
              ) : (
                <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-slate-700">بيانات المركبة والترخيص</div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          driver?.approvalStatus === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {driver?.approvalStatus === 'APPROVED' ? 'معتمد رسمياً' : 'بانتظار الاعتماد'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowOnboarding(true)}
                        className="text-[11px] font-bold text-indigo-600 hover:underline"
                      >
                        تعديل
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">السيارة:</span>
                    <span className="font-bold text-slate-900">
                      {driver?.vehicle
                        ? `${driver.vehicle.make} ${driver.vehicle.model} (${driver.vehicle.category})`
                        : 'غير مسجلة بعد'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">رقم اللوحة:</span>
                    <span className="font-mono font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-800">
                      {driver?.vehicle?.plateNumber || 'غير مسجل'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">رخصة القيادة:</span>
                    <span className="font-mono text-slate-700">
                      {driver?.licenseNumber || 'غير مسجلة'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="text-center text-xs text-slate-400 p-3">
              نظام التوزيع الذكي Creem يقوم بفرز الطلبات وإرسالها وفق القرب الجغرافي والتقييم.
            </div>
          </div>
        )}
      </div>

      {/* Map Radar Stage */}
      <div className="flex-1 h-[400px] md:h-full relative">
        <MapView
          pickup={activeRide?.pickup}
          destination={activeRide?.destination}
          driverLocation={driver?.currentLocation || null}
          className="h-full w-full"
        />
      </div>

      {/* INCOMING RIDE OFFER MODAL */}
      {incomingOffer && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-5 text-right animate-in fade-in zoom-in-95 duration-200 border-2 border-emerald-500">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-emerald-500 animate-ping" />
                <h3 className="font-black text-slate-900 text-lg">طلب رحلة جديدة!</h3>
              </div>
              <div className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm font-mono ring-2 ring-emerald-500">
                {offerCountdown}s
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 flex items-center justify-between">
              <div>
                <div className="text-xs text-emerald-800 font-medium">الأجرة المقدرة للرحلة:</div>
                <div className="text-2xl font-black text-emerald-950">
                  {Number(incomingOffer.estimatedFare || 0).toFixed(1)} SAR
                </div>
              </div>
              <div className="text-left text-xs text-slate-600 space-y-0.5">
                <div>المسافة: {Number(incomingOffer.distanceKm || 0).toFixed(1)} كم</div>
                <div>المدة: ~{incomingOffer.durationMinutes || 10} دقيقة</div>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-start gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 mt-1" />
                <div>
                  <div className="font-bold text-slate-800">نقطة الركوب:</div>
                  <div className="text-slate-500">{incomingOffer.pickup?.address}</div>
                </div>
              </div>
              <div className="flex items-start gap-2 border-t border-slate-100 pt-2">
                <span className="h-2 w-2 rounded-full bg-rose-500 mt-1" />
                <div>
                  <div className="font-bold text-slate-800">الوجهة:</div>
                  <div className="text-slate-500">{incomingOffer.destination?.address}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                disabled={loadingAction}
                onClick={handleAcceptOffer}
                className="py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-emerald-600/30 transition-all active:scale-95"
              >
                قبول الطلب فوراً
              </button>
              <button
                type="button"
                onClick={handleDeclineOffer}
                className="py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm transition-all"
              >
                رفض الطلب
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
