import React, { useState, useEffect } from 'react';
import { IDriver, IRide, RideStatus } from '../../types';
import { api } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { MapView } from '../map/MapView';
import {
  Car,
  Power,
  DollarSign,
  Star,
  Clock,
  Navigation,
  CheckCircle2,
  AlertTriangle,
  MessageSquare,
  Phone,
  ArrowRight,
  TrendingUp,
  Award
} from 'lucide-react';

interface DriverAppProps {
  onOpenChat: (rideId: string) => void;
}

export const DriverApp: React.FC<DriverAppProps> = ({ onOpenChat }) => {
  const [driver, setDriver] = useState<IDriver | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [activeRide, setActiveRide] = useState<IRide | null>(null);
  const [incomingOffer, setIncomingOffer] = useState<any | null>(null);
  const [offerCountdown, setOfferCountdown] = useState<number>(15);
  const [loadingAction, setLoadingAction] = useState<boolean>(false);

  // Fetch driver profile
  const fetchDriverProfile = async () => {
    try {
      const res = await api.get<IDriver>('/drivers/me');
      setDriver(res);
      setIsOnline(res.isOnline);
    } catch (err) {
      console.error('Error fetching driver profile:', err);
    }
  };

  // Fetch active ride
  const fetchActiveRide = async () => {
    try {
      const res = await api.get<IRide | null>('/rides/active');
      if (res) {
        setActiveRide(res);
        const socket = getSocket();
        socket.emit('ride:join', { rideId: res.id });
      } else {
        setActiveRide(null);
      }
    } catch (err) {
      console.error('Error fetching driver active ride:', err);
    }
  };

  useEffect(() => {
    fetchDriverProfile();
    fetchActiveRide();
  }, []);

  // Listen to Socket events for new ride offers
  useEffect(() => {
    const socket = getSocket();

    const handleIncomingOffer = (data: any) => {
      console.log('[Socket] Incoming ride offer for driver:', data);
      setIncomingOffer(data);
      setOfferCountdown(15);
    };

    const handleStatusChanged = (data: { rideId: string; status: RideStatus; ride?: IRide }) => {
      if (activeRide && activeRide.id === data.rideId) {
        if (data.status === 'RIDE_COMPLETED' || data.status === 'CANCELLED') {
          setActiveRide(null);
          fetchDriverProfile();
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
  }, [activeRide]);

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

  // Toggle Online/Offline
  const handleToggleOnline = async () => {
    try {
      const newStatus = !isOnline;
      await api.put('/drivers/status', { isOnline: newStatus });
      setIsOnline(newStatus);
      if (driver) setDriver({ ...driver, isOnline: newStatus });
    } catch (err: any) {
      alert(err.message || 'تعذر تغيير حالة الاتصال');
    }
  };

  // Accept Ride Offer
  const handleAcceptOffer = async () => {
    if (!incomingOffer) return;
    setLoadingAction(true);
    try {
      const ride = await api.post<IRide>(`/rides/${incomingOffer.rideId}/accept`);
      setActiveRide(ride);
      setIncomingOffer(null);
      const socket = getSocket();
      socket.emit('ride:join', { rideId: ride.id });
    } catch (err: any) {
      alert(err.message || 'عذراً، تم قبول الطلب من قبل كابتن آخر أو انتهت صلاحيته');
      setIncomingOffer(null);
    } finally {
      setLoadingAction(false);
    }
  };

  // Decline Ride Offer
  const handleDeclineOffer = () => {
    setIncomingOffer(null);
  };

  // Transition Ride State (State Machine)
  const handleTransitionRide = async (nextStatus: RideStatus) => {
    if (!activeRide) return;
    setLoadingAction(true);
    try {
      const updated = await api.post<IRide>(`/rides/${activeRide.id}/transition`, {
        status: nextStatus,
      });
      if (nextStatus === 'RIDE_COMPLETED') {
        setActiveRide(null);
        fetchDriverProfile();
        alert('تم إكمال الرحلة بنجاح وإيداع الأرباح في محفظتك!');
      } else {
        setActiveRide(updated);
      }
    } catch (err: any) {
      alert(err.message || 'فشل في تحديث حالة الرحلة');
    } finally {
      setLoadingAction(false);
    }
  };

  // Driver GPS simulation step
  const simulateMovement = () => {
    if (!activeRide || !driver?.currentLocation) return;
    const target =
      activeRide.status === 'RIDE_STARTED' ? activeRide.destination : activeRide.pickup;

    const newLat = driver.currentLocation.lat + (target.lat - driver.currentLocation.lat) * 0.25;
    const newLng = driver.currentLocation.lng + (target.lng - driver.currentLocation.lng) * 0.25;

    const updatedLoc = {
      lat: newLat,
      lng: newLng,
      heading: 90,
      updatedAt: new Date().toISOString(),
    };

    const socket = getSocket();
    socket.emit('driver:location_update', updatedLoc);

    setDriver((prev) => (prev ? { ...prev, currentLocation: updatedLoc } : null));
    if (activeRide) {
      setActiveRide((prev) => (prev ? { ...prev, currentDriverLocation: updatedLoc } : null));
    }
  };

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full flex flex-col md:flex-row overflow-hidden bg-slate-100">
      {/* Sidebar: Captain Cockpit & Stats */}
      <div className="w-full md:w-[460px] lg:w-[480px] h-auto md:h-full bg-white z-20 flex flex-col shadow-2xl border-l border-slate-200 overflow-y-auto">
        {/* Captain Identity & Online Toggle */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-3">
            <img
              src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150"
              alt="Captain"
              className="h-12 w-12 rounded-2xl object-cover ring-2 ring-emerald-400"
            />
            <div>
              <h3 className="font-bold text-base leading-tight">كابتن فيصل العتيبي</h3>
              <div className="flex items-center gap-2 text-xs text-slate-300 mt-0.5">
                <span className="flex items-center gap-1 text-amber-400 font-bold">
                  <Star className="h-3 w-3 fill-amber-400" />
                  {driver?.rating.toFixed(2) || '4.95'}
                </span>
                <span>•</span>
                <span>{driver?.totalRides || 184} رحلة منجزة</span>
              </div>
            </div>
          </div>

          <button
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

        {/* ACTIVE RIDE CONTROLS (when driver is on a ride) */}
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
                    <img
                      src={
                        activeRide.rider?.avatarUrl ||
                        'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150'
                      }
                      alt="Rider"
                      className="h-12 w-12 rounded-xl object-cover ring-1 ring-slate-300"
                    />
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">
                        {activeRide.rider?.name || 'سارة المنصور'}
                      </h4>
                      <div className="text-xs text-slate-400">
                        طريقة الدفع:{' '}
                        {activeRide.paymentMethod === 'WALLET' ? 'المحفظة الإلكترونية' : 'نقداً'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onOpenChat(activeRide.id)}
                      className="p-2.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl transition-colors"
                      title="محادثة الراكب"
                    >
                      <MessageSquare className="h-5 w-5" />
                    </button>
                    <a
                      href={`tel:${activeRide.rider?.phone || '+966500000002'}`}
                      className="p-2.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl transition-colors"
                      title="اتصال بالراكب"
                    >
                      <Phone className="h-5 w-5" />
                    </a>
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

              {/* GPS Movement Simulator Button for Demo/Testing */}
              <button
                onClick={simulateMovement}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-colors border border-slate-200"
              >
                <Navigation className="h-4 w-4 text-emerald-600" />
                محاكاة تقدم الكابتن على الخريطة (GPS Step)
              </button>
            </div>

            {/* State Machine Action Controls */}
            <div className="space-y-2 pt-4 border-t border-slate-100">
              {['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(activeRide.status) && (
                <button
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
          <div className="p-5 flex-1 flex flex-col justify-between space-y-6">
            <div className="space-y-5">
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
                        ? 'أنت جاهز لاستقبال طلبات الركاب القريبة في الرياض'
                        : 'قم بتفعيل زر الاتصال للبدء في استقبال المشاوير'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Earnings & Performance Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                    أرباح اليوم
                  </div>
                  <div className="text-xl font-black text-slate-900">420.0 SAR</div>
                  <div className="text-[10px] text-emerald-600 font-semibold">+18% مقارنة بأمس</div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5 text-indigo-600" />
                    إجمالي الرصيد
                  </div>
                  <div className="text-xl font-black text-slate-900">
                    {driver?.earningsTotal || 4850} SAR
                  </div>
                  <div className="text-[10px] text-indigo-600 font-semibold">جاهز للتحويل البنكي</div>
                </div>
              </div>

              {/* Vehicle & Compliance Details */}
              <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-700">بيانات المركبة والترخيص</div>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">
                    معتمد رسمياً
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">السيارة:</span>
                  <span className="font-bold text-slate-900">
                    {driver?.vehicle?.make || 'Lexus'} {driver?.vehicle?.model || 'ES 350'} (
                    {driver?.vehicle?.category || 'VIP'})
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">رقم اللوحة:</span>
                  <span className="font-mono font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-800">
                    {driver?.vehicle?.plateNumber || 'ك ر م 2026'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">رخصة القيادة:</span>
                  <span className="font-mono text-slate-700">{driver?.licenseNumber || 'LIC-892401'}</span>
                </div>
              </div>
            </div>

            {/* Idle notice */}
            <div className="text-center text-xs text-slate-400 p-3">
              نظام التوزيع الذكي CreemY يقوم بفرز الطلبات وإرسالها وفق القرب الجغرافي والتقييم.
            </div>
          </div>
        )}
      </div>

      {/* Map Radar Stage */}
      <div className="flex-1 h-[400px] md:h-full relative">
        <MapView
          pickup={activeRide?.pickup}
          destination={activeRide?.destination}
          driverLocation={driver?.currentLocation}
          className="h-full w-full"
        />
      </div>

      {/* INCOMING RIDE OFFER MODAL */}
      {incomingOffer && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-5 text-right animate-in fade-in zoom-in-95 duration-200 border-2 border-emerald-500">
            {/* Countdown Ring */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-emerald-500 animate-ping" />
                <h3 className="font-black text-slate-900 text-lg">طلب رحلة جديدة!</h3>
              </div>
              <div className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm font-mono ring-2 ring-emerald-500">
                {offerCountdown}s
              </div>
            </div>

            {/* Offer Fare & Details */}
            <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 flex items-center justify-between">
              <div>
                <div className="text-xs text-emerald-800 font-medium">صافي دخل الكابتن المقدر:</div>
                <div className="text-2xl font-black text-emerald-950">
                  {incomingOffer.estimatedFare.toFixed(1)} SAR
                </div>
              </div>
              <div className="text-left text-xs text-slate-600 space-y-0.5">
                <div>المسافة: {incomingOffer.distanceKm.toFixed(1)} كم</div>
                <div>المدة: ~{incomingOffer.durationMinutes} دقيقة</div>
              </div>
            </div>

            {/* Locations */}
            <div className="space-y-3 text-xs">
              <div className="flex items-start gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 mt-1" />
                <div>
                  <div className="font-bold text-slate-800">نقطة الركوب:</div>
                  <div className="text-slate-500">{incomingOffer.pickup.address}</div>
                </div>
              </div>
              <div className="flex items-start gap-2 border-t border-slate-100 pt-2">
                <span className="h-2 w-2 rounded-full bg-rose-500 mt-1" />
                <div>
                  <div className="font-bold text-slate-800">الوجهة:</div>
                  <div className="text-slate-500">{incomingOffer.destination.address}</div>
                </div>
              </div>
            </div>

            {/* Accept / Decline CTA */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                disabled={loadingAction}
                onClick={handleAcceptOffer}
                className="py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-emerald-600/30 transition-all active:scale-95"
              >
                قبول الطلب فوراً
              </button>
              <button
                onClick={handleDeclineOffer}
                className="py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl font-bold text-sm transition-all"
              >
                تجاهل
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
