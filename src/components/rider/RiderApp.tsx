import React, { useState, useEffect, useCallback } from 'react';
import {
  LocationCoordinate,
  VehicleCategory,
  IRide,
  PaymentMethod,
  IUser,
} from '../../types';
import { api } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { MapView } from '../map/MapView';
import {
  Car,
  Navigation,
  Clock,
  CreditCard,
  Wallet,
  Coins,
  Star,
  MessageSquare,
  Phone,
  XCircle,
  CheckCircle2,
  MapPin,
  Search,
  Crosshair,
  AlertCircle,
} from 'lucide-react';

interface RiderAppProps {
  currentUser: IUser | null;
  onOpenAuth: () => void;
  onOpenWallet: () => void;
  onOpenChat: (rideId: string) => void;
  walletBalance: number;
}

const RIYADH_PRESETS: { name: string; coord: LocationCoordinate }[] = [
  {
    name: 'برج المملكة - العليا',
    coord: { lat: 24.7112, lng: 46.6744, address: 'برج المملكة - طريق العروبة، العليا' },
  },
  {
    name: 'مركز الملك عبدالله المالي (KAFD)',
    coord: { lat: 24.7743, lng: 46.6386, address: 'مركز الملك عبدالله المالي، الرياض' },
  },
  {
    name: 'مطار الملك خالد الدولي (KKIA)',
    coord: { lat: 24.9576, lng: 46.6988, address: 'مطار الملك خالد الدولي، صالة 4' },
  },
  {
    name: 'بوليفارد سيتي (Boulevard City)',
    coord: { lat: 24.7694, lng: 46.6022, address: 'حطين - طريق الأمير تركي بن عبدالعزيز الأول' },
  },
  {
    name: 'واجهة روشن (ROSHN Front)',
    coord: { lat: 24.8398, lng: 46.7289, address: 'واجهة الرياض - طريق المطار' },
  },
];

const CATEGORY_META: Record<
  VehicleCategory,
  { label: string; sub: string; icon: string }
> = {
  ECO: { label: 'Creem إيكو', sub: 'التوفير اليومي الذكي', icon: '🚗' },
  STANDARD: { label: 'Creem قياسي', sub: 'سيارات سيدان حديثة وفسيحة', icon: '🚘' },
  COMFORT: { label: 'Creem كمفورت', sub: 'هدوء وراحة إضافية وكباتن متميزون', icon: '🚙' },
  VIP: { label: 'Creem VIP بريميوم', sub: 'فئات فاخرة لأعلى رفاهية', icon: '✨' },
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  WALLET: 'المحفظة الإلكترونية',
  CREDIT_CARD: 'البطاقة البنكية',
  CASH: 'نقداً',
};

