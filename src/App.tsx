import React, { useState, useEffect, useCallback } from 'react';
import { IUser } from './types';
import { api, clearAccessToken, refreshAccessToken } from './lib/api';
import { disconnectSocket, getSocket, reconnectSocketWithToken } from './lib/socket';
import { Header } from './components/common/Header';
import { RiderApp } from './components/rider/RiderApp';
import { DriverApp } from './components/driver/DriverApp';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { WalletModal } from './components/wallet/WalletModal';
import { ChatModal } from './components/chat/ChatModal';
import { NotificationDrawer } from './components/common/NotificationDrawer';
import { AuthModal } from './components/auth/AuthModal';
import { ChangePasswordModal } from './components/auth/ChangePasswordModal';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<IUser | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [unreadNotifications, setUnreadNotifications] = useState<number>(0);
  const [socketConnected, setSocketConnected] = useState<boolean>(false);
  const [activeView, setActiveView] = useState<'rider' | 'driver' | 'admin'>('rider');
  const [booting, setBooting] = useState<boolean>(true);

  // Modal States
  const [walletModalOpen, setWalletModalOpen] = useState<boolean>(false);
  const [chatModalRideId, setChatModalRideId] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState<boolean>(false);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState<boolean>(false);

  const fetchNotificationCount = useCallback(async () => {
    try {
      const notifs = await api.get<any[]>('/users/notifications');
      const unread = (notifs || []).filter((n) => !n.read).length;
      setUnreadNotifications(unread);
    } catch {
      // Unauthenticated or transient error
    }
  }, []);

  // Authenticate / Bootstrap Session using HttpOnly refresh cookie (no localStorage tokens)
  const initUserSession = useCallback(async () => {
    setBooting(true);
    try {
      const token = await refreshAccessToken();
      if (token) {
        const res = await api.get<{
          user: IUser;
          walletBalance: number;
        }>('/auth/me');

        setCurrentUser(res.user);
        setWalletBalance(res.walletBalance || 0);
        reconnectSocketWithToken(token);
        if (res.user.role === 'DRIVER') setActiveView('driver');
        else if (res.user.role === 'ADMIN') setActiveView('admin');
        else setActiveView('rider');
        await fetchNotificationCount();
        setAuthModalOpen(false);
        return;
      }
    } catch {
      clearAccessToken();
    } finally {
      setBooting(false);
    }

    setAuthModalOpen(true);
  }, [fetchNotificationCount]);

  useEffect(() => {
    initUserSession();
  }, [initUserSession]);

  // Socket Connection Monitoring & Live Notifications
  useEffect(() => {
    if (!currentUser) {
      setSocketConnected(false);
      return;
    }

    const socket = getSocket();

    const handleConnect = () => setSocketConnected(true);
    const handleDisconnect = () => setSocketConnected(false);

    const handleNewNotification = () => {
      setUnreadNotifications((c) => c + 1);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('notification:new', handleNewNotification);

    if (socket.connected) setSocketConnected(true);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('notification:new', handleNewNotification);
    };
  }, [currentUser]);

  const handleAuthSuccess = async (user: IUser, token: string) => {
    setCurrentUser(user);
    reconnectSocketWithToken(token);
    try {
      const me = await api.get<{ walletBalance: number }>('/auth/me');
      setWalletBalance(me.walletBalance || 0);
    } catch {
      setWalletBalance(0);
    }

    if (user.role === 'DRIVER') setActiveView('driver');
    else if (user.role === 'ADMIN') setActiveView('admin');
    else setActiveView('rider');

    fetchNotificationCount();
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    clearAccessToken();
    disconnectSocket();
    setCurrentUser(null);
    setWalletBalance(0);
    setUnreadNotifications(0);
    setActiveView('rider');
    setAuthModalOpen(true);
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased">
      {/* Universal Navigation Header */}
      <Header
        currentUser={currentUser}
        walletBalance={walletBalance}
        unreadNotifications={unreadNotifications}
        socketConnected={socketConnected}
        onOpenWallet={() => setWalletModalOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenChangePassword={() => setChangePasswordOpen(true)}
        onLogout={handleLogout}
        activeView={activeView}
        setActiveView={setActiveView}
      />

      {/* Main View Area */}
      <main className="w-full">
        {booting ? (
          <div className="h-[calc(100vh-4rem)] flex items-center justify-center text-sm text-slate-500">
            جاري تهيئة جلسة Creem الآمنة...
          </div>
        ) : (
          <>
            {activeView === 'rider' && (
              <RiderApp
                currentUser={currentUser}
                onOpenAuth={() => setAuthModalOpen(true)}
                onOpenWallet={() => setWalletModalOpen(true)}
                onOpenChat={(rideId) => setChatModalRideId(rideId)}
                walletBalance={walletBalance}
              />
            )}

            {activeView === 'driver' && (
              <DriverApp
                currentUser={currentUser}
                onOpenAuth={() => setAuthModalOpen(true)}
                onOpenChat={(rideId) => setChatModalRideId(rideId)}
              />
            )}

            {activeView === 'admin' && <AdminDashboard />}
          </>
        )}
      </main>

      {/* Global Modals */}
      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        onBalanceUpdated={(newBal) => setWalletBalance(newBal)}
      />

      <ChatModal
        isOpen={Boolean(chatModalRideId)}
        onClose={() => setChatModalRideId(null)}
        rideId={chatModalRideId}
        currentUserId={currentUser?.id || ''}
      />

      <NotificationDrawer
        isOpen={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onRefreshCount={fetchNotificationCount}
      />

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      <ChangePasswordModal
        isOpen={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
    </div>
  );
};

export default App;
