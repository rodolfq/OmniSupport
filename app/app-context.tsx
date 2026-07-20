'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { User, UserRole, Permission, AbsenceReason } from '@/lib/types';
import { safeJsonStringify } from '@/lib/utils';
import { toast } from 'sonner';
import { UserService } from '@/lib/services/user-service';
import { AbsenceReasonService, AnalystService } from '@/lib/services/chat-service';
import { subscribeToPush } from '@/hooks/use-push-subscription';

export interface AppNotification {
  id: string;
  sourceId?: string;
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
  osNotificationsEnabled: boolean;
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
  isOmniChatExpanded: boolean;
  setIsOmniChatExpanded: (expanded: boolean) => void;
  activeOmniChatId: string | null;
  setActiveOmniChatId: (id: string | null) => void;
  refreshTrigger: number;
  triggerRefresh: () => void;
  notifications: AppNotification[];
  addNotification: (notification: Omit<AppNotification, 'id' | 'timestamp' | 'read' | 'recipientId'>, recipientId: string) => void;
  markNotificationRead: (id: string | 'all') => void;
  markNotificationsAsReadByTarget: (targetId: string) => void;
  clearNotifications: () => void;
  pruneStaleChatNotifications: (validSessionIds: string[]) => void;
  playSound: (type: 'system' | 'chat') => void;
  suppressTicketAssignedNotification: (ticketId: string) => void;
  notificationSettings: NotificationSettings;
  updateNotificationSettings: (settings: Partial<NotificationSettings>) => void;
  osNotificationPermission: NotificationPermission | 'unsupported';
  requestOsNotificationPermission: () => Promise<void>;
  whatsappStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
  setWhatsappStatus: (status: 'connected' | 'disconnected' | 'connecting' | 'error') => void;
  dbStatus: 'connected' | 'disconnected' | 'error';
  userStatus: 'online' | 'away' | 'offline';
  userStatusReason: string | null;
  lunchSecondsRemaining: number | null;
  absenceReasons: AbsenceReason[];
  setUserStatus: (status: 'online' | 'away' | 'offline', reason?: string) => void;
  refreshAbsenceReasons: () => Promise<void>;
  getContactPhoto: (phone?: string, instanceId?: string) => string | null | undefined;
  ensureContactPhoto: (phone?: string, instanceId?: string) => void;
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
  osNotificationsEnabled: true,
};

function getNotificationTargetHref(notif: Pick<AppNotification, 'type' | 'targetId'>, isCompanyUser: boolean): string | null {
  if (!notif.targetId) return null;
  if (notif.type.startsWith('chat_')) return `${isCompanyUser ? '/my-tickets' : '/dashboard'}?chat=${notif.targetId}`;
  return `${isCompanyUser ? '/my-tickets' : '/dashboard'}?ticket=${notif.targetId}`;
}

function stripNotificationHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isNewTicketModalOpen, setIsNewTicketModalOpen] = useState(false);
  const [preselectedUserId, setPreselectedUserId] = useState<string | null>(null);
  const [preselectedCompanyId, setPreselectedCompanyId] = useState<string | null>(null);
  const [isOmniChatOpen, setIsOmniChatOpen] = useState(false);
  const [isOmniChatExpanded, setIsOmniChatExpanded] = useState(false);
  const [activeOmniChatId, setActiveOmniChatId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const userRef = useRef<User | null>(null);
  const activeChatRef = useRef<string | null>(null);
  const chatOpenRef = useRef<boolean>(false);
  const initialStatusLoadedRef = useRef<boolean>(false);
  const audioCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioUnlockedRef = useRef(false);

  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<NotificationSettings>(DEFAULT_SETTINGS);
  const [osNotificationPermission, setOsNotificationPermission] = useState<NotificationPermission | 'unsupported'>('default');

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const lastCheckTimeRef = useRef<string>(new Date().toISOString());
  const notificationSourceIdsRef = useRef<Set<string>>(new Set());
  // Chamados que o próprio usuário acabou de se auto-atribuir (botão
  // "Assumir" ou selecionar a si mesmo no responsável): suprime o toast de
  // "Chamado atribuído" gerado pelo polling pra essa mudança específica, sem
  // afetar a notificação legítima de quando OUTRA pessoa te atribui.
  const suppressedAssignedTicketIdsRef = useRef<Set<string>>(new Set());

  const [whatsappStatus, setWhatsappStatus] = useState<'connected' | 'disconnected' | 'connecting' | 'error'>('disconnected');
  const [dbStatus, setDbStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
  const [userStatus, setUserStatusState] = useState<'online' | 'away' | 'offline'>('online');
  const [userStatusReason, setUserStatusReason] = useState<string | null>(null);
  const [userStatusSince, setUserStatusSince] = useState<string | null>(null);
  const [lunchSecondsRemaining, setLunchSecondsRemaining] = useState<number | null>(null);
  const [absenceReasons, setAbsenceReasons] = useState<AbsenceReason[]>([]);

  // Cache compartilhado da foto de contato do WhatsApp: um único fetch/estado
  // usado por todas as telas (widget de chat, /chat-management, etc.), para
  // que todas mostrem sempre a mesma informação em vez de cada uma buscar
  // e cachear por conta própria.
  interface ContactPhotoEntry { url: string | null; fetchedAt: number }
  const CONTACT_PHOTO_RETRY_MS = 60000;
  const [contactPhotos, setContactPhotos] = useState<Record<string, ContactPhotoEntry>>({});
  const contactPhotosRef = useRef<Record<string, ContactPhotoEntry>>({});
  const inFlightPhotoFetchesRef = useRef<Set<string>>(new Set());
  // Fila serial: pedir várias fotos ao mesmo tempo sobrecarrega a conexão do
  // WhatsApp e faz algumas requisições falharem silenciosamente. Processamos
  // uma de cada vez.
  const photoFetchQueueRef = useRef<Array<{ phone: string; instanceId: string }>>([]);
  const isProcessingPhotoQueueRef = useRef(false);

  useEffect(() => {
    contactPhotosRef.current = contactPhotos;
  }, [contactPhotos]);

  const getContactPhoto = React.useCallback((phone?: string, instanceId?: string) => {
    if (!phone || !instanceId) return undefined;
    return contactPhotosRef.current[`${instanceId}:${phone}`]?.url;
  }, []);

  const processPhotoQueue = React.useCallback(async () => {
    if (isProcessingPhotoQueueRef.current) return;
    isProcessingPhotoQueueRef.current = true;

    while (photoFetchQueueRef.current.length > 0) {
      const { phone, instanceId } = photoFetchQueueRef.current.shift()!;
      const key = `${instanceId}:${phone}`;
      try {
        const res = await fetch(`/api/whatsapp/contact-photo?instanceId=${encodeURIComponent(instanceId)}&phone=${encodeURIComponent(phone)}`);
        const data = await res.json();
        setContactPhotos(prev => ({ ...prev, [key]: { url: data.url || null, fetchedAt: Date.now() } }));
      } catch {
        setContactPhotos(prev => ({ ...prev, [key]: { url: null, fetchedAt: Date.now() } }));
      } finally {
        inFlightPhotoFetchesRef.current.delete(key);
      }
    }

    isProcessingPhotoQueueRef.current = false;
  }, []);

  const ensureContactPhoto = React.useCallback((phone?: string, instanceId?: string) => {
    if (!phone || !instanceId) return;
    const key = `${instanceId}:${phone}`;
    const entry = contactPhotosRef.current[key];
    const isFresh = !!entry && (!!entry.url || Date.now() - entry.fetchedAt < CONTACT_PHOTO_RETRY_MS);
    if (isFresh || inFlightPhotoFetchesRef.current.has(key)) return;

    inFlightPhotoFetchesRef.current.add(key);
    photoFetchQueueRef.current.push({ phone, instanceId });
    void processPhotoQueue();
  }, [processPhotoQueue]);

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
      const defaultChatSound = '/audio/Notificação de Mensagem.mp3';
      const defaultSystemSound = '/audio/Alerta.mp3';

      const audioPath = type === 'system' 
        ? (currentSettings.systemSound || defaultSystemSound)
        : (currentSettings.chatSound || defaultChatSound);

      let audio = audioCacheRef.current.get(audioPath);
      if (!audio) {
        audio = new Audio(audioPath);
        audio.preload = 'auto';
        audioCacheRef.current.set(audioPath, audio);
      }

      audio.pause();
      audio.currentTime = 0;
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

  // Janela maior que o intervalo de polling (10s, ver useEffect mais abaixo)
  // pra garantir que a mudança seja detectada e suprimida antes de expirar.
  const SUPPRESS_ASSIGNED_WINDOW_MS = 15000;
  const suppressTicketAssignedNotification = React.useCallback((ticketId: string) => {
    suppressedAssignedTicketIdsRef.current.add(ticketId);
    setTimeout(() => suppressedAssignedTicketIdsRef.current.delete(ticketId), SUPPRESS_ASSIGNED_WINDOW_MS);
  }, []);

  const addNotification = React.useCallback((notif: Omit<AppNotification, 'id' | 'timestamp' | 'read' | 'recipientId'>, recipientId: string) => {
    if (notif.sourceId && notificationSourceIdsRef.current.has(`${recipientId}:${notif.sourceId}`)) {
      return;
    }

    // Mesmo comportamento do WhatsApp: mensagem da conversa que a pessoa já
    // está olhando agora (widget aberto, não minimizado, é essa mesma
    // conversa selecionada, aba em primeiro plano) não gera toast/som/sino —
    // ela só aparece na tela, sem interromper. Sai da conversa, minimiza o
    // widget, ou troca de aba, e volta a notificar normalmente.
    if (
      notif.type === 'chat_message' &&
      notif.targetId &&
      notif.targetId === activeChatRef.current &&
      chatOpenRef.current &&
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible'
    ) {
      return;
    }

    // Não notifica o próprio usuário sobre um auto-atribuição que ele
    // acabou de fazer (ver suppressTicketAssignedNotification) — quem
    // atribuiu o chamado a outra pessoa continua sendo avisado normalmente.
    if (
      notif.type === 'ticket_assigned' &&
      notif.targetId &&
      suppressedAssignedTicketIdsRef.current.has(notif.targetId)
    ) {
      return;
    }

    const isEnabled = settingsRef.current[notif.type as keyof NotificationSettings];
    
    if (isEnabled) {
      const newNotif: AppNotification = {
        ...notif,
        message: stripNotificationHtml(notif.message),
        id: Math.random().toString(36).substr(2, 9),
        recipientId,
        timestamp: new Date().toISOString(),
        read: false
      };
      if (newNotif.sourceId) {
        notificationSourceIdsRef.current.add(`${recipientId}:${newNotif.sourceId}`);
      }
      setNotifications(prev => {
        const updated = [newNotif, ...prev].slice(0, 100);
        localStorage.setItem('omni_notif_history', safeJsonStringify(updated));
        return updated;
      });
      
      const soundType = notif.type.startsWith('chat_') ? 'chat' : 'system';
      playSound(soundType);

      toast(notif.title, {
        description: newNotif.message,
        duration: 4000
      });

      // Notificação nativa do Windows: só quando a aba não está em primeiro
      // plano (senão duplicaria o toast acima) — é justamente o caso que o
      // toast sozinho não cobre hoje (janela minimizada / outro app em foco).
      if (
        settingsRef.current.osNotificationsEnabled &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted' &&
        document.visibilityState !== 'visible'
      ) {
        try {
          const isCompanyUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(userRef.current?.role as UserRole);
          const osNotif = new Notification(notif.title, {
            body: newNotif.message,
            icon: '/branding/icon.png',
            tag: newNotif.sourceId || newNotif.id
          });
          osNotif.onclick = () => {
            window.focus();
            const href = getNotificationTargetHref(newNotif, isCompanyUser);
            if (href) window.location.href = href;
            osNotif.close();
          };
        } catch (e) {
          console.error('Error showing OS notification:', e);
        }
      }
    }
  }, [playSound]);

  const checkNotifications = React.useCallback(async () => {
    if (!userRef.current?.id) return;

    const checkStartedAt = new Date().toISOString();

    try {
      const res = await fetch(`/api/notifications/check?since=${encodeURIComponent(lastCheckTimeRef.current)}`, {
        credentials: 'include'
      });

      if (!res.ok) return;

      const data = await res.json();
      const incoming: Array<Omit<AppNotification, 'id' | 'timestamp' | 'read' | 'recipientId'>> = data.notifications || [];

      incoming.forEach((notif) => {
        addNotification(notif, userRef.current!.id);
      });

      lastCheckTimeRef.current = checkStartedAt;
    } catch (error) {
      console.error('Erro ao buscar notificações:', error);
    }
  }, [addNotification]);

  useEffect(() => { userRef.current = currentUser; }, [currentUser]);
  useEffect(() => { activeChatRef.current = activeOmniChatId; }, [activeOmniChatId]);
  useEffect(() => { chatOpenRef.current = isOmniChatOpen; }, [isOmniChatOpen]);
  useEffect(() => { settingsRef.current = notificationSettings; }, [notificationSettings]);
  useEffect(() => {
    if (currentUser?.id) {
      lastCheckTimeRef.current = new Date().toISOString();
    }
  }, [currentUser?.id]);

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
    setUserStatusSince(new Date().toISOString());
  }, []);

  const notifyLunchOver = React.useCallback(() => {
    const title = 'Fim do horário de almoço';
    const message = 'Seus 60 minutos de almoço terminaram.';

    toast(title, { description: message, duration: 8000 });
    playSound('system');

    // Mesma regra da notificação nativa em addNotification: só dispara quando a
    // aba não está em primeiro plano, senão duplicaria o toast acima.
    if (
      settingsRef.current.osNotificationsEnabled &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted' &&
      document.visibilityState !== 'visible'
    ) {
      try {
        const osNotif = new Notification(title, {
          body: message,
          icon: '/branding/icon.png',
          tag: 'lunch-timer'
        });
        osNotif.onclick = () => {
          window.focus();
          osNotif.close();
        };
      } catch (e) {
        console.error('Error showing lunch OS notification:', e);
      }
    }
  }, [playSound]);

  useEffect(() => {
    refreshAbsenceReasons();
  }, [refreshAbsenceReasons]);

  // Contador de 60 minutos do almoço: começa quando o motivo de ausência
  // selecionado é "Almoço" e dispara uma notificação (toast + som + nativa do
  // SO) ao terminar. A duração é calculada a partir de userStatusSince (não de
  // um cronômetro em memória) para sobreviver a um F5/nova aba no meio do
  // almoço. A chave em localStorage evita notificar de novo a cada reload
  // depois que os 60 minutos já passaram.
  useEffect(() => {
    if (userStatus !== 'away' || userStatusReason !== 'Almoço' || !userStatusSince || !currentUser?.id) {
      setLunchSecondsRemaining(null);
      return;
    }

    const LUNCH_DURATION_MS = 60 * 60 * 1000;
    const endsAt = new Date(userStatusSince).getTime() + LUNCH_DURATION_MS;
    const notifiedKey = `omni_lunch_notified:${currentUser.id}:${userStatusSince}`;

    const tick = () => {
      setLunchSecondsRemaining(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 1000);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const msUntilEnd = endsAt - Date.now();
    if (!localStorage.getItem(notifiedKey)) {
      if (msUntilEnd <= 0) {
        notifyLunchOver();
        localStorage.setItem(notifiedKey, '1');
      } else {
        timeout = setTimeout(() => {
          notifyLunchOver();
          localStorage.setItem(notifiedKey, '1');
        }, msUntilEnd);
      }
    }

    return () => {
      clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
  }, [userStatus, userStatusReason, userStatusSince, currentUser?.id, notifyLunchOver]);

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
            setDbStatus('connected');
            console.log('👤 AppContext: Usuário autenticado via API:', data.user);
            if (data.user.status) {
              setUserStatusState(data.user.status);
              setUserStatusReason(data.user.statusReason || null);
              setUserStatusSince(data.user.statusSince || null);
            }
            initialStatusLoadedRef.current = true;
            setCurrentUser({
              id: data.user.id,
              name: data.user.name,
              email: data.user.email,
              role: data.user.role,
              permissions: data.user.permissions,
              companyId: data.user.companyId,
              phone: data.user.phone,
              avatarUrl: data.user.avatarUrl,
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
        setDbStatus('error');
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
    if (!authInitialized || !currentUser?.id) return;

    // Sempre verifica, mesmo com a aba em segundo plano/minimizada — antes o
    // polling só rodava com document.visibilityState === 'visible', que é
    // exatamente por que nada chegava com a janela minimizada. Navegadores
    // ainda podem limitar (throttle) intervalos em abas em segundo plano por
    // muito tempo, mas isso é bem melhor que nunca verificar.
    const interval = setInterval(checkNotifications, 10000);
    const onVisible = () => { if (document.visibilityState === 'visible') checkNotifications(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authInitialized, currentUser?.id, checkNotifications]);

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
    const savedSettings = localStorage.getItem('omni_notif_settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        if (typeof parsed.ticket_new === 'object') {
           setNotificationSettings(DEFAULT_SETTINGS);
        } else {
           // Mescla com os defaults (não substitui) para que campos novos
           // (ex: osNotificationsEnabled) adicionados depois que o usuário já
           // tinha uma preferência salva continuem com o valor padrão em vez
           // de undefined/false.
           setNotificationSettings({ ...DEFAULT_SETTINGS, ...parsed });
        }
      } catch (e) {
        console.error('Error loading settings', e);
      }
    }

    const savedNotifs = localStorage.getItem('omni_notif_history');
    if (savedNotifs) {
      try {
        const parsedNotifications = JSON.parse(savedNotifs);
        parsedNotifications
          .filter((n: AppNotification) => n.sourceId && n.recipientId)
          .forEach((n: AppNotification) => notificationSourceIdsRef.current.add(`${n.recipientId}:${n.sourceId}`));
        setNotifications(parsedNotifications);
      } catch (e) {
        console.error('Error loading notifications', e);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setOsNotificationPermission('unsupported');
      return;
    }
    setOsNotificationPermission(Notification.permission);
  }, []);

  const requestOsNotificationPermission = React.useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const result = await Notification.requestPermission();
      setOsNotificationPermission(result);
      if (result === 'granted') {
        subscribeToPush().catch(e => console.error('Error subscribing to push:', e));
      }
    } catch (e) {
      console.error('Error requesting OS notification permission:', e);
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
      if (audioUnlockedRef.current) return;

      const audio = new Audio('/audio/Alerta.mp3');
      audio.muted = true;
      audio.volume = 0;
      audio.play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audioUnlockedRef.current = true;
        })
        .catch(() => {});
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

  // Notificações de chat ficam guardadas no localStorage (persistem entre reloads),
  // então se a conversa de origem for encerrada/apagada elas viram "fantasmas" que
  // nunca mais somem sozinhas. Remove qualquer notificação de chat cujo targetId
  // não corresponda a nenhuma sessão atualmente existente.
  const pruneStaleChatNotifications = React.useCallback((validSessionIds: string[]) => {
    const validIds = new Set(validSessionIds);
    setNotifications(prev => {
      const filtered = prev.filter(n => !n.type.startsWith('chat_') || !n.targetId || validIds.has(n.targetId));
      if (filtered.length === prev.length) return prev;
      localStorage.setItem('omni_notif_history', safeJsonStringify(filtered));
      return filtered;
    });
  }, []);

  const hasPermission = React.useCallback((permission: Permission) => {
    if (!currentUser) return false;
    if (currentUser.role === UserRole.ADMIN) return true;
    if (Array.isArray(currentUser.permissions)) {
      return currentUser.permissions.includes(permission);
    }
    const roleName = currentUser.role.toString();
    const perms = UserService.getPermissionsByRole(roleName);
    return perms.includes(permission);
  }, [currentUser]);

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
      isOmniChatExpanded,
      setIsOmniChatExpanded,
      activeOmniChatId,
      setActiveOmniChatId,
      refreshTrigger,
      triggerRefresh,
      notifications: userNotifications,
      addNotification,
      markNotificationRead,
      markNotificationsAsReadByTarget,
      clearNotifications,
      pruneStaleChatNotifications,
      playSound,
      suppressTicketAssignedNotification,
      notificationSettings,
      updateNotificationSettings,
      osNotificationPermission,
      requestOsNotificationPermission,
      whatsappStatus,
      setWhatsappStatus,
      dbStatus,
      userStatus,
      userStatusReason,
      lunchSecondsRemaining,
      absenceReasons,
      setUserStatus,
      refreshAbsenceReasons,
      getContactPhoto,
      ensureContactPhoto
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
