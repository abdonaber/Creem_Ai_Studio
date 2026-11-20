import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import {
  IDriver,
  IRide,
  IUser,
  IAuditLog,
  IPaginationMeta,
  IReconciliationReport,
  IPlatformLedgerEntry,
} from '../../types';
import { MapView } from '../map/MapView';
import {
  ShieldCheck,
  TrendingUp,
  DollarSign,
  Car,
  Users,
  Activity,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  X,
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'fleet' | 'drivers' | 'rides' | 'users' | 'reconciliation' | 'audit'
  >('overview');

  const [stats, setStats] = useState<any>(null);
  const [drivers, setDrivers] = useState<IDriver[]>([]);
  const [driversPage, setDriversPage] = useState<IPaginationMeta>({
    total: 0,
    page: 1,
    totalPages: 1,
    limit: 15,
  });
  const [driverFilterStatus, setDriverFilterStatus] = useState<string>('');

  const [rides, setRides] = useState<IRide[]>([]);
  const [ridesPage, setRidesPage] = useState<IPaginationMeta>({
    total: 0,
    page: 1,
    totalPages: 1,
    limit: 15,
  });
  const [rideFilterStatus, setRideFilterStatus] = useState<string>('');

  const [users, setUsers] = useState<IUser[]>([]);
  const [usersPage, setUsersPage] = useState<IPaginationMeta>({
    total: 0,
    page: 1,
    totalPages: 1,
    limit: 15,
  });
  const [userSearch, setUserSearch] = useState<string>('');
  const [userFilterRole, setUserFilterRole] = useState<string>('');

  const [auditLogs, setAuditLogs] = useState<IAuditLog[]>([]);
  const [reconciliation, setReconciliation] = useState<IReconciliationReport | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<IPlatformLedgerEntry[]>([]);
  const [runningAudit, setRunningAudit] = useState<boolean>(false);

  // Refund modal state
  const [refundRide, setRefundRide] = useState<IRide | null>(null);
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [refundReason, setRefundReason] = useState<string>('');
  const [refundLoading, setRefundLoading] = useState<boolean>(false);

  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const fetchDrivers = useCallback(async (page = 1, approvalStatus = driverFilterStatus) => {
    const params = new URLSearchParams({ page: String(page), limit: '15' });
    if (approvalStatus) params.set('approvalStatus', approvalStatus);
    const res = await api.getPaginated<IDriver>(`/admin/drivers?${params.toString()}`);
    setDrivers(res.data);
    setDriversPage(res.pagination);
  }, [driverFilterStatus]);

  const fetchRides = useCallback(async (page = 1, status = rideFilterStatus) => {
    const params = new URLSearchParams({ page: String(page), limit: '15' });
    if (status) params.set('status', status);
    const res = await api.getPaginated<IRide>(`/admin/rides?${params.toString()}`);
    setRides(res.data);
    setRidesPage(res.pagination);
  }, [rideFilterStatus]);

  const fetchUsers = useCallback(async (page = 1, role = userFilterRole, search = userSearch) => {
    const params = new URLSearchParams({ page: String(page), limit: '15' });
    if (role) params.set('role', role);
    if (search.trim()) params.set('search', search.trim());
    const res = await api.getPaginated<IUser>(`/admin/users?${params.toString()}`);
    setUsers(res.data);
    setUsersPage(res.pagination);
  }, [userFilterRole, userSearch]);

  const fetchReconciliationData = useCallback(async () => {
    try {
      const [reconRes, ledgerRes] = await Promise.all([
        api.get<IReconciliationReport>('/admin/reconciliation'),
        api.get<IPlatformLedgerEntry[]>('/admin/ledger?limit=50'),
      ]);
      setReconciliation(reconRes);
      setLedgerEntries(ledgerRes || []);
    } catch (err: any) {
      setBanner({ type: 'error', text: err.message || 'تعذر تحميل بيانات التدقيق المالي' });
    }
  }, []);

  const fetchDashboardData = useCallback(async () => {
    try {
      const [statsRes, auditRes] = await Promise.all([
        api.get<any>('/admin/stats'),
        api.get<IAuditLog[]>('/admin/audit-logs?limit=50'),
      ]);
      setStats(statsRes);
      setAuditLogs(auditRes || []);
      await Promise.all([
        fetchDrivers(1, driverFilterStatus),
        fetchRides(1, rideFilterStatus),
        fetchUsers(1, userFilterRole, userSearch),
      ]);
    } catch (err: any) {
      setBanner({ type: 'error', text: err.message || 'تعذر تحميل بيانات لوحة التحكم' });
    }
  }, [driverFilterStatus, rideFilterStatus, userFilterRole, userSearch, fetchDrivers, fetchRides, fetchUsers]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (activeTab === 'reconciliation') {
      fetchReconciliationData();
    }
  }, [activeTab, fetchReconciliationData]);

  const handleApproveDriver = async (
    driverId: string,
    status: 'APPROVED' | 'REJECTED' | 'SUSPENDED'
  ) => {
    setBanner(null);
    try {
      await api.put(`/admin/drivers/${driverId}/approve`, { status });
      setBanner({ type: 'success', text: `تم تحديث حالة الكابتن إلى ${status}` });
      fetchDashboardData();
    } catch (err: any) {
      setBanner({ type: 'error', text: err.message || 'فشل تحديث حالة السائق' });
    }
  };

  const handleToggleUserStatus = async (userId: string, currentStatus: string) => {
    setBanner(null);
    const nextStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await api.put(`/admin/users/${userId}/status`, { status: nextStatus });
      setBanner({
        type: 'success',
        text: nextStatus === 'SUSPENDED' ? 'تم إيقاف الحساب وإنهاء جلساته فوراً' : 'تم تفعيل الحساب',
      });
      fetchUsers(usersPage.page);
    } catch (err: any) {
      setBanner({ type: 'error', text: err.message || 'فشل تحديث حالة المستخدم' });
    }
  };

  const handleRunReconciliation = async () => {
    setRunningAudit(true);
    setBanner(null);
    try {
      const report = await api.post<IReconciliationReport>('/admin/reconciliation/run');
      setReconciliation(report);
      setBanner({
        type: report.healthy ? 'success' : 'error',
        text: report.healthy
          ? 'التدقيق المالي سليم بالكامل (0 فروقات).'
          : `تم رصد ${report.discrepanciesCount} فرق مالي يتطلب المراجعة.`,
      });
    } catch (err: any) {
      setBanner({ type: 'error', text: err.message || 'فشل تشغيل التدقيق المالي' });
    } finally {
      setRunningAudit(false);
    }
  };

  const handleIssueRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundRide) return;
    setRefundLoading(true);
    setBanner(null);

    try {
      const payload: Record<string, any> = {
        reason: refundReason.trim() || 'Admin issued refund',
      };
      if (refundAmount.trim()) {
        payload.amount = Number(refundAmount);
      }
      const res = await api.post<any>(`/admin/rides/${refundRide.id}/refund`, payload);
      setBanner({
        type: 'success',
        text: `تم تسجيل طلب الاسترداد بنجاح (الحالة: ${res.status} — المبلغ: ${res.refundAmount} SAR).`,
      });
      setRefundRide(null);
      setRefundAmount('');
      setRefundReason('');
      fetchRides(ridesPage.page);
      fetchDashboardData();
    } catch (err: any) {
      setBanner({ type: 'error', text: err.message || 'تعذر تنفيذ الاسترداد المالي' });
    } finally {
      setRefundLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">
              لوحة التحكم المركزية والإشراف — Creem
            </h1>
            <p className="text-xs text-slate-500">
              إدارة الأسطول، التدقيق المالي، الاستردادات، ومراقبة العمليات الحية
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 text-xs font-semibold">
          {[
            { id: 'overview', label: 'المؤشرات العامة' },
            { id: 'fleet', label: 'خريطة الأسطول' },
            {
              id: 'drivers',
              label: `الكباتن (${drivers.filter((d) => d.approvalStatus === 'PENDING').length})`,
            },
            { id: 'rides', label: 'الرحلات والاسترداد' },
            { id: 'users', label: 'المستخدمين' },
            { id: 'reconciliation', label: 'التدقيق المالي' },
            { id: 'audit', label: 'سجلات الأمان' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-2 rounded-xl transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-indigo-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {banner && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-semibold flex items-center justify-between ${
            banner.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.type === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-slate-500 hover:text-slate-800 font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-wider">صافي حجم الرحلات (GMV)</span>
                <DollarSign className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="text-3xl font-black text-slate-900">
                {stats?.totalRevenue !== undefined ? `${Number(stats.totalRevenue).toFixed(1)} SAR` : '0.0 SAR'}
              </div>
              <div className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>عمولة المنصة 20%: {Number(stats?.platformRevenue || 0).toFixed(1)} SAR</span>
              </div>
            </div>

            <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-wider">الرحلات المكتملة</span>
                <Car className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="text-3xl font-black text-slate-900">
                {stats?.completedRidesCount || 0}
              </div>
              <div className="text-xs text-slate-500 font-medium">
                {stats?.activeRidesCount || 0} رحلة جارية الآن
              </div>
            </div>

            <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-wider">الكباتن المتاحين</span>
                <Activity className="h-5 w-5 text-amber-600" />
              </div>
              <div className="text-3xl font-black text-slate-900">
                {stats?.onlineDriversCount || 0} / {stats?.totalDriversCount || 0}
              </div>
              <div className="text-xs text-emerald-600 font-semibold">
                مستحقات السائقين المعلقة: {Number(stats?.outstandingDebt || 0).toFixed(1)} SAR
              </div>
            </div>

            <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-wider">المستخدمون المسجلون</span>
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div className="text-3xl font-black text-slate-900">
                {stats?.totalUsersCount || 0}
              </div>
              <div className="text-xs text-slate-500 font-medium">
                بين ركاب، كباتن، ومديري نظام
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 text-sm">توزيع الأسطول المباشر</h3>
                <button
                  type="button"
                  onClick={() => setActiveTab('fleet')}
                  className="text-xs text-indigo-600 font-bold hover:underline"
                >
                  عرض الخريطة الكاملة
                </button>
              </div>
              <div className="h-[280px] rounded-2xl overflow-hidden border border-slate-200">
                <MapView fleetDrivers={drivers} className="h-full w-full" />
              </div>
            </div>

            <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 text-sm">أحدث العمليات وسجلات الأمان</h3>
                <button
                  type="button"
                  onClick={() => setActiveTab('audit')}
                  className="text-xs text-indigo-600 font-bold hover:underline"
                >
                  جميع السجلات
                </button>
              </div>
              <div className="space-y-3">
                {auditLogs.slice(0, 5).map((log) => (
                  <div
                    key={log.id}
                    className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between text-xs gap-2"
                  >
                    <div className="min-w-0">
                      <span className="font-bold text-slate-800">{log.action}</span>
                      <p className="text-[11px] text-slate-400 font-mono truncate">
                        {JSON.stringify(log.details)}
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString('ar-SA')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FLEET TAB */}
      {activeTab === 'fleet' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">خريطة الكباتن المباشرة</h2>
              <p className="text-xs text-slate-500">
                تتبع حي لمواقع جميع الكباتن المتصلين وتحديثات الـ GPS في الوقت الفعلي
              </p>
            </div>
            <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              {drivers.filter((d) => d.isOnline).length} كابتن متاح
            </span>
          </div>

          <div className="h-[600px] rounded-2xl overflow-hidden border border-slate-200">
            <MapView fleetDrivers={drivers} className="h-full w-full" />
          </div>
        </div>
      )}

      {/* DRIVERS APPROVAL TAB */}
      {activeTab === 'drivers' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">
              إدارة واعتماد الكباتن ({driversPage.total})
            </h2>
            <select
              value={driverFilterStatus}
              onChange={(e) => {
                setDriverFilterStatus(e.target.value);
                fetchDrivers(1, e.target.value);
              }}
              className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl"
            >
              <option value="">جميع الحالات</option>
              <option value="PENDING">قيد المراجعة</option>
              <option value="APPROVED">معتمد</option>
              <option value="REJECTED">مرفوض</option>
              <option value="SUSPENDED">موقوف</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-200">
                <tr>
                  <th className="p-3">الكابتن</th>
                  <th className="p-3">المركبة</th>
                  <th className="p-3">رقم اللوحة</th>
                  <th className="p-3">التقييم</th>
                  <th className="p-3">الحالة الحالية</th>
                  <th className="p-3">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drivers.map((drv) => (
                  <tr key={drv.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-semibold text-slate-800">
                      <div>{drv.userName || 'كابتن'}</div>
                      <div className="text-[10px] text-slate-400">{drv.userPhone}</div>
                    </td>
                    <td className="p-3 text-slate-600">
                      {drv.vehicle
                        ? `${drv.vehicle.make} ${drv.vehicle.model} (${drv.vehicle.category})`
                        : 'غير مسجلة'}
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-800">
                      {drv.vehicle?.plateNumber || '—'}
                    </td>
                    <td className="p-3 text-amber-600 font-bold">⭐ {drv.rating.toFixed(1)}</td>
                    <td className="p-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          drv.approvalStatus === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : drv.approvalStatus === 'PENDING'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {drv.approvalStatus === 'APPROVED'
                          ? 'معتمد'
                          : drv.approvalStatus === 'PENDING'
                          ? 'قيد المراجعة'
                          : drv.approvalStatus}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        {drv.approvalStatus !== 'APPROVED' && (
                          <button
                            type="button"
                            onClick={() => handleApproveDriver(drv.id, 'APPROVED')}
                            className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition-colors"
                          >
                            اعتماد
                          </button>
                        )}
                        {drv.approvalStatus !== 'REJECTED' && (
                          <button
                            type="button"
                            onClick={() => handleApproveDriver(drv.id, 'REJECTED')}
                            className="px-2.5 py-1 bg-rose-50 text-rose-700 rounded-lg font-bold hover:bg-rose-100 transition-colors"
                          >
                            رفض
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PaginationControls
            meta={driversPage}
            onPageChange={(p) => fetchDrivers(p, driverFilterStatus)}
          />
        </div>
      )}

      {/* RIDES TAB */}
      {activeTab === 'rides' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">
              سجل وتفاصيل الرحلات ({ridesPage.total})
            </h2>
            <select
              value={rideFilterStatus}
              onChange={(e) => {
                setRideFilterStatus(e.target.value);
                fetchRides(1, e.target.value);
              }}
              className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl"
            >
              <option value="">جميع الحالات</option>
              <option value="SEARCHING_DRIVER">جاري البحث</option>
              <option value="RIDE_STARTED">جارية</option>
              <option value="RIDE_COMPLETED">مكتملة</option>
              <option value="CANCELLED">ملغاة</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-200">
                <tr>
                  <th className="p-3">معرف الرحلة</th>
                  <th className="p-3">الفئة</th>
                  <th className="p-3">الانطلاق</th>
                  <th className="p-3">الوجهة</th>
                  <th className="p-3">الأجرة والدفع</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">إجراء مالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rides.map((ride) => (
                  <tr key={ride.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-mono font-bold text-slate-900">#{ride.id.slice(-6)}</td>
                    <td className="p-3 font-medium text-slate-700">{ride.vehicleCategory}</td>
                    <td className="p-3 text-slate-600 max-w-[150px] truncate">{ride.pickup.address}</td>
                    <td className="p-3 text-slate-600 max-w-[150px] truncate">{ride.destination.address}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-900">
                        {(ride.finalFare || ride.estimatedFare).toFixed(1)} SAR
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {ride.paymentMethod} • {ride.paymentStatus}
                      </div>
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          ride.status === 'RIDE_COMPLETED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : ride.status === 'CANCELLED'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-indigo-100 text-indigo-800'
                        }`}
                      >
                        {ride.status}
                      </span>
                    </td>
                    <td className="p-3">
                      {(ride.paymentStatus === 'SUCCEEDED' ||
                        ride.paymentStatus === 'PARTIALLY_REFUNDED') && (
                        <button
                          type="button"
                          onClick={() => {
                            setRefundRide(ride);
                            setRefundAmount('');
                            setRefundReason('');
                          }}
                          className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg font-bold flex items-center gap-1"
                        >
                          <RotateCcw className="h-3 w-3" />
                          استرداد
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PaginationControls
            meta={ridesPage}
            onPageChange={(p) => fetchRides(p, rideFilterStatus)}
          />
        </div>
      )}

      {/* USERS TAB */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">
              إدارة المستخدمين والأذونات ({usersPage.total})
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute right-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') fetchUsers(1, userFilterRole, userSearch);
                  }}
                  placeholder="بحث بالاسم أو البريد..."
                  className="text-xs py-2 pr-8 pl-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
              <select
                value={userFilterRole}
                onChange={(e) => {
                  setUserFilterRole(e.target.value);
                  fetchUsers(1, e.target.value, userSearch);
                }}
                className="text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl"
              >
                <option value="">كل الأدوار</option>
                <option value="RIDER">راكب (RIDER)</option>
                <option value="DRIVER">كابتن (DRIVER)</option>
                <option value="ADMIN">مدير (ADMIN)</option>
              </select>
              <button
                type="button"
                onClick={() => fetchUsers(1, userFilterRole, userSearch)}
                className="px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold"
              >
                تطبيق
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-200">
                <tr>
                  <th className="p-3">الاسم</th>
                  <th className="p-3">البريد الإلكتروني</th>
                  <th className="p-3">الدور (Role)</th>
                  <th className="p-3">حالة الحساب</th>
                  <th className="p-3">إجراء أمني</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-semibold text-slate-900">{u.name}</td>
                    <td className="p-3 font-mono text-slate-500">{u.email}</td>
                    <td className="p-3 font-bold text-indigo-700">{u.role}</td>
                    <td className="p-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          u.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {u.status === 'ACTIVE' ? 'نشط' : 'موقوف'}
                      </span>
                    </td>
                    <td className="p-3">
                      {u.role !== 'ADMIN' && (
                        <button
                          type="button"
                          onClick={() => handleToggleUserStatus(u.id, u.status)}
                          className={`px-3 py-1 rounded-lg font-bold transition-colors ${
                            u.status === 'ACTIVE'
                              ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {u.status === 'ACTIVE' ? 'إيقاف الحساب' : 'تفعيل'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PaginationControls
            meta={usersPage}
            onPageChange={(p) => fetchUsers(p, userFilterRole, userSearch)}
          />
        </div>
      )}

      {/* FINANCIAL RECONCILIATION TAB */}
      {activeTab === 'reconciliation' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">التدقيق المالي ومطابقة الأستاذ العام</h2>
                <p className="text-xs text-slate-500">
                  التحقق من تطابق أرصدة المحافظ، عوائد الكباتن، العمولات، والاستردادات
                </p>
              </div>
              <button
                type="button"
                disabled={runningAudit}
                onClick={handleRunReconciliation}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${runningAudit ? 'animate-spin' : ''}`} />
                {runningAudit ? 'جاري التدقيق...' : 'تشغيل التدقيق الآن'}
              </button>
            </div>

            {reconciliation && (
              <div className="space-y-3">
                <div
                  className={`p-4 rounded-2xl border flex items-center justify-between ${
                    reconciliation.healthy
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm">
                    {reconciliation.healthy ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-rose-600" />
                    )}
                    <span>
                      {reconciliation.healthy
                        ? 'النظام المالي متوازن بالكامل'
                        : `تم رصد ${reconciliation.discrepanciesCount} عدم تطابق مالي`}
                    </span>
                  </div>
                  <span className="text-xs font-mono">
                    Discrepancies: {reconciliation.discrepanciesCount}
                  </span>
                </div>

                {reconciliation.discrepancies.length > 0 && (
                  <div className="space-y-2">
                    {reconciliation.discrepancies.map((d, idx) => (
                      <div
                        key={`${d.type}-${d.id}-${idx}`}
                        className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl text-xs space-y-1"
                      >
                        <div className="font-mono font-bold text-rose-800">
                          {d.type} — {d.id}
                        </div>
                        <div className="text-slate-700">{d.details}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-slate-900">أحدث قيود الأستاذ المالي (Platform Ledger)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-200">
                  <tr>
                    <th className="p-3">النوع</th>
                    <th className="p-3">الرحلة</th>
                    <th className="p-3">من حساب</th>
                    <th className="p-3">إلى حساب</th>
                    <th className="p-3">المبلغ</th>
                    <th className="p-3">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledgerEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="p-3 font-mono font-bold text-indigo-700">{entry.type}</td>
                      <td className="p-3 font-mono text-slate-600">#{entry.rideId.slice(-6)}</td>
                      <td className="p-3 font-mono text-slate-600">{entry.fromAccount}</td>
                      <td className="p-3 font-mono text-slate-600">{entry.toAccount}</td>
                      <td className="p-3 font-bold text-slate-900">
                        {entry.amount.toFixed(2)} {entry.currency}
                      </td>
                      <td className="p-3 font-mono text-slate-500">{entry.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* AUDIT LOGS TAB */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">سجلات الأمان والتدقيق الشامل</h2>
            <div className="text-xs text-slate-500">مراقبة الأحداث الأمنية والعمليات المالية</div>
          </div>

          <div className="space-y-2.5">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                      {log.action}
                    </span>
                    {log.userId && (
                      <span className="text-slate-500 font-mono text-[11px]">User: {log.userId}</span>
                    )}
                  </div>
                  <div className="text-slate-600 font-mono text-[11px] break-all">
                    {JSON.stringify(log.details)}
                  </div>
                </div>
                <div className="text-left font-mono text-[11px] text-slate-400 shrink-0">
                  {new Date(log.timestamp).toLocaleString('ar-SA')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* REFUND MODAL */}
      {refundRide && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4 text-right border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base">
                إصدار استرداد مالي للرحلة #{refundRide.id.slice(-6)}
              </h3>
              <button
                type="button"
                onClick={() => setRefundRide(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleIssueRefund} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 mb-1 block">
                  مبلغ الاسترداد (اتركه فارغاً للاسترداد الكامل: {(refundRide.finalFare || refundRide.estimatedFare).toFixed(2)} SAR)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={refundRide.finalFare || refundRide.estimatedFare}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder="اختياري — مثال: 15.50"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 mb-1 block">سبب الاسترداد</label>
                <input
                  type="text"
                  required
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="سبب إداري / شكوى راكب"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <button
                type="submit"
                disabled={refundLoading}
                className="w-full py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-xl font-bold"
              >
                {refundLoading ? 'جاري تنفيذ الاسترداد...' : 'تأكيد وإرسال الاسترداد'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const PaginationControls: React.FC<{
  meta: IPaginationMeta;
  onPageChange: (page: number) => void;
}> = ({ meta, onPageChange }) => {
  if (meta.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
      <div className="text-slate-500">
        صفحة {meta.page} من {meta.totalPages} (إجمالي {meta.total})
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
          className="px-3 py-1.5 rounded-xl border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
        >
          السابق
        </button>
        <button
          type="button"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
          className="px-3 py-1.5 rounded-xl border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
        >
          التالي
        </button>
      </div>
    </div>
  );
};
