import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { IDriver, IRide, IUser, IAuditLog } from '../../types';
import { MapView } from '../map/MapView';
import {
  ShieldCheck,
  TrendingUp,
  DollarSign,
  Car,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Search,
  Activity,
  FileText
} from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'fleet' | 'drivers' | 'rides' | 'users' | 'audit'>('overview');
  const [stats, setStats] = useState<any>(null);
  const [drivers, setDrivers] = useState<IDriver[]>([]);
  const [rides, setRides] = useState<IRide[]>([]);
  const [users, setUsers] = useState<IUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<IAuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [statsRes, driversRes, ridesRes, usersRes, auditRes] = await Promise.all([
        api.get<any>('/admin/stats'),
        api.get<IDriver[]>('/admin/drivers'),
        api.get<IRide[]>('/admin/rides'),
        api.get<IUser[]>('/admin/users'),
        api.get<IAuditLog[]>('/admin/audit-logs'),
      ]);

      setStats(statsRes);
      setDrivers(driversRes || []);
      setRides(ridesRes || []);
      setUsers(usersRes || []);
      setAuditLogs(auditRes || []);
    } catch (err) {
      console.error('Admin data fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleApproveDriver = async (driverId: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED') => {
    try {
      await api.put(`/admin/drivers/${driverId}/approve`, { status });
      fetchDashboardData();
    } catch (err: any) {
      alert(err.message || 'فشل تحديث حالة السائق');
    }
  };

  const handleToggleUserStatus = async (userId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await api.put(`/admin/users/${userId}/status`, { status: nextStatus });
      fetchDashboardData();
    } catch (err: any) {
      alert(err.message || 'فشل تحديث حالة المستخدم');
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900">
              لوحة التحكم المركزية والإشراف — CreemY
            </h1>
            <p className="text-xs text-slate-500">
              إدارة الأسطول، العمليات الحية، وتفويض الكباتن في الوقت الفعلي
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200 text-xs font-semibold">
          {[
            { id: 'overview', label: 'المؤشرات العامة' },
            { id: 'fleet', label: 'خريطة الأسطول الحية' },
            { id: 'drivers', label: `طلبات الكباتن (${drivers.filter((d) => d.approvalStatus === 'PENDING').length})` },
            { id: 'rides', label: 'الرحلات' },
            { id: 'users', label: 'المستخدمين' },
            { id: 'audit', label: 'سجلات الأمان' },
          ].map((tab) => (
            <button
              key={tab.id}
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

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-xs font-bold uppercase tracking-wider">إجمالي حجم الرحلات (GMV)</span>
                <DollarSign className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="text-3xl font-black text-slate-900">
                {stats?.totalRevenue ? `${stats.totalRevenue.toFixed(1)} SAR` : '0.0 SAR'}
              </div>
              <div className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>عمولة المنصة 20%: {stats?.platformRevenue || 0} SAR</span>
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
                جاهزون لاستقبال الطلبات الفورية
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

          {/* Quick Fleet & Ongoing Rides Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Live Mini Fleet Map */}
            <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 text-sm">توزيع الأسطول المباشر في الرياض</h3>
                <button
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

            {/* Recent Audit Log Feed */}
            <div className="p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900 text-sm">أحدث العمليات وسجلات الأمان</h3>
                <button
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
                    className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-800">{log.action}</span>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {JSON.stringify(log.details)}
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
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
              <h2 className="text-lg font-bold text-slate-900">خريطة الكباتن المباشرة في الرياض</h2>
              <p className="text-xs text-slate-500">
                تتبع حي لمواقع جميع الكباتن المتصلين وتحديثات الـ GPS في الوقت الفعلي
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                {drivers.filter((d) => d.isOnline).length} كابتن متاح
              </span>
            </div>
          </div>

          <div className="h-[600px] rounded-2xl overflow-hidden border border-slate-200">
            <MapView fleetDrivers={drivers} className="h-full w-full" />
          </div>
        </div>
      )}

      {/* DRIVERS APPROVAL TAB */}
      {activeTab === 'drivers' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">إدارة واعتماد الكباتن والأسطول</h2>
            <div className="text-xs text-slate-500">إجمالي الكباتن: {drivers.length}</div>
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
                      {drv.vehicle?.make} {drv.vehicle?.model} ({drv.vehicle?.category})
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
                          : 'مرفوض'}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        {drv.approvalStatus !== 'APPROVED' && (
                          <button
                            onClick={() => handleApproveDriver(drv.id, 'APPROVED')}
                            className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition-colors"
                          >
                            اعتماد
                          </button>
                        )}
                        {drv.approvalStatus !== 'REJECTED' && (
                          <button
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
        </div>
      )}

      {/* RIDES TAB */}
      {activeTab === 'rides' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">سجل وتفاصيل الرحلات</h2>
            <div className="text-xs text-slate-500">إجمالي الرحلات: {rides.length}</div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold border-y border-slate-200">
                <tr>
                  <th className="p-3">معرف الرحلة</th>
                  <th className="p-3">الفئة</th>
                  <th className="p-3">الانطلاق</th>
                  <th className="p-3">الوجهة</th>
                  <th className="p-3">الأجرة</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rides.map((ride) => (
                  <tr key={ride.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-mono font-bold text-slate-900">#{ride.id.slice(-6)}</td>
                    <td className="p-3 font-medium text-slate-700">{ride.vehicleCategory}</td>
                    <td className="p-3 text-slate-600 max-w-[150px] truncate">{ride.pickup.address}</td>
                    <td className="p-3 text-slate-600 max-w-[150px] truncate">{ride.destination.address}</td>
                    <td className="p-3 font-bold text-slate-900">
                      {(ride.finalFare || ride.estimatedFare).toFixed(1)} SAR
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
                    <td className="p-3 text-slate-400 font-mono">
                      {new Date(ride.createdAt).toLocaleDateString('ar-SA')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* USERS TAB */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">إدارة المستخدمين والأذونات</h2>
            <div className="text-xs text-slate-500">إجمالي الحسابات: {users.length}</div>
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
        </div>
      )}

      {/* AUDIT LOGS TAB */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">سجلات الأمان والتدقيق الشامل (Audit Logs)</h2>
            <div className="text-xs text-slate-500">مراقبة الأحداث الأمنية والعمليات المالية</div>
          </div>

          <div className="space-y-2.5">
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                      {log.action}
                    </span>
                    {log.userId && (
                      <span className="text-slate-500 font-mono text-[11px]">User: {log.userId}</span>
                    )}
                  </div>
                  <div className="text-slate-600 font-mono text-[11px]">
                    {JSON.stringify(log.details)}
                  </div>
                </div>
                <div className="text-left font-mono text-[11px] text-slate-400">
                  {new Date(log.timestamp).toLocaleString('ar-SA')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
