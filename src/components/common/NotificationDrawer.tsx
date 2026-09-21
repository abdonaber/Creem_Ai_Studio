import React, { useState, useEffect } from 'react';
import { INotification } from '../../types';
import { api } from '../../lib/api';
import { Bell, Check, X } from 'lucide-react';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshCount: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  isOpen,
  onClose,
  onRefreshCount,
}) => {
  const [notifications, setNotifications] = useState<INotification[]>([]);

  const fetchNotifications = async () => {
    try {
      const res = await api.get<INotification[]>('/users/notifications');
      setNotifications(res || []);
    } catch (err) {
      console.error('Fetch notifications error:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.put(`/users/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      onRefreshCount();
    } catch (err) {
      console.error('Mark read error:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4 text-right animate-in fade-in zoom-in-95 duration-200 border border-slate-200 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-emerald-600" />
            <h3 className="font-bold text-slate-900 text-base">مركز الإشعارات</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {notifications.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-10">لا توجد إشعارات جديدة</div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`p-3.5 rounded-2xl border text-xs transition-all space-y-1 ${
                  n.read
                    ? 'bg-white border-slate-100 opacity-70'
                    : 'bg-emerald-50/60 border-emerald-200 shadow-xs'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">{n.title}</span>
                  {!n.read && (
                    <button
                      onClick={() => handleMarkAsRead(n.id)}
                      className="text-[10px] text-emerald-700 font-bold flex items-center gap-1 hover:underline"
                    >
                      <Check className="h-3 w-3" />
                      تمييز كمقروء
                    </button>
                  )}
                </div>
                <p className="text-slate-600 leading-relaxed">{n.body}</p>
                <div className="text-[10px] text-slate-400 font-mono pt-1">
                  {new Date(n.createdAt).toLocaleTimeString('ar-SA')}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
