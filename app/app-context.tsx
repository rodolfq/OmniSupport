'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, UserRole, Permission, AbsenceReason } from '@/lib/types';
import { safeJsonStringify } from '@/lib/utils';
import { toast } from 'sonner';
import { UserService } from '@/lib/services/user-service';
import { ChatService, AbsenceReasonService, UserStatusHistoryService, AnalystService } from '@/lib/services/chat-service';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'ticket_new' | 'ticket_update' | 'ticket_assigned' | 'ticket_closed' | 'chat_new' | 'chat_message';
  targetId?: string;
  recipientId: string;
  timestamp: string;
  read: boolean;
}

export interface NotificationSettings {
  systemSound: string;
  chatSound: string;
  ticket_new: boolean;
  ticket_assigned: boolean;
  ticket_update: boolean;
  ticket_closed: boolean;
  chat_new: boolean;
  chat_message: boolean;
}

interface AppContextType {
   currentUser: User | null;
   setCurrentUser: (user: User | null) => void;
   authInitialized: boolean;
   hasPermission: (permission: Permission) => boolean;
  isNewTicketModalOpen: boolean;
  setIsNewTicketModalOpen: (open: boolean) => void;
  preselectedUserId: string | null;
  setPreselectedUserId: (id: string | null) => void;
  preselectedCompanyId: string | null;
  setPreselectedCompanyId: (id: string | null) => void;
  isOmniChatOpen: boolean;
  setIsOmniChatOpen: (open: boolean) => void;
  activeOmniChatId: string | null;
  setActiveOmniChatId: (id: string | null) => void;
  refreshTrigger: number;
  triggerRefresh: () => void;
  notifications: AppNotification[];
  addNotification: (notification: Omit<AppNotification, 'id' | 'timestamp' | 'read' | 'recipientId'>, recipientId: string) => void;
  markNotificationRead: (id: string | 'all') => void;
  markNotificationsAsReadByTarget: (targetId: string) => void;
  clearNotifications: () => void;
  playSound: (type: 'system' | 'chat') => void;
  notificationSettings: NotificationSettings;
  updateNotificationSettings: (settings: Partial<NotificationSettings>) => void;
  whatsappStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
  setWhatsappStatus: (status: 'connected' | 'disconnected' | 'connecting' | 'error') => void;
  dbStatus: 'connected' | 'disconnected' | 'error';
  userStatus: 'online' | 'away' | 'offline';
  userStatusReason: string | null;
  absenceReasons: AbsenceReason[];
  setUserStatus: (status: 'online' | 'away' | 'offline', reason?: string) => void;
  refreshAbsenceReasons: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const DEFAULT_SETTINGS: NotificationSettings = {
  systemSound: '/audio/Alerta.mp3',
  chatSound: '/audio/notificação1.mp3',
  ticket_new: true,
  ticket_assigned: true,
  ticket_update: true,
  ticket_closed: true,
  chat_new: true,
  chat_message: true,
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isNewTicketModalOpen, setIsNewTicketModalOpen] = useState(false);
  const [preselectedUserId, setPreselectedUserId] = useState<string | null>(null);
  const [preselectedCompanyId, setPreselectedCompanyId] = useState<string | null>(null);
  const [isOmniChatOpen, setIsOmniChatOpen] = useState(false);
  const [activeOmniChatId, setActiveOmniChatId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const userRef = useRef<User | null>(null);
  const activeChatRef = useRef<string | null>(null);
  const chatOpenRef = useRef<boolean>(false);
  const initialStatusLoadedRef = useRef<boolean>(false);

  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<NotificationSettings>(DEFAULT_SETTINGS);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const lastCheckTimeRef = useRef<string>(new Date().toISOString());

  const [whatsappStatus, setWhatsappStatus] = useState<'connected' | 'disconnected' | 'connecting' | 'error'>('disconnected');
  const [dbStatus, setDbStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
  const [userStatus, setUserStatusState] = useState<'online' | 'away' | 'offline'>('online');
  const [userStatusReason, setUserStatusReason] = useState<string | null>(null);
  const [absenceReasons, setAbsenceReasons] = useState<AbsenceReason[]>([]);

  const triggerRefresh = React.useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
    try {
      const channel = new BroadcastChannel('omni_sync');
      channel.postMessage('refresh');
      setTimeout(() => channel.close(), 100);
    } catch {
    }
  }, []);

