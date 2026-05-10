'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { User, MockDB, UserRole, Permission } from '@/lib/mock-db';
import { safeJsonStringify } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

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
// ... existing state ...
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isNewTicketModalOpen, setIsNewTicketModalOpen] = useState(false);
  const [preselectedUserId, setPreselectedUserId] = useState<string | null>(null);
  const [preselectedCompanyId, setPreselectedCompanyId] = useState<string | null>(null);
  const [isOmniChatOpen, setIsOmniChatOpen] = useState(false);
  const [activeOmniChatId, setActiveOmniChatId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const userRef = useRef<User | null>(null);
  const activeChatRef = useRef<string | null>(null);
  const chatOpenRef = useRef<boolean>(false);

  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<NotificationSettings>(DEFAULT_SETTINGS);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const lastCheckTimeRef = useRef<string>(new Date().toISOString());

  const triggerRefresh = React.useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
    try {
      const channel = new BroadcastChannel('omni_sync');
      channel.postMessage('refresh');
      setTimeout(() => channel.close(), 100);
    } catch {
    }
  }, []);

  useEffect(() => { userRef.current = currentUser; }, [currentUser]);
  useEffect(() => { activeChatRef.current = activeOmniChatId; }, [activeOmniChatId]);
  useEffect(() => { chatOpenRef.current = isOmniChatOpen; }, [isOmniChatOpen]);
  useEffect(() => { settingsRef.current = notificationSettings; }, [notificationSettings]);
  const [whatsappStatus, setWhatsappStatus] = useState<'connected' | 'disconnected' | 'connecting' | 'error'>('disconnected');
  const [dbStatus, setDbStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
  const [userStatus, setUserStatusState] = useState<'online' | 'away' | 'offline'>('online');
  const [userStatusReason, setUserStatusReason] = useState<string | null>(null);
  const [absenceReasons, setAbsenceReasons] = useState<AbsenceReason[]>([]);

  const refreshAbsenceReasons = React.useCallback(async () => {
    const reasons = MockDB.getAbsenceReasons();
    setAbsenceReasons(reasons);
  }, []);

  const setUserStatus = React.useCallback((status: 'online' | 'away' | 'offline', reason?: string) => {
    setUserStatusState(status);
    setUserStatusReason(reason || null);
  }, []);

  useEffect(() => {
    const checkDb = async () => {
      if (!supabase) {
        setDbStatus('disconnected');
        return;
      }
      try {
        // Try a simple health check query
        const { error } = await supabase.from('tickets').select('id').limit(1);
        if (error) {
          console.error('Database connection error:', error.message);
          setDbStatus('error');
        } else {
          setDbStatus('connected');
        }
      } catch (e) {
        setDbStatus('error');
      }
    };
    checkDb();
    refreshAbsenceReasons();
    // Check every minute
    const interval = setInterval(checkDb, 60000);
    return () => clearInterval(interval);
  }, [refreshAbsenceReasons]);

  useEffect(() => {
    const initAuth = async () => {
      if (!supabase) return;

      // 1. Get initial session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        // Fetch profile from Supabase
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        
        let profileToUse = profile;

        // CRITICAL FIX: Ensure admin@systemsat.com.br has the correct name and role
        if (session.user.email === 'admin@systemsat.com.br') {
          if (!profile || profile.name === 'teste' || profile.role !== UserRole.ADMIN) {
            console.log('🔧 Fixing Admin Profile...');
            const updatedProfile = { 
              id: session.user.id,
              name: 'Admin Systemsat',
              email: session.user.email,
              role: UserRole.ADMIN,
              company_id: null,
              must_change_password: false
            };
            await supabase.from('profiles').upsert(updatedProfile);
            profileToUse = { ...profile, ...updatedProfile };
            setCurrentUser(profileToUse);
          }
        }
        
        if (profileToUse) {
          const user: User = {
            id: profileToUse.id,
            name: profileToUse.name,
            email: profileToUse.email,
            role: profileToUse.role,
            companyId: profileToUse.company_id,
            phone: profileToUse.phone,
            mustChangePassword: profileToUse.must_change_password,
            isAdmin: profileToUse.is_admin
          };
          setCurrentUser(user);
        } else {
          // Fallback if profile doesn't exist yet but user is auth'd
          const newUser: User = {
            id: session.user.id,
            name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
            email: session.user.email || '',
            role: UserRole.CUSTOMER // Default role
          };
          setCurrentUser(newUser);
          // Sync new profile to DB
          await MockDB.saveUser(newUser);
        }
      }

      // 2. Listen for changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!supabase) return;
        if (session?.user) {
          const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
          
          let profileToUse = profile;
          if (session.user.email === 'admin@systemsat.com.br') {
             if (!profile || profile.name === 'teste' || profile.role !== UserRole.ADMIN || profile.company_id !== null) {
                const updatedProfile = { 
                  id: session.user.id,
                  name: 'Admin Systemsat',
                  email: session.user.email,
                  role: UserRole.ADMIN,
                  company_id: null,
                  must_change_password: false
                };
                await supabase.from('profiles').upsert(updatedProfile);
                profileToUse = { ...profile, ...updatedProfile };
             }
          }

          if (profileToUse) {
            setCurrentUser({
              id: profileToUse.id,
              name: profileToUse.name,
              email: profileToUse.email,
              role: profileToUse.role,
              companyId: profileToUse.company_id,
              phone: profileToUse.phone,
              mustChangePassword: profileToUse.must_change_password,
              isAdmin: profileToUse.is_admin
            });
          }
        } else {
          setCurrentUser(null);
        }
      });

      return () => subscription.unsubscribe();
    };

    initAuth();
  }, []);

  useEffect(() => {
    const initMockDB = async () => {
      await MockDB.init();
      await refreshAbsenceReasons();
      triggerRefresh();
    };
    initMockDB();
  }, [triggerRefresh]);

  useEffect(() => {
    if (currentUser) {
      const updateStatus = async () => {
        const updatedUser: User = { ...currentUser, status: userStatus, statusReason: userStatusReason || undefined };
        await MockDB.saveUser(updatedUser);
        
        if (currentUser.role !== UserRole.CUSTOMER) {
          await MockDB.logStatusChange(currentUser.id, userStatus, userStatusReason || undefined);
        }
      };
      updateStatus();
    }
  }, [userStatus, userStatusReason, currentUser?.id]);

  useEffect(() => {
// ... existing storage logic ...
    const savedSettings = localStorage.getItem('omni_notif_settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        // Migration check: if they have the old object structure, reset to default or try to adapt
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

  // Unlock audio on first user interaction
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
      // Avoid unnecessary state updates if nothing changes
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
    const perms = MockDB.getPermissionsByRole(roleName);
    return perms.includes(permission);
  }, []);

  const userNotifications = React.useMemo(() => 
    notifications.filter(n => n.recipientId === currentUser?.id),
  [notifications, currentUser?.id]);

  return (
    <AppContext.Provider value={{ 
      currentUser, 
      setCurrentUser, 
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
