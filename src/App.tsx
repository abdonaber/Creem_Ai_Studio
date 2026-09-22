import React, { useState, useEffect } from 'react';
import { IUser, UserRole } from './types';
import { api } from './lib/api';
import { getSocket, reconnectSocketWithToken } from './lib/socket';
import { Header } from './components/common/Header';
import { RiderApp } from './components/rider/RiderApp';
import { DriverApp } from './components/driver/DriverApp';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { WalletModal } from './components/wallet/WalletModal';
import { ChatModal } from './components/chat/ChatModal';
import { NotificationDrawer } from './components/common/NotificationDrawer';
import { AuthModal } from './components/auth/AuthModal';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<IUser | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [unreadNotifications, setUnreadNotifications] = useState<number>(0);
  const [socketConnected, setSocketConnected] = useState<boolean>(false);
  const [activeView, setActiveView] = useState<'rider' | 'driver' | 'admin'>('rider');

  // Modal States
  const [walletModalOpen, setWalletModalOpen] = useState<boolean>(false);
  const [chatModalRideId, setChatModalRideId] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState<boolean>(false);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);

  // Authenticate / Bootstrap Session
  const initUserSession = async () => {
    try {
      const token = localStorage.getItem('creemy_token');
      if (token) {
        const res = await api.get<{
          user: IUser;
          walletBalance: number;
        }>('/auth/me');

        setCurrentUser(res.user);
        setWalletBalance(res.walletBalance);
        reconnectSocketWithToken(token);
        if (res.user.role === 'DRIVER') setActiveView('driver');
        else if (res.user.role === 'ADMIN') setActiveView('admin');
        else setActiveView('rider');
        return;
      }
    } catch {
      localStorage.removeItem('creemy_token');
    }

    // If unauthenticated, show Auth modal for real registration / login
    setAuthModalOpen(true);
  };

  const fetchNotificationCount = async () => {
    try {
      const notifs = await api.get<any[]>('/users/notifications');
      const unread = (notifs || []).filter((n) => !n.read).length;
      setUnreadNotifications(unread);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    initUserSession();
    fetchNotificationCount();
  }, []);

  // Socket Connection Monitoring & Live Notifications
  useEffect(() => {
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
  }, []);

  const handleAuthSuccess = async (user: IUser, token: string) => {
    setCurrentUser(user);
    reconnectSocketWithToken(token);
    try {
      const me = await api.get<{ walletBalance: number }>('/auth/me');
      setWalletBalance(me.walletBalance);
    } catch {
      setWalletBalance(0);
    }

    if (user.role === 'DRIVER') setActiveView('driver');
    else if (user.role === 'ADMIN') setActiveView('admin');
    else setActiveView('rider');

    fetchNotificationCount();
  };

  // Logout Handler
  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    localStorage.removeItem('creemy_token');
    setCurrentUser(null);
    setWalletBalance(0);
    setActiveView('rider');
    setAuthModalOpen(true);
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased select-none">
      {/* Universal Navigation Header */}
      <Header
        currentUser={currentUser}
        walletBalance={walletBalance}
        unreadNotifications={unreadNotifications}
        socketConnected={socketConnected}
        onOpenWallet={() => setWalletModalOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onOpenAuth={() => setAuthModalOpen(true)}
        onLogout={handleLogout}
        activeView={activeView}
        setActiveView={setActiveView}
      />

      {/* Main View Area */}
      <main className="w-full">
        {activeView === 'rider' && (
          <RiderApp
            onOpenWallet={() => setWalletModalOpen(true)}
            onOpenChat={(rideId) => setChatModalRideId(rideId)}
            walletBalance={walletBalance}
          />
        )}

        {activeView === 'driver' && (
          <DriverApp onOpenChat={(rideId) => setChatModalRideId(rideId)} />
        )}

        {activeView === 'admin' && <AdminDashboard />}
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
    </div>
  );
};

export default App;