  const playSound = React.useCallback((type: 'system' | 'chat') => {
    try {
      const currentSettings = settingsRef.current;
      const defaultChatSound = 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3';
      const defaultSystemSound = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

      const audioPath = type === 'system' 
        ? (currentSettings.systemSound || defaultSystemSound)
        : (currentSettings.chatSound || defaultChatSound);
      
      const audio = new Audio(audioPath);
      audio.volume = 0.5;
      
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.warn('Audio playback was prevented by browser policies. Interaction required.', error);
        });
      }
    } catch (e) {
      console.error('Error playing sound:', e);
    }
  }, []);

  const addNotification = React.useCallback((notif: Omit<AppNotification, 'id' | 'timestamp' | 'read' | 'recipientId'>, recipientId: string) => {
    const isEnabled = settingsRef.current[notif.type as keyof NotificationSettings];
    
    if (isEnabled) {
      const newNotif: AppNotification = {
        ...notif,
        id: Math.random().toString(36).substr(2, 9),
        recipientId,
        timestamp: new Date().toISOString(),
        read: false
      };
      setNotifications(prev => {
        const updated = [newNotif, ...prev].slice(0, 100);
        localStorage.setItem('omni_notif_history', safeJsonStringify(updated));
        return updated;
      });
      
      const soundType = notif.type.startsWith('chat_') ? 'chat' : 'system';
      playSound(soundType);

      toast(notif.title, {
        description: notif.message,
        duration: 4000
      });
    }
  }, [playSound]);

  useEffect(() => { userRef.current = currentUser; }, [currentUser]);
  useEffect(() => { activeChatRef.current = activeOmniChatId; }, [activeOmniChatId]);
  useEffect(() => { chatOpenRef.current = isOmniChatOpen; }, [isOmniChatOpen]);
  useEffect(() => { settingsRef.current = notificationSettings; }, [notificationSettings]);

  const refreshAbsenceReasons = React.useCallback(async () => {
    try {
      const reasons = await AbsenceReasonService.getAll();
      setAbsenceReasons(reasons);
    } catch (error) {
      console.error('Error loading absence reasons:', error);
    }
  }, []);

  const setUserStatus = React.useCallback((status: 'online' | 'away' | 'offline', reason?: string) => {
    setUserStatusState(status);
    setUserStatusReason(reason || null);
  }, []);

  useEffect(() => {
    const checkDb = async () => {
      try {
        const res = await fetch('/api/config?type=priorities');
        if (res.ok) {
          setDbStatus('connected');
        } else {
          console.error('Database connection error: Status', res.status);
          setDbStatus('error');
        }
      } catch (e: any) {
        console.error('Database connection error:', e?.message || e);
        setDbStatus('error');
      }
    };
    checkDb();
    refreshAbsenceReasons();
    const interval = setInterval(checkDb, 60000);
    return () => clearInterval(interval);
  }, [refreshAbsenceReasons]);

  useEffect(() => {
    let isMounted = true;
    const initAuth = async () => {
      console.log('🔐 AppContext: Inicializando Auth Nativo...');
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!isMounted) return;

        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            console.log('👤 AppContext: Usuário autenticado via API:', data.user);
            if (data.user.status) {
              setUserStatusState(data.user.status);
              setUserStatusReason(data.user.statusReason || null);
            }
            initialStatusLoadedRef.current = true;
            setCurrentUser({
              id: data.user.id,
              name: data.user.name,
              email: data.user.email,
              role: data.user.role,
              companyId: data.user.companyId,
              phone: data.user.phone,
              viewAllCompanyTickets: data.user.viewAllCompanyTickets,
              mustChangePassword: data.user.mustChangePassword,
              isAdmin: data.user.isAdmin,
              livesInSquad: data.user.livesInSquad,
              status: data.user.status,
              statusReason: data.user.statusReason
            });
          } else {
            setCurrentUser(null);
          }
        } else {
          setCurrentUser(null);
        }
      } catch (err) {
        console.error('❌ AppContext: Erro na inicialização do Auth Nativo:', err);
        if (isMounted) setCurrentUser(null);
      } finally {
        if (isMounted) setAuthInitialized(true);
      }
    };

    initAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authInitialized || !currentUser) return;

    console.log('📡 Realtime: Iniciando intervalo de atualização periódica...');
    const interval = setInterval(() => {
      triggerRefresh();
    }, 15000);

    return () => {
      console.log('📡 Realtime: Limpando intervalo de atualização...');
      clearInterval(interval);
    };
  }, [authInitialized, currentUser?.id, triggerRefresh]);

  useEffect(() => {
    if (currentUser) {
      if (!initialStatusLoadedRef.current) {
        initialStatusLoadedRef.current = true;
        return;
      }
      const updateStatus = async () => {
        if (currentUser.role !== UserRole.CUSTOMER) {
          await AnalystService.logStatusChange(currentUser.id, userStatus, userStatusReason || undefined);
        }
      };
      updateStatus();
    }
  }, [userStatus, userStatusReason, currentUser?.id]);

  useEffect(() => {
    if (!authInitialized) return;
    
    refreshAbsenceReasons();
    triggerRefresh();
  }, [authInitialized, triggerRefresh, refreshAbsenceReasons]);

  useEffect(() => {
    const savedSettings = localStorage.getItem('omni_notif_settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        if (typeof parsed.ticket_new === 'object') {
           setNotificationSettings(DEFAULT_SETTINGS);
        } else {
           setNotificationSettings(parsed);
        }
      } catch (e) {
        console.error('Error loading settings', e);
      }
    }

    const savedNotifs = localStorage.getItem('omni_notif_history');
    if (savedNotifs) {
      try {
        setNotifications(JSON.parse(savedNotifs));
      } catch (e) {
        console.error('Error loading notifications', e);
      }
    }
  }, []);

  const updateNotificationSettings = React.useCallback((newSettings: Partial<NotificationSettings>) => {
    setNotificationSettings(prev => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem('omni_notif_settings', safeJsonStringify(updated));
      return updated;
    });
  }, []);

  useEffect(() => {
    const unlock = () => {
      const audio = new Audio();
      audio.play().catch(() => {});
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      console.log('Audio Context Unlocked');
    };
    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const markNotificationRead = React.useCallback((id: string | 'all') => {
    setNotifications(prev => {
      const updated = id === 'all' 
        ? prev.map(n => ({ ...n, read: true }))
        : prev.map(n => n.id === id ? { ...n, read: true } : n);
      localStorage.setItem('omni_notif_history', safeJsonStringify(updated));
      return updated;
    });
  }, []);

  const markNotificationsAsReadByTarget = React.useCallback((targetId: string) => {
    setNotifications(prev => {
      const hasUnread = prev.some(n => n.targetId === targetId && !n.read);
      if (!hasUnread) return prev;

      const updated = prev.map(n => n.targetId === targetId ? { ...n, read: true } : n);
      localStorage.setItem('omni_notif_history', safeJsonStringify(updated));
      return updated;
    });
  }, []);

  const clearNotifications = React.useCallback(() => {
    setNotifications([]);
    localStorage.removeItem('omni_notif_history');
  }, []);

  const hasPermission = React.useCallback((permission: Permission) => {
    if (!userRef.current) return false;
    const roleName = userRef.current.role.toString();
    const perms = UserService.getPermissionsByRole(roleName);
    return perms.includes(permission);
  }, []);

  const userNotifications = React.useMemo(() => 
    notifications.filter(n => n.recipientId === currentUser?.id),
  [notifications, currentUser?.id]);

return (
    <AppContext.Provider value={{ 
      currentUser, 
      setCurrentUser,
      authInitialized,
      hasPermission,
      isNewTicketModalOpen, 
      setIsNewTicketModalOpen,
      preselectedUserId,
      setPreselectedUserId,
      preselectedCompanyId,
      setPreselectedCompanyId,
      isOmniChatOpen,
      setIsOmniChatOpen,
      activeOmniChatId,
      setActiveOmniChatId,
      refreshTrigger,
      triggerRefresh,
      notifications: userNotifications,
      addNotification,
      markNotificationRead,
      markNotificationsAsReadByTarget,
      clearNotifications,
      playSound,
      notificationSettings,
      updateNotificationSettings,
      whatsappStatus,
      setWhatsappStatus,
      dbStatus,
      userStatus,
      userStatusReason,
      absenceReasons,
      setUserStatus,
      refreshAbsenceReasons
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}