export const RiderApp: React.FC<RiderAppProps> = ({
  currentUser,
  onOpenAuth,
  onOpenWallet,
  onOpenChat,
  walletBalance,
}) => {
  const [pickup, setPickup] = useState<LocationCoordinate>(RIYADH_PRESETS[0].coord);
  const [destination, setDestination] = useState<LocationCoordinate>(RIYADH_PRESETS[1].coord);
  const [selectionMode, setSelectionMode] = useState<'pickup' | 'destination' | null>(null);

  const [searchTarget, setSearchTarget] = useState<'pickup' | 'destination'>('destination');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<LocationCoordinate[]>([]);
  const [searchingAddress, setSearchingAddress] = useState<boolean>(false);

  const [selectedCategory, setSelectedCategory] = useState<VehicleCategory>('STANDARD');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('WALLET');

  const [fareEstimates, setFareEstimates] = useState<any[]>([]);
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [durationMinutes, setDurationMinutes] = useState<number>(0);

  const [activeRide, setActiveRide] = useState<IRide | null>(null);
  const [loadingEstimates, setLoadingEstimates] = useState<boolean>(false);
  const [requestingRide, setRequestingRide] = useState<boolean>(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState<boolean>(false);

  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'error' | 'success' | 'info';
    text: string;
  } | null>(null);

  // Rating Modal state
  const [ratingModalRide, setRatingModalRide] = useState<IRide | null>(null);
  const [ratingStars, setRatingStars] = useState<number>(5);
  const [ratingComment, setRatingComment] = useState<string>('');
  const [selectedTip, setSelectedTip] = useState<number>(0);

  const fetchActiveRide = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await api.get<IRide | null>('/rides/active');
      if (res) {
        setActiveRide(res);
        const socket = getSocket();
        socket.emit('ride:join', { rideId: res.id });
      }
    } catch {
      // ignore if none
    }
  }, [currentUser]);

  useEffect(() => {
    fetchActiveRide();
  }, [fetchActiveRide]);

  // Fetch Fare Estimates when pickup / destination change
  useEffect(() => {
    if (!pickup || !destination || activeRide) return;

    let mounted = true;
    const fetchEstimates = async () => {
      setLoadingEstimates(true);
      try {
        const res = await api.post<{
          distanceKm: number;
          durationMinutes: number;
          estimates: any[];
        }>('/rides/estimate', {
          pickup,
          destination,
        });

        if (mounted && res) {
          setDistanceKm(res.distanceKm);
          setDurationMinutes(res.durationMinutes);
          setFareEstimates(res.estimates || []);
        }
      } catch {
        // ignore transient estimate failure
      } finally {
        if (mounted) setLoadingEstimates(false);
      }
    };

    fetchEstimates();
    return () => {
      mounted = false;
    };
  }, [pickup, destination, activeRide]);

  // Real-time Socket Event Listeners for Ride Status & Driver Movement
  useEffect(() => {
    if (!currentUser) return;
    const socket = getSocket();

    const handleStatusChanged = (data: { rideId: string; status: any; ride?: IRide }) => {
      if (activeRide && activeRide.id === data.rideId) {
        if (data.status === 'RIDE_COMPLETED') {
          setRatingModalRide(data.ride || activeRide);
          setActiveRide(null);
        } else if (data.status === 'CANCELLED' || data.status === 'NO_DRIVER_FOUND') {
          setFeedbackBanner({
            type: 'info',
            text:
              data.status === 'NO_DRIVER_FOUND'
                ? 'عذراً، لم يتم العثور على كباتن متاحين بالقرب منك حالياً.'
                : 'تم إلغاء الرحلة.',
          });
          setActiveRide(null);
        } else if (data.ride) {
          setActiveRide(data.ride);
        } else {
          setActiveRide((prev) => (prev ? { ...prev, status: data.status } : null));
        }
      } else if (!activeRide) {
        fetchActiveRide();
      }
    };

    const handleDriverMoved = (data: {
      rideId: string;
      location: { lat: number; lng: number; heading?: number };
    }) => {
      if (activeRide && activeRide.id === data.rideId) {
        setActiveRide((prev) =>
          prev
            ? {
                ...prev,
                currentDriverLocation: data.location,
              }
            : null
        );
      }
    };

    socket.on('ride:status_changed', handleStatusChanged);
    socket.on('driver:moved', handleDriverMoved);

    return () => {
      socket.off('ride:status_changed', handleStatusChanged);
      socket.off('driver:moved', handleDriverMoved);
    };
  }, [activeRide, currentUser, fetchActiveRide]);

  const handleUseCurrentLocation = () => {
    setFeedbackBanner(null);
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setFeedbackBanner({ type: 'error', text: 'المتصفح لا يدعم تحديد الموقع الجغرافي.' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        let address = `موقعي الحالي (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
        try {
          const revRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ar`
          );
          if (revRes.ok) {
            const revJson = await revRes.json();
            if (revJson.display_name) {
              address = revJson.display_name;
            }
          }
        } catch {
          // keep coordinate address fallback
        }
        setPickup({ lat, lng, address });
        setFeedbackBanner({ type: 'success', text: 'تم تحديث نقطة الانطلاق إلى موقعك الحالي.' });
      },
      (err) => {
        setFeedbackBanner({
          type: 'error',
          text: `تعذر تحديد الموقع الحالي: ${err.message}`,
        });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSearchAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearchingAddress(true);
    setSearchResults([]);
    setFeedbackBanner(null);

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=ar&q=${encodeURIComponent(
        searchQuery.trim()
      )}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('فشل البحث عن العنوان');
      const items = await res.json();
      const mapped: LocationCoordinate[] = (items || []).map((item: any) => ({
        lat: Number(item.lat),
        lng: Number(item.lon),
        address: item.display_name,
      }));
      setSearchResults(mapped);
      if (mapped.length === 0) {
        setFeedbackBanner({ type: 'info', text: 'لم يتم العثور على نتائج مطابقة.' });
      }
    } catch {
      setFeedbackBanner({
        type: 'error',
        text: 'تعذر البحث عن العنوان الآن، يمكنك التحديد مباشرة على الخريطة.',
      });
    } finally {
      setSearchingAddress(false);
    }
  };

  const handleSelectMapLocation = (
    coord: { lat: number; lng: number; address: string },
    type: 'pickup' | 'destination'
  ) => {
    if (type === 'pickup') {
      setPickup(coord);
    } else {
      setDestination(coord);
    }
    setSelectionMode(null);
  };

  // Request Ride Handler
  const handleRequestRide = async () => {
    setFeedbackBanner(null);
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    if (walletBalance < 10 && paymentMethod === 'WALLET') {
      setFeedbackBanner({
        type: 'error',
        text: 'رصيد المحفظة غير كافٍ. يرجى شحن المحفظة أو اختيار طريقة دفع أخرى.',
      });
      onOpenWallet();
      return;
    }

    setRequestingRide(true);
    try {
      const ride = await api.post<IRide>('/rides/request', {
        pickup,
        destination,
        vehicleCategory: selectedCategory,
        paymentMethod,
      });

      setActiveRide(ride);
      const socket = getSocket();
      socket.emit('ride:join', { rideId: ride.id });
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', text: err.message || 'فشل في طلب الرحلة' });
    } finally {
      setRequestingRide(false);
    }
  };

  // Cancel Ride Handler
  const handleConfirmCancelRide = async () => {
    if (!activeRide) return;
    try {
      await api.post(`/rides/${activeRide.id}/cancel`, {
        reason: 'إلغاء من قبل الراكب',
      });
      setActiveRide(null);
      setConfirmCancelOpen(false);
      setFeedbackBanner({ type: 'info', text: 'تم إلغاء الرحلة بنجاح.' });
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', text: err.message || 'تعذر إلغاء الرحلة' });
    }
  };

  // Submit Rating & Review Handler
  const handleSubmitRating = async () => {
    if (!ratingModalRide) return;
    setFeedbackBanner(null);
    try {
      await api.post(`/rides/${ratingModalRide.id}/rate`, {
        stars: ratingStars,
        comment: ratingComment,
      });

      if (selectedTip > 0) {
        await api.post('/payments/process', {
          rideId: ratingModalRide.id,
          amount: selectedTip,
          paymentMethod: 'WALLET',
        });
      }

      setRatingModalRide(null);
      setRatingStars(5);
      setRatingComment('');
      setSelectedTip(0);
      setFeedbackBanner({
        type: 'success',
        text: 'شكراً لتقييمك! نسعى دائماً لتقديم أفضل تجربة تنقل في Creem.',
      });
    } catch (err: any) {
      setFeedbackBanner({ type: 'error', text: err.message || 'تعذر إرسال التقييم' });
    }
  };

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full flex flex-col md:flex-row overflow-hidden bg-slate-50">
      {/* Side Panel: Booking Controls & Active Ride Tracking */}
      <div className="w-full md:w-[460px] lg:w-[500px] h-auto md:h-full bg-white z-20 flex flex-col shadow-2xl border-l border-slate-200 overflow-y-auto">
        {/* Header Ribbon */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-bold text-slate-800">
              {activeRide ? 'رحلتك الحالية' : 'حجز رحلة جديدة'}
            </span>
          </div>
          <div className="text-xs text-slate-400 font-medium">Creem للتنقل الذكي</div>
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

        {/* ACTIVE RIDE VIEW */}
        {activeRide ? (
          <div className="p-5 flex-1 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-900 to-slate-900 text-white shadow-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                      {activeRide.status === 'REQUESTED' && 'جاري معالجة الطلب...'}
                      {activeRide.status === 'SEARCHING_DRIVER' && 'جاري البحث عن أقرب كابتن...'}
                      {activeRide.status === 'DRIVER_ASSIGNED' && 'تم قبول الرحلة من الكابتن'}
                      {activeRide.status === 'DRIVER_ARRIVING' && 'الكابتن في طريقه إليك'}
                      {activeRide.status === 'DRIVER_ARRIVED' && 'الكابتن وصل إلى موقع الركوب'}
                      {activeRide.status === 'RIDE_STARTED' && 'الرحلة جارية الآن'}
                    </span>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-white/10 font-mono">
                    #{activeRide.id.slice(-6)}
                  </span>
                </div>

                <div className="flex items-baseline justify-between pt-1">
                  <div>
                    <div className="text-2xl font-black">{activeRide.estimatedFare.toFixed(1)} SAR</div>
                    <div className="text-xs text-slate-300">
                      الدفع عبر {PAYMENT_LABELS[activeRide.paymentMethod]}
                    </div>
                  </div>
                  <div className="text-left text-xs text-emerald-300 flex items-center gap-1 font-medium">
                    <Clock className="h-3.5 w-3.5" />
                    <span>~{activeRide.durationMinutes} دقيقة للوصول</span>
                  </div>
                </div>
              </div>

              {/* Driver Details Card (when assigned) */}
              {activeRide.driver ? (
                <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {activeRide.driver.avatarUrl ? (
                        <img
                          src={activeRide.driver.avatarUrl}
                          alt={activeRide.driver.name || 'كابتن'}
                          className="h-14 w-14 rounded-2xl object-cover ring-2 ring-emerald-500 shadow-sm"
                        />
                      ) : (
                        <div className="h-14 w-14 rounded-2xl bg-emerald-100 text-emerald-700 font-black text-xl flex items-center justify-center ring-2 ring-emerald-500">
                          {activeRide.driver.name?.[0] || 'ك'}
                        </div>
                      )}
                      <div>
                        <h4 className="font-bold text-slate-900 text-base">
                          {activeRide.driver.name || 'كابتن Creem'}
                        </h4>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                          <span className="flex items-center gap-1 text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded">
                            <Star className="h-3 w-3 fill-amber-500" />
                            {activeRide.driver.rating.toFixed(1)}
                          </span>
                          <span>•</span>
                          <span>كابتن معتمد</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-left">
                      <div className="inline-block px-3 py-1.5 bg-slate-900 text-emerald-400 font-mono font-bold text-sm rounded-xl border border-slate-700 shadow-inner">
                        {activeRide.driver.vehicle?.plateNumber || 'غير متوفر'}
                      </div>
                      {(activeRide.driver.vehicle?.make || activeRide.driver.vehicle?.model) && (
                        <div className="text-[11px] text-slate-500 text-right mt-1 font-medium">
                          {activeRide.driver.vehicle?.make} {activeRide.driver.vehicle?.model}
                          {activeRide.driver.vehicle?.color ? ` - ${activeRide.driver.vehicle.color}` : ''}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Driver Contact Buttons */}
                  <div className={`grid ${activeRide.driver.phone ? 'grid-cols-2' : 'grid-cols-1'} gap-2 pt-1`}>
                    <button
                      onClick={() => onOpenChat(activeRide.id)}
                      className="py-2.5 px-3 bg-white hover:bg-emerald-50 text-slate-800 rounded-xl border border-slate-200 font-medium text-xs flex items-center justify-center gap-2 transition-colors shadow-xs"
                    >
                      <MessageSquare className="h-4 w-4 text-emerald-600" />
                      محادثة الكابتن
                    </button>
                    {activeRide.driver.phone && (
                      <a
                        href={`tel:${activeRide.driver.phone}`}
                        className="py-2.5 px-3 bg-white hover:bg-emerald-50 text-slate-800 rounded-xl border border-slate-200 font-medium text-xs flex items-center justify-center gap-2 transition-colors shadow-xs"
                      >
                        <Phone className="h-4 w-4 text-emerald-600" />
                        اتصال هاتفي
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-6 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/50 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center animate-bounce">
                    <Car className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800 text-sm">جاري تحديد أفضل كابتن قريب</div>
                    <div className="text-xs text-slate-500 mt-1">
                      نظام التوزيع الذكي يبحث عن أقرب كابتن متاح لموقعك
                    </div>
                  </div>
                </div>
              )}

              {/* Route Summary */}
              <div className="p-4 rounded-2xl border border-slate-200 space-y-3 text-xs">
                <div className="flex items-start gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 mt-1" />
                  <div>
                    <span className="font-bold text-slate-700">الانطلاق:</span>
                    <p className="text-slate-500">{activeRide.pickup.address}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 border-t border-slate-100 pt-2">
                  <span className="h-2 w-2 rounded-full bg-rose-500 mt-1" />
                  <div>
                    <span className="font-bold text-slate-700">الوجهة:</span>
                    <p className="text-slate-500">{activeRide.destination.address}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Cancel Confirmation or CTA */}
            {confirmCancelOpen ? (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-3">
                <p className="text-xs font-bold text-rose-900">
                  هل أنت متأكد من رغبتك في إلغاء هذه الرحلة؟
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmCancelRide}
                    className="py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold"
                  >
                    نعم، إلغاء الرحلة
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmCancelOpen(false)}
                    className="py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold"
                  >
                    تراجع
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmCancelOpen(true)}
                className="w-full py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2"
              >
                <XCircle className="h-4 w-4" />
                إلغاء الطلب
              </button>
            )}
          </div>
        ) : (
          /* BOOKING FORM VIEW */
          <div className="p-5 flex-1 flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              {/* Address Search Box */}
              <form onSubmit={handleSearchAddress} className="bg-slate-50 p-3 rounded-2xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                  <span>البحث عن عنوان أو تحديد على الخريطة</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setSearchTarget('pickup')}
                      className={`px-2 py-0.5 rounded-lg ${
                        searchTarget === 'pickup' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
                      }`}
                    >
                      الانطلاق
                    </button>
                    <button
                      type="button"
                      onClick={() => setSearchTarget('destination')}
                      className={`px-2 py-0.5 rounded-lg ${
                        searchTarget === 'destination' ? 'bg-rose-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
                      }`}
                    >
                      الوجهة
                    </button>
                  </div>
                </div>

                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Search className="h-3.5 w-3.5 absolute right-2.5 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="ابحث عن حي، شارع، أو معلم..."
                      className="w-full text-xs py-2 pr-8 pl-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={searchingAddress}
                    className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shrink-0"
                  >
                    {searchingAddress ? '...' : 'بحث'}
                  </button>
                </div>

                {searchResults.length > 0 && (
                  <div className="max-h-32 overflow-y-auto bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {searchResults.map((res, idx) => (
                      <button
                        key={`${res.lat}-${res.lng}-${idx}`}
                        type="button"
                        onClick={() => {
                          if (searchTarget === 'pickup') setPickup(res);
                          else setDestination(res);
                          setSearchResults([]);
                          setSearchQuery('');
                        }}
                        className="w-full text-right p-2 text-[11px] text-slate-700 hover:bg-emerald-50 transition-colors flex items-start gap-1.5"
                      >
                        <MapPin className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{res.address}</span>
                      </button>
                    ))}
                  </div>
                )}
              </form>

              {/* Pickup & Destination Inputs */}
              <div className="space-y-3 bg-slate-50/90 p-4 rounded-2xl border border-slate-200">
                {/* Pickup */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      نقطة الركوب
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleUseCurrentLocation}
                        className="text-[11px] font-bold text-emerald-700 hover:underline flex items-center gap-1"
                      >
                        <Crosshair className="h-3 w-3" />
                        موقعي الحالي
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectionMode(selectionMode === 'pickup' ? null : 'pickup')
                        }
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${
                          selectionMode === 'pickup'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-slate-600 border-slate-200'
                        }`}
                      >
                        تحديد بالخريطة
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-700 bg-white border border-slate-200 rounded-xl p-2 mb-1.5 truncate">
                    {pickup.address}
                  </div>
                  <select
                    className="w-full text-xs font-medium p-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    value={RIYADH_PRESETS.some((p) => p.coord.address === pickup.address) ? pickup.address : ''}
                    onChange={(e) => {
                      const found = RIYADH_PRESETS.find((p) => p.coord.address === e.target.value);
                      if (found) setPickup(found.coord);
                    }}
                  >
                    <option value="">اختر وجهة سريعة (اختياري)...</option>
                    {RIYADH_PRESETS.map((p) => (
                      <option key={p.name} value={p.coord.address}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Destination */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-rose-500" />
                      الوجهة
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectionMode(selectionMode === 'destination' ? null : 'destination')
                      }
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${
                        selectionMode === 'destination'
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-white text-slate-600 border-slate-200'
                      }`}
                    >
                      تحديد بالخريطة
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-700 bg-white border border-slate-200 rounded-xl p-2 mb-1.5 truncate">
                    {destination.address}
                  </div>
                  <select
                    className="w-full text-xs font-medium p-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    value={
                      RIYADH_PRESETS.some((p) => p.coord.address === destination.address)
                        ? destination.address
                        : ''
                    }
                    onChange={(e) => {
                      const found = RIYADH_PRESETS.find((p) => p.coord.address === e.target.value);
                      if (found) setDestination(found.coord);
                    }}
                  >
                    <option value="">اختر وجهة سريعة (اختياري)...</option>
                    {RIYADH_PRESETS.map((p) => (
                      <option key={p.name} value={p.coord.address}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Distance & ETA Badge */}
                {distanceKm > 0 && (
                  <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-200/60 font-medium">
                    <span className="flex items-center gap-1">
                      <Navigation className="h-3.5 w-3.5 text-emerald-600" />
                      المسافة: {distanceKm.toFixed(1)} كم
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      الوقت المقدر: ~{durationMinutes} دقيقة
                    </span>
                  </div>
                )}
              </div>

              {/* Vehicle Category Selector Cards */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>اختر فئة الرحلة</span>
                  <span className="text-[11px] text-emerald-600 font-semibold">أسعار شفافة وفورية</span>
                </div>

                <div className="space-y-2">
                  {(['ECO', 'STANDARD', 'COMFORT', 'VIP'] as VehicleCategory[]).map((cat) => {
                    const estimate = fareEstimates.find((e) => e.category === cat);
                    const meta = CATEGORY_META[cat];
                    const isSelected = selectedCategory === cat;

                    return (
                      <div
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`p-3 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-50/50 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="text-2xl">{meta.icon}</div>
                          <div>
                            <div className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                              {meta.label}
                              {cat === 'VIP' && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold">
                                  بريميوم
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400">{meta.sub}</div>
                          </div>
                        </div>

                        <div className="text-left">
                          <div className="text-sm font-black text-slate-900">
                            {estimate ? `${estimate.estimatedFare.toFixed(1)} SAR` : '--'}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {durationMinutes ? `~${durationMinutes} دقيقة` : '--'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Payment Method Selector */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-700">طريقة الدفع</div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('WALLET')}
                    className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1.5 transition-all ${
                      paymentMethod === 'WALLET'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 font-bold'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <Wallet className="h-4 w-4" />
                    <span>المحفظة ({walletBalance.toFixed(0)} SAR)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('CREDIT_CARD')}
                    className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1.5 transition-all ${
                      paymentMethod === 'CREDIT_CARD'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 font-bold'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <CreditCard className="h-4 w-4" />
                    <span>بطاقة مدى / ائتمان</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('CASH')}
                    className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1.5 transition-all ${
                      paymentMethod === 'CASH'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 font-bold'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <Coins className="h-4 w-4" />
                    <span>نقداً للكابتن</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Request Ride CTA */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={requestingRide || loadingEstimates}
                onClick={handleRequestRide}
                className="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-2xl font-bold text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99]"
              >
                {requestingRide ? (
                  <>
                    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    جاري إرسال الطلب لأقرب الكباتن...
                  </>
                ) : (
                  <>
                    <Car className="h-5 w-5" />
                    اطلب {CATEGORY_META[selectedCategory].label} الآن
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Center Stage: Interactive Live Map */}
      <div className="flex-1 h-[400px] md:h-full relative">
        <MapView
          pickup={activeRide ? activeRide.pickup : pickup}
          destination={activeRide ? activeRide.destination : destination}
          driverLocation={activeRide?.currentDriverLocation || null}
          selectionMode={activeRide ? null : selectionMode}
          onSelectLocation={handleSelectMapLocation}
          className="h-full w-full"
        />
      </div>

      {/* RIDE COMPLETED & RATING MODAL */}
      {ratingModalRide && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-6 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="h-16 w-16 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-10 w-10" />
            </div>

            <div className="space-y-1">
              <h3 className="text-xl font-black text-slate-900">وصلت لوجهتك بسلام!</h3>
              <p className="text-xs text-slate-500">نتمنى أن تكون استمتعت برحلتك مع كابتن Creem</p>
            </div>

            {/* Fare Summary */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>أجرة الرحلة الإجمالية:</span>
                <span className="text-base font-black text-slate-900">
                  {(ratingModalRide.finalFare || ratingModalRide.estimatedFare).toFixed(1)} SAR
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>طريقة الدفع:</span>
                <span className="font-semibold text-emerald-700">
                  {PAYMENT_LABELS[ratingModalRide.paymentMethod]}
                </span>
              </div>
            </div>

            {/* Tip Selection */}
            <div className="space-y-2 text-right">
              <div className="text-xs font-bold text-slate-700">إكرامية الكابتن (اختيارية عبر المحفظة)</div>
              <div className="grid grid-cols-4 gap-2">
                {[0, 5, 10, 15].map((tip) => (
                  <button
                    key={tip}
                    type="button"
                    onClick={() => setSelectedTip(tip)}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      selectedTip === tip
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {tip === 0 ? 'بدون' : `+${tip} SAR`}
                  </button>
                ))}
              </div>
            </div>

            {/* Star Rating */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700">كيف كانت تجربتك مع الكابتن؟</div>
              <div className="flex items-center justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRatingStars(star)}
                    className="p-1 text-amber-400 hover:scale-125 transition-transform"
                  >
                    <Star
                      className={`h-8 w-8 ${
                        star <= ratingStars ? 'fill-amber-400 text-amber-400' : 'text-slate-200'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Comment */}
            <textarea
              rows={2}
              value={ratingComment}
              onChange={(e) => setRatingComment(e.target.value)}
              placeholder="اكتب ملاحظة لطيفة للكابتن (اختياري)..."
              className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
            />

            {/* Submit */}
            <button
              type="button"
              onClick={handleSubmitRating}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-xs shadow-lg shadow-emerald-600/30 transition-colors"
            >
              إرسال التقييم وإنهاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
