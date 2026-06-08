'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, UserRole, Permission, AbsenceReason } from '@/lib/types';
import { safeJsonStringify } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
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
  chatSound: '/audio/notificaÃ§Ã£o1.mp3',
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
      if (!supabase) {
        setDbStatus('disconnected');
        return;
      }
      try {
        const { error } = await supabase.from('config_priorities').select('label').limit(1);
        if (error) {
          const isDbAlive = !!(
            error.code || 
            (error as any).status || 
            error.message?.toLowerCase().includes('permission') || 
            error.message?.toLowerCase().includes('security') || 
            error.message?.toLowerCase().includes('jwt') ||
            error.message?.toLowerCase().includes('row-level')
          );
          if (isDbAlive) {
            setDbStatus('connected');
          } else {
            console.error('Database connection error:', error.message);
            setDbStatus('error');
          }
        } else {
          setDbStatus('connected');
        }
      } catch (e) {
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
      if (!supabase) {
        setAuthInitialized(true);
        return;
      }

      console.log('🔐 AppContext: Inicializando Auth...');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        console.log('🔐 AppContext: getSession result:', { hasSession: !!session, userId: session?.user?.id });
        
        if (!isMounted) return;

        if (session?.user) {
          console.log('👤 AppContext: Usuário autenticado:', session.user.email);
          
          try {
            const profile = await UserService.getCurrentProfile();
            console.log('👤 AppContext: getCurrentProfile result:', { profile });
            
            if (!isMounted) return;

            if (profile) {
              setCurrentUser(profile);
            } else {
              const newUser: User = {
                id: session.user.id,
                name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Usuário',
                email: session.user.email || '',
                role: UserRole.EMPLOYEE
              };
              console.log('👤 AppContext: Using fallback user:', newUser);
              setCurrentUser(newUser);
            }
          } catch (e) {
            console.error('❌ initAuth profile error:', e);
            if (!isMounted) return;
            setCurrentUser({
              id: session.user.id,
              name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Usuário',
              email: session.user.email || '',
              role: UserRole.EMPLOYEE
            });
          }
        } else {
          console.log('👤 AppContext: No session found, checking localStorage backup');
          
          // Fallback: check localStorage backup for Vercel preview URLs
          const backupStr = localStorage.getItem('omni_user_backup');
          let foundBackup = false;
          
          if (backupStr) {
            try {
              const backup = JSON.parse(backupStr);
              console.log('👤 AppContext: Found backup user:', backup);
              setCurrentUser({
                id: backup.id,
                name: backup.name || backup.email?.split('@')[0] || 'Usuário',
                email: backup.email,
                role: UserRole.EMPLOYEE
              });
              foundBackup = true;
            } catch (e) {
              console.error('👤 AppContext: Failed to parse backup', e);
            }
          }
          
          // If no backup, try API (server reads cookies properly in Vercel)
          if (!foundBackup) {
            try {
              const res = await fetch('/api/auth/me', { credentials: 'include' });
              if (res.ok) {
                const data = await res.json();
                if (data.user) {
                  console.log('👤 AppContext: Found session via API:', data.user);
                  setCurrentUser({
                    id: data.user.id,
                    name: data.user.name || data.user.email?.split('@')[0],
                    email: data.user.email,
                    role: data.user.role,
                    companyId: data.user.companyId,
                    phone: data.user.phone,
                    viewAllCompanyTickets: data.user.viewAllCompanyTickets,
                    mustChangePassword: data.user.mustChangePassword,
                    isAdmin: data.user.isAdmin
                  });
                } else {
                  setCurrentUser(null);
                }
              } else {
                setCurrentUser(null);
              }
            } catch (e) {
              console.error('👤 AppContext: API fallback failed:', e);
              setCurrentUser(null);
            }
          }
        }

        console.log('🔐 AppContext: Auth state listener configurado');
        
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (!isMounted) return;
          console.log(`🔐 AppContext: Evento Auth [${event}]`);

          try {
            if (session?.user) {
              const profile = await UserService.getCurrentProfile();
              if (!isMounted) return;

              if (profile) {
                setCurrentUser(profile);
              } else {
                setCurrentUser({
                  id: session.user.id,
                  name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Usuário',
                  email: session.user.email || '',
                  role: UserRole.EMPLOYEE
                });
              }
            } else {
              // User signed out - check if we have backup for Vercel preview
              const backupStr = localStorage.getItem('omni_user_backup');
              if (!backupStr) {
                setCurrentUser(null);
              }
              // If backup exists, keep user (don't set null)
            }
          } catch (e) {
            console.error('❌ onAuthStateChange error:', e);
            if (session?.user && isMounted) {
              setCurrentUser({
                id: session.user.id,
                name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Usuário',
                email: session.user.email || '',
                role: UserRole.EMPLOYEE
              });
            }
          }
        });

      } catch (err) {
        console.error('❌ AppContext: Erro na inicialização do Auth:', err);
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
    if (!authInitialized || !supabase || !currentUser) return;

    console.log('📡 Realtime: Iniciando canais de escuta...');

    const ticketsChannel = supabase.channel('tickets-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, async (payload) => {
        console.log('📡 Realtime: Mudança detectada em tickets', payload);
        triggerRefresh();
        
        if (payload.eventType === 'INSERT' && currentUser.role !== UserRole.CUSTOMER) {
          const newTicket = payload.new;
          addNotification({
            title: 'Novo Chamado',
            message: `Um novo chamado "${newTicket.title}" foi criado.`,
            type: 'ticket_new',
            targetId: newTicket.id
          }, currentUser.id);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_messages' }, async (payload) => {
        console.log('📡 Realtime: Nova mensagem de ticket', payload);
        triggerRefresh();
      })
      .subscribe();

    const chatChannel = supabase.channel('chats-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_sessions' }, async (payload) => {
        console.log('📡 Realtime: Mudança em sessões de chat', payload);
        triggerRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, async (payload) => {
        console.log('📡 Realtime: Nova mensagem de chat', payload);
        triggerRefresh();
        
        if (payload.eventType === 'INSERT' && payload.new.sender_id !== currentUser.id) {
          const isCurrentChat = activeChatRef.current === payload.new.session_id;
          if (!isCurrentChat || !chatOpenRef.current) {
            playSound('chat');
          }
        }
      })
      .subscribe();

    const statusChannel = supabase.channel('status-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'analyst_status' }, async (payload) => {
        console.log('📡 Realtime: Mudança de status de analista', payload);
        triggerRefresh();
      })
      .subscribe();

    return () => {
      console.log('📡 Realtime: Encerrando canais...');
      supabase.removeChannel(ticketsChannel);
      supabase.removeChannel(chatChannel);
      supabase.removeChannel(statusChannel);
    };
  }, [authInitialized, currentUser?.id, triggerRefresh, addNotification, playSound]);

  useEffect(() => {
    if (currentUser) {
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