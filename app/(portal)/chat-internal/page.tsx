'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, 
  Plus, 
  Send, 
  Paperclip, 
  Smile, 
  Image as ImageIcon, 
  Phone,
  Video,
  Users,
  Search as SearchIcon,
  X,
  FileText,
  Download,
  Check,
  CheckCheck,
  MessageCircle,
  Pin,
  PinOff,
  Settings,
  Palette,
  Bell,
  BellOff,
  UserPlus,
  UserMinus,
  Trash2,
  Calendar,
  UserCircle,
  EyeOff,
  Clock,
  Eye,
  Loader2,
  Reply,
  MoreHorizontal,
  Ticket,
  ClipboardList
} from 'lucide-react';
import { cn, normalizeString } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { UserAvatar } from '@/components/user-avatar';
import { InternalGroup, ChatMessage, User, UserRole, Permission, AnalystStatus } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { ClientTime } from '@/components/client-time';
import { InternalChatService } from '@/lib/services/chat-service';
import { UserService } from '@/lib/services/user-service';
import { fetchAnalystStatuses } from '@/lib/services/config-service';
import { deriveLiveStatus } from '@/lib/presence';
import { GROUP_AVATAR_PRESETS } from '@/lib/group-avatar-presets';
import { NewInternalTicketModal } from '@/components/new-internal-ticket-modal';
import { renderLinkedText } from '@/components/linked-chat-text';
import { PhoneContactPanel } from '@/components/phone-contact-panel';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import EmojiPicker, { Theme as EmojiTheme } from 'emoji-picker-react';
import Cropper, { Area } from 'react-easy-crop';
import { Scissors } from 'lucide-react';
import { fileToBase64 } from '@/lib/image-utils';
import { toast } from 'sonner';

// Classes literais (não interpoladas) pra cor da bolha escolhida pelo
// usuário — o scanner do Tailwind só detecta nomes de classe/variável que
// aparecem como texto literal no código-fonte. Uma classe montada em
// runtime tipo `bg-${bubbleColor}-600`, ou até `var(--color-${bubbleColor}-600)`,
// nunca é vista pelo scanner: a classe (ou a variável CSS `--color-*-600`,
// que o Tailwind v4 também só gera sob demanda) simplesmente não existe no
// CSS final, deixando a bolha "minha" sem fundo — texto branco em cima de
// nada é invisível no tema claro (no escuro passava despercebido por
// coincidência, o fundo por trás já é escuro). Por isso o mapeamento fica
// aqui, com toda classe escrita por extenso.
const BUBBLE_COLOR_BG_CLASS: Record<string, string> = {
  indigo: 'bg-indigo-600',
  emerald: 'bg-emerald-600',
  blue: 'bg-blue-600',
  rose: 'bg-rose-600',
  amber: 'bg-amber-600',
  slate: 'bg-slate-600',
  violet: 'bg-violet-600',
};

// Simple Sticker Data (dummy URLs)
const STICKERS = [
  { name: 'Happy', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f600/512.gif' },
  { name: 'Cool', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60e/512.gif' },
  { name: 'Love', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60d/512.gif' },
  { name: 'Think', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f914/512.gif' },
  { name: 'Crying', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f62d/512.gif' },
  { name: 'Mindblown', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f92f/512.gif' },
  { name: 'Partying', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f973/512.gif' },
  { name: 'StarEyes', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f929/512.gif' },
  { name: 'Laughing', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f923/512.gif' },
  { name: 'Wink', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f609/512.gif' },
  { name: 'Angry', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f621/512.gif' },
  { name: 'Surprised', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f632/512.gif' },
];

// Nome do autor colorido na lista de fixadas (como no Discord, que usa a cor
// do cargo). Aqui não existe cor por cargo/perfil, então ela sai de um hash
// do id do usuário: fica estável entre sessões e entre aparelhos, e nomes
// diferentes quase sempre caem em cores diferentes. Cores em hex inline
// porque classe montada em runtime não é vista pelo scanner do Tailwind
// (mesma armadilha do BUBBLE_COLOR_BG_CLASS acima).
const PINNED_AUTHOR_COLORS = ['#F0736A', '#E8A33C', '#D8B93A', '#4FBF7F', '#3FB6BE', '#5B9BF0', '#A78BFA', '#EC7FB4'];
const getAuthorColor = (userId: string) => {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash + userId.charCodeAt(i)) % PINNED_AUTHOR_COLORS.length;
  return PINNED_AUTHOR_COLORS[hash];
};

const preloadAvatars = (users: User[]) => Promise.all(
  users
    .map(user => user.avatarUrl)
    .filter((url): url is string => Boolean(url))
    .map(url => new Promise<void>(resolve => {
      const image = new Image();
      const timeout = window.setTimeout(resolve, 8000);
      const finish = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      image.onload = finish;
      image.onerror = finish;
      image.src = url;
    }))
);

const getCroppedImg = (imageSrc: string, pixelCrop: Area): Promise<string> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.src = imageSrc;
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('No context');

      canvas.width = pixelCrop.width;
      canvas.height = pixelCrop.height;

      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        pixelCrop.width,
        pixelCrop.height
      );

      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = (e) => reject(e);
  });
};

export default function ChatInternalPage() {
   const { currentUser, setCurrentUser, authInitialized, hasPermission, setIsNewTicketModalOpen, setPrefilledTicketTitle, setPrefilledTicketDescription, setActiveOmniChatId, setIsOmniChatOpen } = useApp();
   const router = useRouter();
  const [rooms, setRooms] = useState<InternalGroup[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [message, setMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [showGifSearch, setShowGifSearch] = useState(false);
  const [stickerContextMenu, setStickerContextMenu] = useState<{ x: number, y: number, index: number } | null>(null);
  const [gifQuery, setGifQuery] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupImage, setNewGroupImage] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [bubbleColor, setBubbleColor] = useState(currentUser?.chatPreferences?.bubbleColor || 'indigo');
  const [avatarSize, setAvatarSize] = useState(currentUser?.chatPreferences?.avatarSize || 'md');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, roomId: string | null } | null>(null);
  const [findChatsWithUserId, setFindChatsWithUserId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [isCroppingSticker, setIsCroppingSticker] = useState(false);
  const [tempStickerUrl, setTempStickerUrl] = useState<string | null>(null);
  const [isTempStickerGif, setIsTempStickerGif] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [isChatReady, setIsChatReady] = useState(false);
  // Citação @nome (só faz sentido em grupo — 1:1 já sabe pra quem é).
  // mentionQuery !== null = dropdown de autocomplete aberto; string vazia =
  // "@" acabou de ser digitado, ainda sem filtro.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  // Presença real (substitui o texto fixo "Online" no header) — mesma tabela
  // analyst_status já usada pra roteamento de fila/badge Disponível-Ausente
  // em chat-management, só que agora também exibida aqui.
  const [analystStatuses, setAnalystStatuses] = useState<AnalystStatus[]>([]);
  // Quem está digitando agora nessa sala (chave: userId), com o timeout que
  // limpa o indicador sozinho se não chegar um novo "typing" em ~4s.
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const typingTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTypingSentAtRef = useRef(0);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  // Menu "transformar em chamado" por mensagem, e o rascunho pro modal de
  // Ticket Interno (que não passa pelo AppContext global como o de Chamado
  // — ver components/new-internal-ticket-modal.tsx).
  const [ticketMenuMessageId, setTicketMenuMessageId] = useState<string | null>(null);
  const [internalTicketDraft, setInternalTicketDraft] = useState<{ title: string; description: string } | null>(null);

  const stickerInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupImageRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const pinnedPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authInitialized || !currentUser) return;
    const canViewInternalChat = currentUser.role === UserRole.ADMIN ||
      currentUser.permissions?.includes(Permission.CHAT_INTERNAL_VIEW) === true;
    if (!canViewInternalChat) {
      router.replace('/tickets?mode=internal');
      return;
    }
    let isActive = true;
    setIsChatReady(false);

    const initializeChat = async () => {
      try {
        const [, { data }] = await Promise.all([
          loadRooms(),
          supabase
            .from('profiles')
            .select('id, name, email, avatar_url, role, status, status_reason')
            .or('role.eq.Equipe,role.eq.Administrador,role.eq.Time Interno')
        ]);
        const users = (data || []).map((user: any) => ({
          ...user,
          avatarUrl: user.avatar_url,
          statusReason: user.status_reason
        })) as User[];

        await preloadAvatars(users);
        if (!isActive) return;
        setAllUsers(users);
      } catch (error) {
        console.error('Error initializing internal chat:', error);
      } finally {
        if (isActive) setIsChatReady(true);
      }
    };

    initializeChat();
    return () => {
      isActive = false;
    };
  }, [authInitialized, currentUser?.id, currentUser?.role, currentUser?.permissions, router]);

  const selectedRoom = rooms.find(r => r.id === selectedRoomId);

  // Mais recentes primeiro, como o painel de fixadas do Discord. Mensagens
  // fixadas que não estão no lote carregado simplesmente não aparecem — não
  // dá pra montar o cartão sem o conteúdo delas.
  const pinnedMessages = (selectedRoom?.messages || [])
    .filter(m => selectedRoom?.pinnedMessageIds?.includes(m.id))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  useEffect(() => {
    scrollToBottom();
  }, [selectedRoom?.messages.length, selectedRoomId]);

  const loadRooms = useCallback(async () => {
    try {
      const loadedRooms = await InternalChatService.getChats();
      setRooms(previousRooms => loadedRooms.map(loadedRoom => {
        const existingRoom = previousRooms.find(room => room.id === loadedRoom.id);
        return {
          ...loadedRoom,
          messages: existingRoom?.messages || loadedRoom.messages || []
        };
      }));
    } catch (error) {
      console.error('Error loading chats:', error);
    }
  }, []);

  const refreshMessages = useCallback((chatId: string) => {
    InternalChatService.getMessages(chatId)
      .then(messages => {
        setRooms(prev => prev.map(r => r.id === chatId ? { ...r, messages } : r));
      })
      .catch(err => console.error('Error loading messages:', err));
  }, []);

  // Load messages when room is selected
  useEffect(() => {
    if (selectedRoomId) {
      refreshMessages(selectedRoomId);
    }
    setMentionQuery(null);
    setMentionStartIndex(-1);
    setTypingUsers({});
  }, [selectedRoomId, refreshMessages]);

  // Tempo real da sala aberta: sem isso, o Chat Interno não tinha NENHUM
  // mecanismo de atualização ao vivo — duas pessoas na mesma sala só viam a
  // mensagem uma da outra trocando de sala e voltando (ou dando F5). Mesmo
  // padrão SSE do chat com cliente (components/chat-widget.tsx), canal
  // próprio (ver lib/chat-events.ts / app/api/chats/internal-stream).
  useEffect(() => {
    if (!selectedRoomId || !currentUser) return;

    const eventSource = new EventSource(`/api/chats/internal-stream?chatId=${selectedRoomId}`);

    eventSource.addEventListener('chat-event', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'message' || payload?.type === 'receipt' || payload?.type === 'reaction') {
          refreshMessages(selectedRoomId);
        }
        if (payload?.type === 'typing' && payload.userId && payload.userId !== currentUser.id) {
          setTypingUsers(prev => ({ ...prev, [payload.userId]: payload.userName || 'Alguém' }));
          if (typingTimeoutsRef.current[payload.userId]) clearTimeout(typingTimeoutsRef.current[payload.userId]);
          typingTimeoutsRef.current[payload.userId] = setTimeout(() => {
            setTypingUsers(prev => {
              const next = { ...prev };
              delete next[payload.userId];
              return next;
            });
          }, 4000);
        }
      } catch (err) {
        console.error('Erro processando evento SSE do chat interno:', err);
      }
    });

    return () => {
      eventSource.close();
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
      typingTimeoutsRef.current = {};
    };
  }, [selectedRoomId, currentUser, refreshMessages]);

  // Presença real (online/visto por último) — substitui o texto fixo
  // "Online" que o header mostrava antes, sempre igual pra qualquer contato.
  useEffect(() => {
    if (!currentUser) return;
    let isActive = true;
    const load = () => {
      fetchAnalystStatuses().then(statuses => { if (isActive) setAnalystStatuses(statuses); }).catch(() => {});
    };
    load();
    const interval = setInterval(load, 20000);
    return () => { isActive = false; clearInterval(interval); };
  }, [currentUser?.id]);

  const scrollToBottom = (instant = false) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: instant ? 'auto' : 'smooth',
        block: 'end'
      });
    }
  };

  // "Lido" agora é persistido no servidor (internal-messages GET marca
  // read_by de verdade quando a sala é aberta — ver app/api/chats/route.ts),
  // não precisa mais desse efeito client-only que só mexia no estado local.

  const generateId = () => Math.random().toString(36).substring(2, 11) + Date.now().toString(36);

  const isDirectChatWith = (room: InternalGroup, userId: string) => {
    if (!currentUser || room.type !== 'direct' || !room.memberIds?.length) return false;
    if (userId === currentUser.id) {
      return room.memberIds.every(memberId => memberId === currentUser.id);
    }

    const uniqueMemberIds = new Set(room.memberIds);
    return uniqueMemberIds.size === 2 &&
      uniqueMemberIds.has(currentUser.id) &&
      uniqueMemberIds.has(userId);
  };

  const startDirectChat = (user: User) => {
    if (!currentUser) return;
    // Check if direct chat already exists
    const existing = rooms.find(room => isDirectChatWith(room, user.id));
    if (existing) {
      setSelectedRoomId(existing.id);
    } else {
      const newRoom: InternalGroup = {
        id: `d-${generateId()}`,
        name: user.name,
        type: 'direct',
        memberIds: [currentUser!.id, user.id],
        messages: [],
        lastMessageAt: new Date().toISOString()
      };
      InternalChatService.saveChat(newRoom)
        .then((chatId) => {
          loadRooms();
          setSelectedRoomId(chatId);
        });
    }
    setSearchTerm('');
  };

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Extrai quem foi citado na mensagem (@Nome Completo) comparando com os
  // membros do grupo — só vira "menção" de verdade quem está na conversa,
  // pra não destacar um "@" qualquer digitado sem querer citar ninguém.
  const extractMentions = (text: string, members: User[]): { id: string; name: string }[] => {
    const mentions: { id: string; name: string }[] = [];
    for (const member of members) {
      if (!member.name) continue;
      const re = new RegExp(`@${escapeRegex(member.name)}(?=[\\s.,!?;:]|$)`, 'u');
      if (re.test(text)) mentions.push({ id: member.id, name: member.name });
    }
    return mentions;
  };

  const mentionCandidates = mentionQuery !== null && selectedRoom?.type === 'group' && currentUser
    ? allUsers
        .filter(u => selectedRoom.memberIds.includes(u.id) && u.id !== currentUser.id)
        .filter(u => normalizeString(u.name).includes(normalizeString(mentionQuery)))
        .slice(0, 6)
    : [];

  // Cresce junto com o texto (até um teto, depois rola por dentro) — via
  // efeito ligado a `message` em vez de só onInput, pra também encolher de
  // volta quando a mensagem é limpa no envio (setMessage('')) ou preenchida
  // por fora (menção inserida por clique, ver insertMention).
  useEffect(() => {
    const el = messageInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [message]);

  const handleMessageInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);

    // Throttlado a 1x/3s — o destinatário só precisa saber "ainda está
    // digitando", não cada tecla; evita spammar o servidor a cada onChange.
    if (selectedRoomId && currentUser && value.trim()) {
      const now = Date.now();
      if (now - lastTypingSentAtRef.current > 3000) {
        lastTypingSentAtRef.current = now;
        InternalChatService.sendTyping(selectedRoomId, currentUser.id, currentUser.name);
      }
    }

    if (selectedRoom?.type !== 'group') {
      if (mentionQuery !== null) setMentionQuery(null);
      return;
    }

    const cursorPos = e.target.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const match = textBeforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStartIndex(cursorPos - match[1].length - 1);
      setMentionActiveIndex(0);
    } else if (mentionQuery !== null) {
      setMentionQuery(null);
    }
  };

  const insertMention = (user: User) => {
    if (mentionStartIndex < 0) return;
    const queryLength = mentionQuery?.length || 0;
    const before = message.slice(0, mentionStartIndex);
    const after = message.slice(mentionStartIndex + 1 + queryLength);
    const insertion = `@${user.name} `;
    setMessage(`${before}${insertion}${after}`);
    setMentionQuery(null);
    setMentionStartIndex(-1);
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length;
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(pos, pos);
    });
  };

  // Clique num número de telefone detectado dentro do texto de uma mensagem
  // (ver renderMessageText/renderLinkedText) — mostra o painel de
  // confirmação (components/phone-contact-panel.tsx) em vez de achar/abrir
  // a conversa direto. Faz sentido aqui porque é comum colar o telefone de
  // um cliente no chat interno da equipe pra outro analista assumir o
  // contato.
  const [phoneContactPanelPhone, setPhoneContactPanelPhone] = useState<string | null>(null);
  const handleOpenPhoneFromMessage = (phone: string) => {
    setPhoneContactPanelPhone(phone);
  };

  // Destaca @Nome no texto renderizado da mensagem — só as menções
  // "congeladas" em metadata.mentions no envio (ver handleSendMessage),
  // não qualquer "@" solto no texto. Fora dos trechos de menção, o texto
  // ainda passa por renderLinkedText (URL/telefone clicável).
  const renderMessageText = (text: string, mentions: { id: string; name: string }[] | undefined, isMine: boolean) => {
    if (!mentions || mentions.length === 0) return renderLinkedText(text, isMine, handleOpenPhoneFromMessage);
    const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length);
    const pattern = sorted.map(m => `@${escapeRegex(m.name)}`).join('|');
    const parts = text.split(new RegExp(`(${pattern})`, 'g'));
    return parts.map((part, i) => {
      const mention = mentions.find(m => `@${m.name}` === part);
      if (!mention) return <React.Fragment key={i}>{renderLinkedText(part, isMine, handleOpenPhoneFromMessage)}</React.Fragment>;
      return (
        <span
          key={i}
          className={cn(
            "font-black rounded px-1",
            mention.id === currentUser?.id ? "bg-amber-400/40" : "bg-black/10"
          )}
        >
          {part}
        </span>
      );
    });
  };

  const handleSendMessage = (type: ChatMessage['type'] = 'text', content?: string, metadata?: any) => {
    console.log('handleSendMessage:', { selectedRoomId, hasUser: !!currentUser, message, type });
    
    if (!selectedRoomId) {
      console.error('No selected room');
      return;
    }
    if (!currentUser) {
      console.error('No current user');
      return;
    }
    if (type === 'text' && !message.trim()) {
      console.error('Empty message');
      return;
    }

    const newMessage: ChatMessage = {
      id: generateId(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: type === 'text' ? message : '',
      timestamp: new Date().toISOString(),
      type,
      replyToId: replyingToId || undefined,
      readBy: [currentUser.id], // Sender has read it
      metadata: metadata || {}
    };

    if (type === 'gif') {
        newMessage.metadata = { gifUrl: content };
    } else if (type === 'sticker') {
        newMessage.metadata = { stickerUrl: content };
    } else if (type === 'text' && selectedRoom?.type === 'group') {
        const mentions = extractMentions(newMessage.text, allUsers.filter(u => selectedRoom.memberIds.includes(u.id)));
        if (mentions.length > 0) newMessage.metadata = { ...newMessage.metadata, mentions };
    }

    // Persist message to Supabase
    InternalChatService.saveMessage(selectedRoomId, newMessage)
      .then(() => {
        console.log('Message saved successfully');
        // Reload messages to show latest
        InternalChatService.getMessages(selectedRoomId)
          .then(messages => {
            setRooms(prev => prev.map(r => r.id === selectedRoomId ? { ...r, messages } : r));
          });
      })
      .catch(err => {
        console.error('Error sending message:', err);
        toast.error('Erro ao enviar mensagem: ' + (err.message || 'Unknown error'));
      });

    setMessage('');
    setReplyingToId(null);
    setShowEmojiPicker(false);
    setShowStickerPicker(false);
    setShowGifSearch(false);
    setMentionQuery(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    // Simulate upload
    const base64 = await fileToBase64(file);
    const metadata = {
      fileName: file.name,
      fileSize: file.size,
      fileUrl: base64
    };

    // Imagem ganha preview inline (bolha própria, ver renderização de
    // msg.type === 'image') em vez do card genérico de arquivo.
    handleSendMessage(file.type.startsWith('image/') ? 'image' : 'file', undefined, metadata);
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedRoomId || !currentUser) return;
    
    const room = rooms.find(r => r.id === selectedRoomId);
    if (!room) return;

    const targetMessage = room.messages.find(m => m.id === messageId);
    if (!targetMessage || targetMessage.senderId !== currentUser.id) return;

    try {
      await InternalChatService.deleteMessage(selectedRoomId, messageId, currentUser.id);
      setRooms(prev => prev.map(currentRoom =>
        currentRoom.id === selectedRoomId
          ? { ...currentRoom, messages: currentRoom.messages.filter(m => m.id !== messageId) }
          : currentRoom
      ));
      toast.success('Mensagem excluída');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao excluir mensagem');
    }
  };

  const TICKET_TITLE_MAX_LENGTH = 60;

  // Assunto automático usa só a PRIMEIRA LINHA da mensagem, cortada numa
  // palavra inteira — título é campo de uma linha só (lista de chamados,
  // cabeçalho etc.), então replicar a mensagem inteira (que pode ter várias
  // linhas e passar de uma tela) quebrava a exibição em vários lugares.
  const buildTitleFromText = (text: string) => {
    const firstLine = text.split('\n')[0].trim();
    if (firstLine.length <= TICKET_TITLE_MAX_LENGTH) return firstLine;
    const truncated = firstLine.slice(0, TICKET_TITLE_MAX_LENGTH);
    const lastSpace = truncated.lastIndexOf(' ');
    // Só corta na última palavra inteira se sobrar um título minimamente
    // útil — evita virar 2-3 caracteres quando a primeira "palavra" já é
    // enorme (ex.: um link colado sem espaço).
    const cut = lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
    return `${cut}...`;
  };

  // Transforma o conteúdo de uma mensagem em ponto de partida pra um
  // Chamado ou Ticket Interno — título curto pro campo "Assunto"/"Título",
  // descrição com o texto completo + de onde veio (pra quem for tratar não
  // perder o contexto da conversa original).
  const buildTicketDraftFromMessage = (msg: ChatMessage) => {
    const room = rooms.find(r => r.id === selectedRoomId);
    const rawText = msg.text?.trim() || (msg.metadata?.fileName ? `Arquivo: ${msg.metadata.fileName}` : 'Mensagem sem texto');
    const title = buildTitleFromText(rawText);
    const description = `Mensagem de ${msg.senderName} no chat interno${room ? ` "${room.name}"` : ''}:\n\n${rawText}`;
    return { title, description };
  };

  const escapeHtmlForRichEditor = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // O campo "Descrição Detalhada" do NewTicketModal é o RichEditor (Tiptap),
  // que guarda/lê HTML — texto puro cru vira uma única linha corrida (Tiptap
  // ignora \n solto), por isso convertemos quebra dupla em parágrafo e
  // quebra simples em <br>, pra chegar lá já formatado e continuar editável.
  const messageToRichEditorHtml = (text: string) =>
    text
      .split(/\n{2,}/)
      .map(paragraph => `<p>${escapeHtmlForRichEditor(paragraph).replace(/\n/g, '<br>')}</p>`)
      .join('');

  const handleCreateTicketFromMessage = (msg: ChatMessage) => {
    const { title, description } = buildTicketDraftFromMessage(msg);
    setPrefilledTicketTitle(title);
    setPrefilledTicketDescription(messageToRichEditorHtml(description));
    setIsNewTicketModalOpen(true);
    setTicketMenuMessageId(null);
  };

  const handleCreateInternalTicketFromMessage = (msg: ChatMessage) => {
    const { title, description } = buildTicketDraftFromMessage(msg);
    setInternalTicketDraft({ title, description });
    setTicketMenuMessageId(null);
  };

  const togglePin = async (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();
    if (!currentUser) return;

    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    const pinnedBy = room.pinnedBy || [];
    const isPinned = pinnedBy.includes(currentUser.id);
    
    const updatedPinnedBy = isPinned 
      ? pinnedBy.filter(id => id !== currentUser.id)
      : [...pinnedBy, currentUser.id];

    const updatedRoom = { ...room, pinnedBy: updatedPinnedBy };
    setRooms(prev => prev.map(currentRoom => currentRoom.id === roomId ? updatedRoom : currentRoom));
    try {
      await InternalChatService.saveChat(updatedRoom);
      toast.success(isPinned ? 'Chat desafixado' : 'Chat fixado no topo');
    } catch (error: any) {
      setRooms(prev => prev.map(currentRoom => currentRoom.id === roomId ? room : currentRoom));
      toast.error(error.message || 'Erro ao alterar fixação');
    }
  };

  const updatePreferences = (prefs: Partial<User['chatPreferences']>) => {
    if (!currentUser) return;
    const updatedUser: User = { 
      ...currentUser, 
      chatPreferences: { ...(currentUser.chatPreferences || {}), ...prefs } 
    };
    UserService.save(updatedUser);
    setCurrentUser(updatedUser); // Update context
    setBubbleColor(updatedUser.chatPreferences?.bubbleColor || 'indigo');
    setAvatarSize(updatedUser.chatPreferences?.avatarSize || 'md');
    toast.success('Preferências de chat atualizadas!');
  };

  const handleUpdateGroup = (updates: Partial<InternalGroup>) => {
    if (!selectedRoomId || selectedRoom?.type !== 'group') return;
    const updatedRoom = { ...selectedRoom, ...updates };
    InternalChatService.saveChat(updatedRoom);
    loadRooms();
    toast.success('Grupo atualizado com sucesso!');
  };

  const handleAddMember = (userId: string) => {
    if (!selectedRoomId || !selectedRoom) return;
    if (selectedRoom.memberIds.includes(userId)) return;
    
    const updatedRoom = { 
      ...selectedRoom, 
      memberIds: [...selectedRoom.memberIds, userId],
      messages: [
        ...selectedRoom.messages,
        {
          id: `sys-${generateId()}`,
          senderId: 'system',
          senderName: 'Sistema',
          text: `${currentUser?.name} adicionou ${allUsers.find(u => u.id === userId)?.name} ao grupo`,
          timestamp: new Date().toISOString(),
          type: 'system' as const
        }
      ]
    };
    InternalChatService.saveChat(updatedRoom);
    loadRooms();
    setIsAddingMember(false);
    toast.success('Membro adicionado ao grupo');
  };

  const handleRemoveMember = (userId: string) => {
    if (!selectedRoomId || !selectedRoom || selectedRoom.memberIds.length <= 1) return;
    
    const updatedRoom = { 
      ...selectedRoom, 
      memberIds: selectedRoom.memberIds.filter(id => id !== userId),
      messages: [
        ...selectedRoom.messages,
        {
          id: `sys-${generateId()}`,
          senderId: 'system',
          senderName: 'Sistema',
          text: `${currentUser?.name} removeu ${allUsers.find(u => u.id === userId)?.name} do grupo`,
          timestamp: new Date().toISOString(),
          type: 'system' as const
        }
      ]
    };
    // If current user is removed, deselect room
    if (userId === currentUser?.id) {
      setSelectedRoomId(null);
    }
    InternalChatService.saveChat(updatedRoom);
    loadRooms();
  };

  const toggleMute = async (roomId: string) => {
    if (!currentUser) return;
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    const mutedBy = room.mutedBy || [];
    const isMuted = mutedBy.includes(currentUser.id);
    const updatedMutedBy = isMuted 
      ? mutedBy.filter(id => id !== currentUser.id)
      : [...mutedBy, currentUser.id];
    
    const updatedRoom = { ...room, mutedBy: updatedMutedBy };
    setRooms(prev => prev.map(currentRoom => currentRoom.id === roomId ? updatedRoom : currentRoom));

    try {
      await InternalChatService.saveChat(updatedRoom);
      toast.success(isMuted ? 'Notificações reativadas' : 'Chat silenciado');
    } catch (error: any) {
      setRooms(prev => prev.map(currentRoom => currentRoom.id === roomId ? room : currentRoom));
      toast.error(error.message || 'Erro ao alterar silenciamento');
    }
  };

  const togglePinMessage = async (messageId: string) => {
    if (!selectedRoomId || !selectedRoom) return;
    const pinnedMessageIds = selectedRoom.pinnedMessageIds || [];
    const isPinned = pinnedMessageIds.includes(messageId);
    
    const updatedPinned = isPinned 
      ? pinnedMessageIds.filter(id => id !== messageId)
      : [...pinnedMessageIds, messageId];
    
    const updatedRoom = { ...selectedRoom, pinnedMessageIds: updatedPinned };
    setRooms(prev => prev.map(room => room.id === selectedRoomId ? updatedRoom : room));
    try {
      await InternalChatService.saveChat(updatedRoom);
    } catch (error: any) {
      setRooms(prev => prev.map(room => room.id === selectedRoomId ? selectedRoom : room));
      toast.error(error.message || 'Erro ao fixar mensagem');
    }
  };

  // Painel de fixadas: some ao clicar fora ou no Esc. O ref envolve o botão
  // do header junto com o painel, então clicar no próprio botão não conta
  // como "clique fora" (senão o toggle abriria e fecharia no mesmo evento).
  useEffect(() => {
    if (!showPinnedPanel) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (pinnedPanelRef.current && !pinnedPanelRef.current.contains(event.target as Node)) {
        setShowPinnedPanel(false);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowPinnedPanel(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [showPinnedPanel]);

  // Fechar o painel ao trocar de conversa evita mostrar as fixadas da sala
  // anterior por um frame enquanto as mensagens da nova ainda carregam.
  useEffect(() => {
    setShowPinnedPanel(false);
    setHighlightedMessageId(null);
  }, [selectedRoomId]);

  const jumpToMessage = (messageId: string) => {
    setShowPinnedPanel(false);
    const element = document.getElementById(`chat-msg-anchor-${messageId}`);
    if (!element) {
      toast.error('Mensagem não encontrada nesta conversa');
      return;
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => setHighlightedMessageId(current => (current === messageId ? null : current)), 2200);
  };

  const QUICK_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!currentUser || !selectedRoomId) return;
    setReactionPickerMessageId(null);
    try {
      await InternalChatService.toggleReaction(messageId, currentUser.id, emoji);
      refreshMessages(selectedRoomId);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao reagir à mensagem');
    }
  };

  const toggleReadLater = (roomId: string) => {
    if (!currentUser) return;
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    const readLaterBy = room.readLaterBy || [];
    const isReadLater = readLaterBy.includes(currentUser.id);
    const updatedReadLaterBy = isReadLater 
      ? readLaterBy.filter(id => id !== currentUser.id)
      : [...readLaterBy, currentUser.id];
    
    const updatedRoom = { ...room, readLaterBy: updatedReadLaterBy };
    InternalChatService.saveChat(updatedRoom);
    loadRooms();
    toast.success(isReadLater ? 'Removido de ler depois' : 'Marcado para ler depois');
  };

  const toggleHideRoom = async (roomId: string) => {
    if (!currentUser) return;
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    const hiddenBy = room.hiddenBy || [];
    const isHidden = hiddenBy.includes(currentUser.id);
    const updatedHiddenBy = isHidden 
      ? hiddenBy.filter(id => id !== currentUser.id)
      : [...hiddenBy, currentUser.id];
    
    const updatedRoom = { ...room, hiddenBy: updatedHiddenBy };
    const wasSelected = selectedRoomId === roomId;
    setRooms(prev => prev.map(currentRoom => currentRoom.id === roomId ? updatedRoom : currentRoom));
    if (!isHidden && wasSelected) setSelectedRoomId(null);

    try {
      await InternalChatService.saveChat(updatedRoom);
      toast.success(isHidden ? 'Conversa visível' : 'Conversa arquivada');
    } catch (error: any) {
      setRooms(prev => prev.map(currentRoom => currentRoom.id === roomId ? room : currentRoom));
      if (!isHidden && wasSelected) setSelectedRoomId(roomId);
      toast.error(error.message || 'Erro ao arquivar conversa');
    }
  };

  const handleContextMenu = (e: React.MouseEvent, roomId: string) => {
    e.preventDefault();
    setStickerContextMenu(null);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      roomId
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    const handleGlobalClick = () => {
      closeContextMenu();
      setStickerContextMenu(null);
      setReactionPickerMessageId(null);
      setTicketMenuMessageId(null);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const handleGroupImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = await fileToBase64(file);
      setNewGroupImage(url);
    }
  };

  const resetCreateGroupState = () => {
    setIsCreatingGroup(false);
    setNewGroupName('');
    setNewGroupImage('');
    setSelectedMembers([]);
  };

  const createRoom = () => {
    if (selectedMembers.length === 0 || !currentUser) return;
    const isDirect = selectedMembers.length === 1;
    if (!isDirect && !newGroupName.trim()) return;

    // Este modal ("Novo Grupo") também é usado pra iniciar 1:1 (selecionando
    // só 1 membro) — sem essa checagem, ele nunca reusava uma conversa
    // direct já existente (diferente de startDirectChat, clicar num contato
    // na lista), o que criava uma linha nova a cada tentativa. Era essa a
    // causa do bug relatado ("vejo 3x o mesmo contato").
    if (isDirect) {
      const existing = rooms.find(room => isDirectChatWith(room, selectedMembers[0]));
      if (existing) {
        setSelectedRoomId(existing.id);
        resetCreateGroupState();
        toast.success('Você já tem uma conversa com esse contato.');
        return;
      }
    }

    // Conversa 1:1 sempre leva o nome real do contato — o campo de nome
    // digitado no modal só vale pra grupo de verdade (2+ membros), senão
    // cada tentativa de "Novo Grupo" com 1 membro podia gerar um nome
    // diferente pra mesma pessoa.
    const otherUser = isDirect ? allUsers.find(u => u.id === selectedMembers[0]) : null;
    const roomName = isDirect ? (otherUser?.name || newGroupName.trim() || 'Conversa') : newGroupName.trim();

    const newRoom: InternalGroup = {
      id: isDirect ? `d-${generateId()}` : `g-${generateId()}`,
      name: roomName,
      imageUrl: newGroupImage || undefined,
      type: isDirect ? 'direct' : 'group',
      memberIds: [currentUser.id, ...selectedMembers],
      messages: isDirect ? [] : [
        {
          id: `sys-${generateId()}`,
          senderId: 'system',
          senderName: 'Sistema',
          text: `${currentUser.name} criou o grupo "${roomName}"`,
          timestamp: new Date().toISOString(),
          type: 'system' as const
        }
      ],
      lastMessageAt: new Date().toISOString()
    };

    InternalChatService.saveChat(newRoom)
      .then((chatId) => {
        loadRooms();
        setSelectedRoomId(chatId);
      })
      .catch(err => {
        console.error('Error creating room:', err);
        toast.error(isDirect ? 'Erro ao iniciar conversa' : 'Erro ao criar grupo');
      });
    resetCreateGroupState();
    toast.success(isDirect ? `Conversa com ${roomName} iniciada!` : `Grupo "${roomName}" criado com sucesso!`);
  };

  const toggleMemberSelection = (userId: string) => {
    if (selectedMembers.includes(userId)) {
      setSelectedMembers(selectedMembers.filter(id => id !== userId));
    } else {
      setSelectedMembers([...selectedMembers, userId]);
    }
  };

  const filteredRooms = rooms
    .filter(r => {
      const isHidden = r.hiddenBy?.includes(currentUser?.id || '');
      const isVisible = showHidden || !isHidden;
      const matchesSearch = normalizeString(r.name).includes(normalizeString(searchTerm));
      const matchesUserFilter = findChatsWithUserId ? r.memberIds.includes(findChatsWithUserId) : true;
      return isVisible && matchesSearch && matchesUserFilter;
    })
    .sort((a, b) => {
      const aPinned = a.pinnedBy?.includes(currentUser?.id || '') ? 1 : 0;
      const bPinned = b.pinnedBy?.includes(currentUser?.id || '') ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

  const getDirectChatUser = (room: InternalGroup) => {
    if (room.type !== 'direct') return undefined;
    const isSelfChat = Boolean(currentUser) && room.memberIds.length > 0 &&
      room.memberIds.every(memberId => memberId === currentUser?.id);
    if (isSelfChat) return currentUser || undefined;

    const participantId = room.memberIds.find(id => id !== currentUser?.id) || room.memberIds[0];
    return allUsers.find(user => user.id === participantId) ||
      (participantId === currentUser?.id ? currentUser : undefined);
  };

  const getPresence = (userId?: string) => userId ? analystStatuses.find(s => s.userId === userId) : undefined;

  // Bolinha de status ao lado do avatar — reflete o mesmo status usado no
  // cabeçalho (Disponível/Ausente + motivo), não só um "online" binário.
  // `isOnline` sozinho não basta: ao ficar Ausente, is_online também vira
  // false (ver POST /api/chats "log-status-change"), então usar só isOnline
  // fazia a bolinha simplesmente sumir em vez de virar "ausente".
  const getPresenceIndicator = (userId?: string): { colorClass: string; title: string } | null => {
    const presence = getPresence(userId);
    if (!presence) return null;
    // deriveLiveStatus (lib/presence.ts) trata last_active velho como
    // offline — sem isso, a bolinha ficava "Online"/"Ausente" pra sempre
    // depois que a pessoa fechava a aba sem trocar de status, porque não
    // existe um heartbeat de "adeus" explícito.
    const live = deriveLiveStatus(presence);
    if (live === 'away') {
      return { colorClass: 'bg-[var(--text-warning-strong)]', title: presence.currentReason || 'Ausente' };
    }
    if (live === 'online') {
      return { colorClass: 'bg-[var(--text-success)]', title: 'Online' };
    }
    return null;
  };

  const formatLastActive = (lastActive?: string) => {
    if (!lastActive) return 'visto por último há um tempo';
    const diffMin = Math.floor((Date.now() - new Date(lastActive).getTime()) / 60000);
    if (diffMin < 1) return 'visto agora';
    if (diffMin < 60) return `visto há ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `visto há ${diffHours}h`;
    return `visto há ${Math.floor(diffHours / 24)}d`;
  };

  const presenceLabel = (userId?: string) => {
    const presence = getPresence(userId);
    if (!presence) return '';
    // deriveLiveStatus (lib/presence.ts) — mesma checagem de staleness usada
    // em chat-management/queues/chat-widget. Sem ela, "Ausente"/"Online"
    // ficava valendo pra sempre depois que a aba fechava sem heartbeat.
    const live = deriveLiveStatus(presence);
    if (live === 'away') return presence.currentReason ? `Ausente > ${presence.currentReason}` : 'Ausente';
    if (live === 'online') return 'Online';
    return formatLastActive(presence.lastActive).replace(/^v/, 'V');
  };

  const filteredUsers = allUsers.filter(u =>
    u.id !== currentUser?.id &&
    normalizeString(u.name).includes(normalizeString(searchTerm)) &&
    !rooms.some(room => isDirectChatWith(room, u.id))
  );

  if (!isChatReady) {
    return (
      <div className="h-[calc(100vh-120px)] flex items-center justify-center bg-[var(--surface-card)] rounded-3xl border border-[var(--border-default)] shadow-2xl">
        <div className="flex flex-col items-center gap-3 text-[var(--text-tertiary)]">
          <Loader2 size={28} className="animate-spin text-[var(--accent-text)]" />
          <span className="text-sm font-bold">Carregando conversas...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex bg-[var(--surface-card)] rounded-3xl border border-[var(--border-default)] overflow-hidden shadow-2xl">
      {/* Sidebar */}
      <div className="w-[350px] border-r border-[var(--border-default)] flex flex-col bg-[var(--surface-card)]/30">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">Chat Interno</h1>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowHidden(!showHidden)}
                className={cn(
                  "p-2.5 rounded-xl transition-all border shrink-0",
                  showHidden 
                    ? "bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-200" 
                    : "bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[var(--border-default)]"
                )}
                title={showHidden ? "Ocultar chats arquivados" : "Mostrar chats arquivados"}
              >
                {showHidden ? <Eye size={20} /> : <EyeOff size={20} />}
              </button>
              <button 
                onClick={() => setIsCreatingGroup(true)}
                className="p-2.5 bg-[var(--accent)] text-white rounded-xl hover:bg-[var(--accent-hover)] transition-all shadow-lg shadow-indigo-100 shrink-0"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
            <input 
              type="text"
              placeholder="Buscar pessoas ou grupos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl pl-12 pr-4 py-3 text-sm font-medium outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/5 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-6">
          {findChatsWithUserId && (
            <div className="mb-2 p-3 bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                 <SearchIcon size={14} className="text-[var(--accent-text)]" />
                 <span className="text-[10px] font-semibold text-[var(--accent-text)] uppercase tracking-widest">
                   Filtrando por usuário
                 </span>
              </div>
              <button 
                onClick={() => setFindChatsWithUserId(null)}
                className="p-1 hover:bg-indigo-200/50 rounded-lg text-[var(--accent-text)] transition-colors"
              >
                 <X size={14} />
              </button>
            </div>
          )}

          {/* Active Conversations */}
          {filteredRooms.length > 0 && (
            <div className="space-y-2">
              <p className="px-4 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Conversas</p>
              {filteredRooms.map((room, roomIdx) => {
                const lastMessage = room.messages[room.messages.length - 1];
                const isActive = selectedRoomId === room.id;
                
                // For direct chats, find the other user's info
                const otherUser = getDirectChatUser(room);
                const avatar = room.type === 'group' ? room.imageUrl : (otherUser?.avatarUrl || null);
                const isPinned = room.pinnedBy?.includes(currentUser?.id || '');
                const presenceIndicator = room.type === 'direct' ? getPresenceIndicator(otherUser?.id) : null;

                return (
                  <div 
                    key={`room-${room.id}-${roomIdx}`}
                    onClick={() => setSelectedRoomId(room.id)}
                    onContextMenu={(e) => handleContextMenu(e, room.id)}
                    className={cn(
                      "w-full flex items-center gap-4 p-4 rounded-3xl transition-all text-left group relative cursor-pointer",
                      isActive ? "bg-[var(--surface-card)] shadow-xl shadow-slate-100/50 border border-[var(--border-default)]" : "hover:bg-[var(--surface-card)]/50",
                      room.readLaterBy?.includes(currentUser?.id || '') && "border-2 border-[var(--accent)]/30"
                    )}
                  >
                    <div className="relative shrink-0">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black overflow-hidden bg-[var(--border-default)]",
                        !avatar && (room.type === 'group' ? "bg-[var(--accent)]" : "bg-[var(--text-success)]")
                      )}>
                        {avatar ? (
                          <img src={avatar} alt={room.name} className="w-full h-full object-cover" />
                        ) : (
                          room.type === 'group' ? <Users size={20} /> : room.name.charAt(0)
                        )}
                      </div>
                      {presenceIndicator && (
                        <span
                          title={presenceIndicator.title}
                          className={cn("absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--surface-card)]", presenceIndicator.colorClass)}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-0.5 gap-2">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                           <span className="text-sm font-black text-[var(--text-primary)] truncate">{room.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {room.mutedBy?.includes(currentUser?.id || '') && <BellOff size={10} className="text-slate-300" />}
                          {isPinned && <Pin size={12} className="text-[var(--accent-text)] fill-indigo-500 rotate-45 shrink-0" />}
                          <span className="text-[10px] font-bold text-[var(--text-tertiary)]">
                            {room.lastMessageAt ? new Date(room.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] truncate font-medium">
                        {lastMessage ? (
                          lastMessage.isDeleted ? (lastMessage.text || 'Mensagem apagada') :
                          lastMessage.type === 'text' ? lastMessage.text :
                          lastMessage.type === 'image' ? 'Imagem enviada' :
                          lastMessage.type === 'file' ? 'Arquivo enviado' :
                          lastMessage.type === 'gif' ? 'GIF enviado' :
                          lastMessage.type === 'sticker' ? 'Figurinha enviada' : 'Sistema'
                        ) : 'Sem mensagens'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* All Users / Contacts */}
          {filteredUsers.length > 0 && (
            <div className="space-y-2">
              <p className="px-4 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Contatos</p>
              {filteredUsers.map((user, uIdx) => (
                <button 
                  key={`contact-${user.id}-${uIdx}`}
                  onClick={() => startDirectChat(user)}
                  className="w-full flex items-center gap-4 p-4 rounded-3xl transition-all text-left hover:bg-[var(--surface-card)]/50 group"
                >
                  <div className="relative shrink-0">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black overflow-hidden bg-[var(--border-default)]",
                      !user.avatarUrl && "bg-[var(--text-success)]"
                    )}>
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                      ) : (
                        user.name.charAt(0)
                      )}
                    </div>
                    {getPresenceIndicator(user.id) && (
                      <span
                        title={getPresenceIndicator(user.id)!.title}
                        className={cn("absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--surface-card)]", getPresenceIndicator(user.id)!.colorClass)}
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-black text-[var(--text-primary)] truncate block">{user.name}</span>
                    <p className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter">{user.role}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Window */}
      <div className="flex-1 flex flex-col bg-[var(--surface-card)]">
        {selectedRoom ? (
          <>
            {/* Header */}
            <div className="px-8 py-5 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--surface-card)]/80 backdrop-blur-xl sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black shadow-lg overflow-hidden bg-[var(--border-default)]",
                    selectedRoom.type === 'group' ? "bg-[var(--accent)] shadow-indigo-100" : "bg-[var(--text-success)] shadow-emerald-100"
                  )}>
                    {selectedRoom.type === 'group' ? (
                      selectedRoom.imageUrl ? <img src={selectedRoom.imageUrl} className="w-full h-full object-cover" /> : <Users size={20} />
                    ) : (
                      getDirectChatUser(selectedRoom)?.avatarUrl ? (
                        <img src={getDirectChatUser(selectedRoom)?.avatarUrl} alt={getDirectChatUser(selectedRoom)?.name || selectedRoom.name} className="w-full h-full object-cover" />
                      ) : selectedRoom.name.charAt(0)
                    )}
                  </div>
                  {selectedRoom.type === 'direct' && getPresenceIndicator(getDirectChatUser(selectedRoom)?.id) && (
                    <span
                      title={getPresenceIndicator(getDirectChatUser(selectedRoom)?.id)!.title}
                      className={cn("absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--surface-card)]", getPresenceIndicator(getDirectChatUser(selectedRoom)?.id)!.colorClass)}
                    />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-black text-[var(--text-primary)] tracking-tight">{selectedRoom.name}</h2>
                  <p className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                    {Object.keys(typingUsers).length > 0 ? (
                      <span className="text-[var(--accent-text)] normal-case flex items-center gap-1.5">
                        <span className="flex gap-0.5">
                          <span className="w-1 h-1 rounded-full bg-[var(--accent-text)] animate-bounce [animation-delay:-0.3s]" />
                          <span className="w-1 h-1 rounded-full bg-[var(--accent-text)] animate-bounce [animation-delay:-0.15s]" />
                          <span className="w-1 h-1 rounded-full bg-[var(--accent-text)] animate-bounce" />
                        </span>
                        {selectedRoom.type === 'group' ? `${Object.values(typingUsers).join(', ')} digitando...` : 'digitando...'}
                      </span>
                    ) : selectedRoom.type === 'group' ? (
                      `${(() => {
                        // Set: alguns grupos antigos têm o próprio id
                        // duplicado em memberIds (bug do seletor de "Novo
                        // Grupo", já corrigido — deixava a pessoa se marcar
                        // como membro além de já entrar sozinha na criação),
                        // então contar o array cru inflava tanto "membros"
                        // quanto "online" quando o duplicado estava online.
                        const uniqueMemberIds = [...new Set(selectedRoom.memberIds || [])];
                        const onlineCount = uniqueMemberIds.filter(id => deriveLiveStatus(getPresence(id)) === 'online').length;
                        return `${uniqueMemberIds.length} membros${onlineCount > 0 ? ` · ${onlineCount} online` : ''}`;
                      })()}`
                    ) : (
                      presenceLabel(getDirectChatUser(selectedRoom)?.id) || 'Offline'
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {selectedRoom.type === 'group' && (
                  <button 
                    onClick={() => setShowGroupSettings(true)}
                    className="p-3 text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--accent)]/10 rounded-2xl transition-all"
                    title="Configurações do Grupo"
                  >
                      <Users size={20} />
                  </button>
                )}
                <button 
                  onClick={() => setShowSettings(true)}
                  className="p-3 text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--accent)]/10 rounded-2xl transition-all"
                  title="Minhas Preferências"
                >
                    <Settings size={20} />
                </button>
                <button 
                  onClick={() => toggleMute(selectedRoom.id)}
                  className={cn(
                    "p-3 rounded-2xl transition-all",
                    selectedRoom.mutedBy?.includes(currentUser?.id || '') 
                      ? "text-[var(--text-danger)] bg-[var(--surface-danger)] hover:bg-[var(--surface-danger)]" 
                      : "text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--accent)]/10"
                  )}
                  title={selectedRoom.mutedBy?.includes(currentUser?.id || '') ? "Desativar Mudo" : "Silenciar"}
                >
                    {selectedRoom.mutedBy?.includes(currentUser?.id || '') ? <BellOff size={20} /> : <Bell size={20} />}
                </button>
                {/* Fixadas: ícone no header abre a lista em cartões (estilo
                    Discord). Antes era um item de menu que filtrava a própria
                    conversa, escondendo o resto das mensagens. */}
                <div className="relative" ref={pinnedPanelRef}>
                  <button
                    onClick={() => setShowPinnedPanel(prev => !prev)}
                    className={cn(
                      "relative p-3 rounded-2xl transition-all",
                      showPinnedPanel
                        ? "text-[var(--accent-text)] bg-[var(--accent)]/10"
                        : "text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--accent)]/10"
                    )}
                    title="Mensagens fixadas"
                  >
                    <Pin size={20} />
                    {!!pinnedMessages.length && (
                      <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--accent)] text-white text-[9px] font-black flex items-center justify-center ring-2 ring-[var(--surface-card)]">
                        {pinnedMessages.length}
                      </span>
                    )}
                  </button>

                  <AnimatePresence>
                    {showPinnedPanel && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.98 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-3 w-[420px] max-w-[calc(100vw-4rem)] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-2xl z-50 overflow-hidden origin-top-right"
                      >
                        <div className="px-4 py-3.5 border-b border-[var(--border-default)] flex items-center gap-2">
                          <Pin size={16} className="text-[var(--accent-text)] fill-[var(--accent-text)]" />
                          <h3 className="text-base font-black text-[var(--text-primary)] tracking-tight">Mensagens fixadas</h3>
                        </div>

                        <div className="max-h-[420px] overflow-y-auto p-2.5 space-y-2.5">
                          {pinnedMessages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-2 py-10 px-6 text-center">
                              <Pin size={28} className="text-[var(--text-tertiary)]" />
                              <p className="text-xs font-bold text-[var(--text-secondary)]">Nenhuma mensagem fixada aqui</p>
                              <p className="text-[11px] font-medium text-[var(--text-tertiary)] leading-relaxed">
                                Passe o mouse sobre uma mensagem e use o ícone de alfinete para fixá-la nesta conversa.
                              </p>
                            </div>
                          ) : (
                            pinnedMessages.map(msg => {
                              const sender = allUsers.find(u => u.id === msg.senderId);
                              return (
                                <div
                                  key={`pinned-${msg.id}`}
                                  className="group/pin relative rounded-xl bg-[var(--surface-page)] border border-[var(--border-default)] p-3 hover:border-[var(--accent)]/40 transition-colors"
                                >
                                  <div className="flex gap-3">
                                    <div className="w-10 h-10 rounded-full bg-[var(--border-default)] shrink-0 overflow-hidden">
                                      {sender?.avatarUrl ? (
                                        <img src={sender.avatarUrl} alt={msg.senderName} className="w-full h-full object-cover" />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center text-xs font-black text-[var(--text-tertiary)]">
                                          {msg.senderName.charAt(0)}
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-baseline gap-2 flex-wrap">
                                        <span className="text-sm font-black truncate" style={{ color: getAuthorColor(msg.senderId) }}>
                                          {msg.senderName}
                                        </span>
                                        <span className="text-[11px] font-medium text-[var(--text-tertiary)]">
                                          <ClientTime date={msg.timestamp} showDate showTime />
                                        </span>
                                      </div>

                                      <div className="mt-1 text-sm font-medium text-[var(--text-secondary)] break-words">
                                        {msg.isDeleted ? (
                                          <p className="italic opacity-60">{msg.text || 'Mensagem apagada'}</p>
                                        ) : (
                                          <>
                                            {msg.type === 'text' && (
                                              <p className="whitespace-pre-wrap leading-relaxed">
                                                {renderMessageText(msg.text, msg.metadata?.mentions, false)}
                                                {msg.isEdited && (
                                                  <span className="ml-1 text-[10px] font-medium text-[var(--text-tertiary)]">(editado)</span>
                                                )}
                                              </p>
                                            )}

                                            {msg.type === 'image' && (
                                              <button
                                                type="button"
                                                onClick={() => setPreviewImageUrl(msg.metadata?.fileUrl || null)}
                                                className="block rounded-lg overflow-hidden border border-[var(--border-default)] hover:opacity-90 transition-opacity"
                                              >
                                                <img
                                                  src={msg.metadata?.fileUrl}
                                                  alt={msg.metadata?.fileName || 'Imagem'}
                                                  className="max-w-full max-h-48 object-cover"
                                                />
                                              </button>
                                            )}

                                            {msg.type === 'file' && (
                                              <a
                                                href={msg.metadata?.fileUrl}
                                                download={msg.metadata?.fileName}
                                                className="flex items-center gap-2.5 rounded-lg bg-[var(--surface-pill)] p-2 hover:bg-[var(--surface-card)] transition-colors"
                                              >
                                                <FileText size={16} className="shrink-0 text-[var(--accent-text)]" />
                                                <span className="text-xs font-bold truncate flex-1">{msg.metadata?.fileName || 'Arquivo'}</span>
                                                <Download size={14} className="shrink-0 text-[var(--text-tertiary)]" />
                                              </a>
                                            )}

                                            {msg.type === 'gif' && (
                                              <div className="rounded-lg overflow-hidden border border-[var(--border-default)]">
                                                <img src={msg.metadata?.gifUrl} alt="GIF" className="max-w-full max-h-48" />
                                              </div>
                                            )}

                                            {msg.type === 'sticker' && (
                                              <img src={msg.metadata?.stickerUrl} alt="Sticker" className="w-20 h-20" />
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Ações só no hover, como no Discord (lá elas
                                      ficam no canto superior direito do cartão). */}
                                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/pin:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => jumpToMessage(msg.id)}
                                      title="Ir para a mensagem"
                                      className="px-2 py-1 rounded-lg bg-[var(--surface-card)] border border-[var(--border-default)] text-[10px] font-black uppercase tracking-wide text-[var(--accent-text)] hover:bg-[var(--accent)]/10 transition-colors shadow-sm"
                                    >
                                      Ir
                                    </button>
                                    <button
                                      onClick={() => togglePinMessage(msg.id)}
                                      title="Desafixar"
                                      className="p-1.5 rounded-lg bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-danger)] transition-colors shadow-sm"
                                    >
                                      <PinOff size={12} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-[var(--surface-card)]/50">
              {selectedRoom.messages.map((msg, idx) => {
                const isMine = msg.senderId === currentUser?.id;
                const prevMsg = selectedRoom.messages[idx - 1];
                const showSender = !isMine && (!prevMsg || prevMsg.senderId !== msg.senderId);
                const isPinned = selectedRoom.pinnedMessageIds?.includes(msg.id);
                const repliedMessage = msg.replyToId ? selectedRoom.messages.find(m => m.id === msg.replyToId) : null;

                // Hidden deleted message (deleted before being read)
                if (msg.isDeleted && !msg.text) return null;

                const bubbleColorClass = isMine
                  ? (BUBBLE_COLOR_BG_CLASS[bubbleColor] || BUBBLE_COLOR_BG_CLASS.indigo)
                  : "bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)]";
                
                const avatarSizeClass = cn(
                  avatarSize === 'xs' && "w-6 h-6",
                  avatarSize === 'sm' && "w-8 h-8",
                  avatarSize === 'md' && "w-10 h-10",
                  avatarSize === 'lg' && "w-12 h-12",
                  avatarSize === 'none' && "hidden"
                );

                if (msg.type === 'system') {
                  if (!msg.text) return null;
                  return (
                    <div key={`sys-msg-${msg.id}-${idx}`} className="flex justify-center py-2">
                      <span className="px-4 py-1.5 bg-[var(--surface-pill)] text-[var(--text-tertiary)] text-[10px] font-semibold uppercase tracking-widest rounded-full">
                        {msg.text}
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={`chat-msg-${msg.id}-${idx}`}
                    id={`chat-msg-anchor-${msg.id}`}
                    className={cn(
                      "flex gap-3 max-w-[85%] group animate-in fade-in slide-in-from-bottom-2 duration-300 rounded-3xl transition-colors duration-500",
                      isMine ? "ml-auto flex-row-reverse" : "mr-auto flex-row",
                      highlightedMessageId === msg.id && "bg-[var(--accent)]/10 ring-2 ring-[var(--accent)]/30"
                    )}
                  >
                    {!isMine && avatarSize !== 'none' && (
                      <div className={cn("rounded-2xl bg-[var(--border-default)] shrink-0 overflow-hidden mt-6 shadow-sm", avatarSizeClass)}>
                         {allUsers.find(u => u.id === msg.senderId)?.avatarUrl ? (
                           <img src={allUsers.find(u => u.id === msg.senderId)?.avatarUrl} className="w-full h-full object-cover" />
                         ) : (
                           <div className="w-full h-full flex items-center justify-center text-[10px] font-black text-[var(--text-tertiary)]">
                             {msg.senderName.charAt(0)}
                           </div>
                         )}
                      </div>
                    )}

                    <div className={cn("flex flex-col", isMine ? "items-end" : "items-start")}>
                      {showSender && (
                        <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5 ml-1">
                          {msg.senderName}
                        </span>
                      )}
                      <div className={cn(
                        "relative p-4 rounded-3xl shadow-sm text-sm font-medium",
                        isMine ? "text-white rounded-br-none" : "rounded-bl-none",
                        bubbleColorClass,
                        msg.isDeleted && "italic opacity-80",
                        isPinned && "ring-2 ring-[var(--accent)]/20"
                      )}>
                        {isPinned && (
                           <div className="absolute -top-2 -right-2 w-5 h-5 bg-[var(--accent)] rounded-full flex items-center justify-center text-white shadow-lg border border-white">
                              <Pin size={10} className="fill-white" />
                           </div>
                        )}
                        {repliedMessage && !msg.isDeleted && (
                           <div className={cn(
                             "mb-2 p-2 rounded-xl border-l-4 bg-black/5 flex flex-col gap-1",
                             isMine ? "border-white/40" : "border-[var(--accent)]/40"
                           )}>
                             <span className="text-[10px] font-semibold uppercase opacity-60">
                               {repliedMessage.senderName}
                             </span>
                             <p className="text-[11px] line-clamp-1 opacity-80">
                               {repliedMessage.text || (repliedMessage.type === 'file' ? 'Arquivo' : 'Mídia')}
                             </p>
                           </div>
                        )}
                        {msg.isDeleted ? (
                          <p className="leading-relaxed flex items-center gap-2 opacity-60">
                             <X size={12} /> {msg.text}
                          </p>
                        ) : (
                          <>
                            {msg.type === 'text' && (
                              <p className="leading-relaxed whitespace-pre-wrap break-words">{renderMessageText(msg.text, msg.metadata?.mentions, isMine)}</p>
                            )}
                            
                            {msg.type === 'image' && (
                              <button
                                type="button"
                                onClick={() => setPreviewImageUrl(msg.metadata?.fileUrl || null)}
                                className="block rounded-2xl overflow-hidden shadow-lg border border-white/10 hover:opacity-90 transition-opacity"
                              >
                                <img src={msg.metadata?.fileUrl} alt={msg.metadata?.fileName || 'Imagem'} className="max-w-[240px] max-h-64 w-full object-cover" />
                              </button>
                            )}

                            {msg.type === 'file' && (
                              <a
                                href={msg.metadata?.fileUrl}
                                download={msg.metadata?.fileName}
                                className={cn(
                                  "flex items-center gap-4 rounded-2xl p-2 transition-colors",
                                  isMine ? "bg-white/10 hover:bg-white/20" : "bg-[var(--surface-card)] hover:bg-[var(--surface-pill)]"
                                )}
                              >
                                <div className={cn(
                                  "w-10 h-10 rounded-xl flex items-center justify-center",
                                  isMine ? "bg-white/20" : "bg-[var(--surface-card)] border border-[var(--border-default)]"
                                )}>
                                  <FileText size={20} />
                                </div>
                                <div className="flex-1 min-w-0 pr-4">
                                  <p className="text-xs font-black truncate">{msg.metadata?.fileName || 'Arquivo'}</p>
                                  <p className="text-[10px] font-bold opacity-60">{(msg.metadata?.fileSize || 0) / 1000} KB</p>
                                </div>
                                <div className={cn("p-2 rounded-lg", isMine ? "text-white" : "text-[var(--text-secondary)]")}>
                                  <Download size={16} />
                                </div>
                              </a>
                            )}

                            {msg.type === 'gif' && (
                               <div className="rounded-2xl overflow-hidden shadow-lg border-2 border-white/20">
                                  <img src={msg.metadata?.gifUrl} alt="GIF" className="max-w-[240px] h-auto" />
                               </div>
                            )}

                            {msg.type === 'sticker' && (
                               <img src={msg.metadata?.stickerUrl} alt="Sticker" className="w-[120px] h-[120px] hover:scale-110 transition-transform cursor-pointer" />
                            )}
                          </>
                        )}

                        {/* Barra de ações: flutua ACIMA da bolha (nunca
                            embaixo) — colada embaixo colidia com o horário/
                            check e com as reações, que ficam logo abaixo da
                            bolha, no fluxo normal (ver mais adiante). Ícones
                            em vez de texto pra caber sem quebrar linha. */}
                        <div className={cn(
                          "absolute -top-4 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-[var(--surface-card)] border border-[var(--border-default)] rounded-full px-1.5 py-1 shadow-sm z-10",
                          isMine ? "right-2" : "left-2"
                        )}>
                          {!msg.isDeleted && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); setReactionPickerMessageId(reactionPickerMessageId === msg.id ? null : msg.id); }}
                                title="Reagir"
                                className="p-1 rounded-full text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--surface-pill)] transition-colors"
                              >
                                <Smile size={13} />
                              </button>
                              <button
                                onClick={() => setReplyingToId(msg.id)}
                                title="Responder"
                                className="p-1 rounded-full text-[var(--accent-text)] hover:bg-[var(--surface-pill)] transition-colors"
                              >
                                <Reply size={13} />
                              </button>
                              <button
                                onClick={() => togglePinMessage(msg.id)}
                                title={isPinned ? 'Desafixar' : 'Fixar'}
                                className={cn(
                                  "p-1 rounded-full hover:bg-[var(--surface-pill)] transition-colors",
                                  isPinned ? "text-[var(--accent-text)]" : "text-[var(--text-tertiary)] hover:text-[var(--accent-text)]"
                                )}
                              >
                                {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setTicketMenuMessageId(ticketMenuMessageId === msg.id ? null : msg.id); }}
                                title="Transformar em chamado"
                                className="p-1 rounded-full text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--surface-pill)] transition-colors"
                              >
                                <MoreHorizontal size={13} />
                              </button>
                            </>
                          )}
                          {isMine && !msg.isDeleted && (
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              title="Excluir"
                              className="p-1 rounded-full text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>

                        {reactionPickerMessageId === msg.id && (
                          <div
                            className={cn(
                              "absolute -top-14 z-20 flex items-center gap-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-full shadow-xl px-2 py-1.5",
                              isMine ? "right-0" : "left-0"
                            )}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {QUICK_REACTION_EMOJIS.map(emoji => (
                              <button
                                key={emoji}
                                onClick={() => toggleReaction(msg.id, emoji)}
                                className="text-base hover:scale-125 transition-transform"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}

                        {ticketMenuMessageId === msg.id && (
                          <div
                            className={cn(
                              "absolute top-3 z-20 w-52 py-1.5 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl",
                              isMine ? "right-2" : "left-2"
                            )}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => handleCreateTicketFromMessage(msg)}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] hover:text-[var(--accent-text)] transition-colors text-left"
                            >
                              <Ticket size={14} />
                              Criar chamado
                            </button>
                            {hasPermission(Permission.INTERNAL_TICKETS_EDIT) && (
                              <button
                                onClick={() => handleCreateInternalTicketFromMessage(msg)}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] hover:text-[var(--accent-text)] transition-colors text-left"
                              >
                                <ClipboardList size={14} />
                                Criar chamado interno
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <span className="flex items-center gap-1.5 text-[9px] font-bold text-[var(--text-tertiary)] mt-1 px-1">
                        <ClientTime date={msg.timestamp} />
                        {isMine && (() => {
                          // 3 estados persistidos de verdade agora (antes
                          // era só client-side): 1 check = enviado, 2
                          // cinza = entregue (deliveredBy), 2 coloridos =
                          // todos os outros membros leram (readBy).
                          const otherIds = (selectedRoom.memberIds || []).filter(id => id !== msg.senderId);
                          const deliveredCount = otherIds.filter(id => msg.deliveredBy?.includes(id)).length;
                          const readCount = otherIds.filter(id => msg.readBy?.includes(id)).length;
                          if (otherIds.length > 0 && readCount >= otherIds.length) {
                            return <CheckCheck size={12} className="text-[var(--text-info)]" />;
                          }
                          if (deliveredCount > 0) {
                            return <CheckCheck size={12} className="text-slate-300" />;
                          }
                          return <Check size={12} className="text-slate-300" />;
                        })()}
                      </span>

                      {!!msg.reactions?.length && (
                        <div className={cn("flex flex-wrap gap-1 mt-1.5", isMine ? "justify-end" : "justify-start")}>
                          {Object.entries(
                            msg.reactions.reduce<Record<string, number>>((acc, r) => {
                              acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                              return acc;
                            }, {})
                          ).map(([emoji, count]) => {
                            const reactedByMe = msg.reactions!.some(r => r.emoji === emoji && r.userId === currentUser?.id);
                            return (
                              <button
                                key={emoji}
                                onClick={() => toggleReaction(msg.id, emoji)}
                                className={cn(
                                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border transition-colors",
                                  reactedByMe
                                    ? "bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent-text)]"
                                    : "bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent)]/30"
                                )}
                              >
                                <span>{emoji}</span>
                                {count > 1 && <span>{count}</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-6 bg-[var(--surface-card)] border-t border-[var(--border-default)]">
              <div className="max-w-4xl mx-auto relative">
                {replyingToId && (
                   <div className="mb-4 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-4 flex items-center justify-between animate-in slide-in-from-bottom-2">
                      <div className="flex-1 min-w-0 border-l-4 border-[var(--accent)] pl-4">
                         <p className="text-[10px] font-semibold uppercase text-[var(--accent-text)] truncate">
                            Respondendo para {selectedRoom.messages.find(m => m.id === replyingToId)?.senderId === currentUser?.id ? 'você' : selectedRoom.messages.find(m => m.id === replyingToId)?.senderName}
                         </p>
                         <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">
                            {selectedRoom.messages.find(m => m.id === replyingToId)?.text || 'Mídia'}
                         </p>
                      </div>
                      <button 
                        onClick={() => setReplyingToId(null)}
                        className="p-2 hover:bg-[var(--border-default)] rounded-xl transition-all text-[var(--text-tertiary)]"
                      >
                         <X size={18} />
                      </button>
                   </div>
                )}
                <AnimatePresence>
                  {showEmojiPicker && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-full mb-4 left-0 z-50 rounded-3xl overflow-hidden shadow-2xl"
                    >
                      <EmojiPicker 
                        onEmojiClick={(emojiData) => setMessage(prev => prev + emojiData.emoji)}
                        theme={EmojiTheme.LIGHT}
                        lazyLoadEmojis={true}
                        searchPlaceholder="Buscar emoji..."
                      />
                    </motion.div>
                  )}

                  {showStickerPicker && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-full mb-4 left-0 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl p-6 shadow-2xl z-20 w-[300px]"
                    >
                        <div className="flex items-center justify-between mb-4">
                           <p className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Stickers</p>
                           <button 
                             onClick={() => stickerInputRef.current?.click()}
                             className="flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--accent-text)] hover:text-indigo-800 transition-colors"
                           >
                             <Plus size={12} /> Novo
                           </button>
                           <input 
                             type="file" 
                             className="hidden" 
                             ref={stickerInputRef} 
                             accept="image/*"
                             onChange={async (e) => {
                               const file = e.target.files?.[0];
                               if (file) {
                                  const url = await fileToBase64(file);
                                  setTempStickerUrl(url);
                                  setIsTempStickerGif(file.type === 'image/gif');
                                  setIsCroppingSticker(true);
                                  setShowStickerPicker(false);
                               }
                             }}
                           />
                        </div>
                      <div className="max-h-[300px] overflow-y-auto pr-2">
                         {currentUser?.chatPreferences?.personalStickers && (currentUser.chatPreferences.personalStickers?.length || 0) > 0 && (
                           <div className="mb-6">
                              <p className="text-[8px] font-semibold text-slate-300 uppercase mb-3 tracking-widest">Seus Stickers</p>
                              <div className="grid grid-cols-3 gap-3">
                                 {(currentUser.chatPreferences.personalStickers || []).map((url, idx) => (
                                   <button 
                                     key={`personal-sticker-${idx}`}
                                     onClick={() => handleSendMessage('sticker', url)}
                                     onContextMenu={(e) => {
                                       e.preventDefault();
                                       setContextMenu(null);
                                       setStickerContextMenu({ x: e.clientX, y: e.clientY, index: idx });
                                     }}
                                     className="aspect-square rounded-xl overflow-hidden hover:scale-110 transition-all border border-[var(--border-default)] relative group"
                                   >
                                     <img src={url} alt="Custom" className="w-full h-full object-contain" />
                                     <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                        <p className="text-[8px] text-white font-semibold uppercase">Excluir (R-Click)</p>
                                     </div>
                                   </button>
                                 ))}
                              </div>
                           </div>
                         )}

                           <p className="text-[8px] font-semibold text-slate-300 uppercase mb-3 tracking-widest">Padrão</p>
                           <div className="grid grid-cols-3 gap-3">
                              {STICKERS.map((s, idx) => (
                                <button 
                                  key={`standard-${s.name}-${idx}`}
                                  onClick={() => handleSendMessage('sticker', s.url)}
                                  className="aspect-square hover:scale-110 transition-all"
                                >
                                  <img src={s.url} alt={s.name} className="w-full h-full object-contain" />
                                </button>
                              ))}
                           </div>
                        </div>
                    </motion.div>
                  )}

                  {showGifSearch && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-full mb-4 left-0 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl p-6 shadow-2xl z-20 min-w-[320px]"
                    >
                       <div className="flex items-center gap-2 mb-4 bg-[var(--surface-pill)] rounded-xl p-2 pr-4">
                          <SearchIcon size={16} className="text-[var(--text-tertiary)] ml-2" />
                          <input 
                            type="text"
                            placeholder="Buscar GIFs..."
                            value={gifQuery}
                            onChange={(e) => setGifQuery(e.target.value)}
                            className="bg-transparent border-none outline-none text-xs font-bold flex-1"
                          />
                       </div>
                       <div className="grid grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2">
                          {[
                            '3o7TKSjPChZSMz_rTG',
                            'l0Exk8EUzMbh6K0xc',
                            '26u49S62S2CQUX2N2',
                            'l41lI4BdzkXQ2wN5S',
                            '3o7TKMGpxU88hK17q0',
                          ].map((id, idx) => (
                            <button 
                              key={`${id}-${idx}`}
                              onClick={() => handleSendMessage('gif', `https://i.giphy.com/media/${id}/giphy.gif`)}
                              className="rounded-lg overflow-hidden h-24 hover:opacity-80 transition-all bg-[var(--surface-pill)]"
                            >
                              <img src={`https://i.giphy.com/media/${id}/giphy.gif`} alt="GIF" className="w-full h-full object-cover" />
                            </button>
                          ))}
                       </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex items-center gap-4 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-3 pl-6 pr-3 shadow-inner">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        setShowEmojiPicker(!showEmojiPicker);
                        setShowStickerPicker(false);
                        setShowGifSearch(false);
                      }}
                      className={cn("p-2 rounded-full transition-all", showEmojiPicker ? "bg-[var(--accent)]/20 text-[var(--accent-text)]" : "text-[var(--text-tertiary)] hover:text-[var(--accent-text)]")}
                    >
                      <Smile size={24} />
                    </button>
                    <button 
                      onClick={() => {
                        setShowStickerPicker(!showStickerPicker);
                        setShowEmojiPicker(false);
                        setShowGifSearch(false);
                      }}
                      className={cn("p-2 rounded-full transition-all", showStickerPicker ? "bg-[var(--accent)]/20 text-[var(--accent-text)]" : "text-[var(--text-tertiary)] hover:text-[var(--accent-text)]")}
                    >
                      <ImageIcon size={24} />
                    </button>
                    <button 
                      onClick={() => {
                        setShowGifSearch(!showGifSearch);
                        setShowEmojiPicker(false);
                        setShowStickerPicker(false);
                      }}
                      className={cn("px-2 py-1 rounded-lg transition-all font-black text-xs", showGifSearch ? "bg-[var(--accent)]/20 text-[var(--accent-text)]" : "text-[var(--text-tertiary)] hover:text-[var(--accent-text)]")}
                    >
                      GIF
                    </button>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 text-[var(--text-tertiary)] hover:text-[var(--accent-text)] transition-all"
                    >
                      <Paperclip size={24} />
                    </button>
                    <input 
                      type="file" 
                      className="hidden" 
                      ref={fileInputRef} 
                      onChange={handleFileUpload}
                    />
</div>
                   
                   <div className="flex-1 relative mx-4">
                     <AnimatePresence>
                       {mentionQuery !== null && mentionCandidates.length > 0 && (
                         <motion.div
                           initial={{ opacity: 0, y: 10, scale: 0.95 }}
                           animate={{ opacity: 1, y: 0, scale: 1 }}
                           exit={{ opacity: 0, y: 10, scale: 0.95 }}
                           className="absolute bottom-full mb-3 left-0 w-64 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-2xl overflow-hidden z-30"
                         >
                           {mentionCandidates.map((user, idx) => (
                             <button
                               key={user.id}
                               type="button"
                               onMouseDown={(e) => { e.preventDefault(); insertMention(user); }}
                               onMouseEnter={() => setMentionActiveIndex(idx)}
                               className={cn(
                                 "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                                 idx === mentionActiveIndex ? "bg-[var(--accent)]/10" : "hover:bg-[var(--surface-pill)]"
                               )}
                             >
                               <UserAvatar
                                 name={user.name}
                                 thumbUrl={user.avatarThumbUrl}
                                 url={user.avatarUrl}
                                 size={32}
                                 fallbackClassName="bg-[var(--accent)] text-white font-black"
                               />
                               <span className="text-xs font-bold text-[var(--text-primary)] truncate">{user.name}</span>
                             </button>
                           ))}
                         </motion.div>
                       )}
                     </AnimatePresence>
                     <textarea
                       ref={messageInputRef}
                       rows={1}
                       value={message}
                       onChange={handleMessageInputChange}
                       onKeyDown={(e) => {
                         if (mentionQuery !== null && mentionCandidates.length > 0) {
                           if (e.key === 'ArrowDown') {
                             e.preventDefault();
                             setMentionActiveIndex(prev => (prev + 1) % mentionCandidates.length);
                             return;
                           }
                           if (e.key === 'ArrowUp') {
                             e.preventDefault();
                             setMentionActiveIndex(prev => (prev - 1 + mentionCandidates.length) % mentionCandidates.length);
                             return;
                           }
                           if (e.key === 'Enter' || e.key === 'Tab') {
                             e.preventDefault();
                             insertMention(mentionCandidates[mentionActiveIndex]);
                             return;
                           }
                           if (e.key === 'Escape') {
                             e.preventDefault();
                             setMentionQuery(null);
                             return;
                           }
                         }
                         // Enter sozinho envia; Shift+Enter deixa o textarea
                         // quebrar linha normalmente (sem preventDefault).
                         if (e.key === 'Enter' && !e.shiftKey) {
                           e.preventDefault();
                           handleSendMessage();
                         }
                       }}
                       placeholder={selectedRoom?.type === 'group' ? "Escreva uma mensagem... (@ para citar alguém)" : "Escreva sua mensagem..."}
                       className="w-full bg-transparent border-none outline-none text-sm font-bold text-[var(--text-secondary)] resize-none leading-relaxed py-1"
                     />
                   </div>

                   <button 
                     onClick={() => handleSendMessage()}
                     disabled={!message.trim()}
                     className="w-12 h-12 bg-[var(--accent)] text-white rounded-full flex items-center justify-center hover:bg-[var(--accent-hover)] transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
                   >
                     <Send size={20} />
                   </button>
                 </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-[var(--surface-card)]/30">
            <div className="w-24 h-24 bg-[var(--surface-card)] rounded-[2rem] flex items-center justify-center shadow-2xl shadow-indigo-100 mb-8 border border-[var(--border-default)]">
               <MessageCircle className="text-[var(--accent-text)]" size={48} />
            </div>
            <h3 className="text-2xl font-black text-[var(--text-primary)] tracking-tight mb-3">Bem-vindo ao Chat Interno</h3>
            <p className="text-[var(--text-tertiary)] font-medium max-w-sm leading-relaxed">
              Selecione uma conversa ao lado ou crie um novo grupo para começar a colaborar com sua equipe em tempo real.
            </p>
          </div>
        )}
      </div>

      {/* Create Group Modal */}
      <AnimatePresence>
        {isCreatingGroup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
             <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => setIsCreatingGroup(false)}
               className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
             />
             <motion.div 
               initial={{ opacity: 0, scale: 0.95, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95, y: 20 }}
               className="relative w-full max-w-md bg-[var(--surface-card)] rounded-[2.5rem] shadow-2xl overflow-hidden"
             >
                <div className="p-8 border-b border-[var(--border-default)] flex items-center justify-between">
                   <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight">Novo Grupo</h3>
                   <button onClick={() => setIsCreatingGroup(false)} className="p-2 hover:bg-[var(--surface-pill)] rounded-xl transition-all">
                      <X size={20} className="text-[var(--text-tertiary)]" />
                   </button>
                </div>

                <div className="p-8 space-y-6">
                   <div className="flex justify-center">
                      <div 
                        onClick={() => groupImageRef.current?.click()}
                        className="w-24 h-24 rounded-[2rem] bg-[var(--surface-card)] border-2 border-dashed border-[var(--border-default)] flex flex-col items-center justify-center cursor-pointer hover:border-[var(--accent)] hover:bg-[var(--surface-pill)] transition-all overflow-hidden relative group"
                      >
                         {newGroupImage ? (
                           <img src={newGroupImage} className="w-full h-full object-cover" />
                         ) : (
                           <>
                             <ImageIcon size={24} className="text-[var(--text-tertiary)] mb-1" />
                             <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase">Logo</span>
                           </>
                         )}
                         <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Plus size={24} className="text-white" />
                         </div>
                      </div>
                      <input
                        type="file"
                        className="hidden"
                        ref={groupImageRef}
                        onChange={handleGroupImageUpload}
                        accept="image/*"
                      />
                   </div>

                   {/* Galeria de ícones prontos — alternativa rápida ao
                       upload acima, ver lib/group-avatar-presets.ts. */}
                   <div className="flex justify-center gap-2 flex-wrap">
                      {GROUP_AVATAR_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setNewGroupImage(preset.url)}
                          title={preset.label}
                          className={cn(
                            "w-9 h-9 rounded-xl overflow-hidden transition-all hover:scale-110",
                            newGroupImage === preset.url ? "ring-2 ring-[var(--accent)] ring-offset-2" : "ring-1 ring-[var(--border-default)]"
                          )}
                        >
                          <img src={preset.url} alt={preset.label} className="w-full h-full object-cover" />
                        </button>
                      ))}
                   </div>

                   <div className="space-y-2">
                      <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">
                        {selectedMembers.length === 1 ? 'Nome do Grupo (opcional para conversa 1:1)' : 'Nome do Grupo'}
                      </label>
                      <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Ex: Time de Suporte, Infraestrutura..."
                        className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/5 transition-all"
                      />
                   </div>

                   <div className="space-y-3">
                      <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Membros (Mais de 1 vira grupo)</label>
                      <div className="max-h-[300px] overflow-y-auto space-y-1 pr-2">
                         {/* Exclui o próprio usuário logado — ele já entra
                             sozinho na criação (memberIds: [currentUser.id,
                             ...selectedMembers], ver createRoom), então
                             mostrá-lo aqui como opção marcável deixava
                             selecioná-lo por engano e duplicar o próprio id
                             em memberIds (causa da chave repetida/membro
                             aparecendo 2x na lista de Configurações). */}
                         {allUsers.filter(u => u.id !== currentUser?.id).map((user, uIdx) => (
                           <button
                             key={`create-group-user-${user.id}-${uIdx}`}
                             onClick={() => toggleMemberSelection(user.id)}
                             className={cn(
                               "w-full flex items-center gap-4 p-3 rounded-2xl transition-all",
                               selectedMembers.includes(user.id) ? "bg-[var(--accent)]/10" : "hover:bg-[var(--surface-card)]"
                             )}
                           >
                              <UserAvatar
                                name={user.name}
                                thumbUrl={user.avatarThumbUrl}
                                url={user.avatarUrl}
                                size={40}
                                rounded="rounded-xl"
                                fallbackClassName={cn(
                                  "text-white font-black",
                                  selectedMembers.includes(user.id) ? "bg-[var(--accent)]" : "bg-[var(--text-tertiary)]"
                                )}
                              />
                              <div className="flex-1 text-left">
                                 <p className="text-sm font-black text-[var(--text-primary)]">{user.name}</p>
                                 <p className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter">{user.role}</p>
                              </div>
                              {selectedMembers.includes(user.id) && (
                                <div className="w-6 h-6 bg-[var(--accent)] rounded-full flex items-center justify-center text-white">
                                   <Check size={14} />
                                </div>
                              )}
                           </button>
                         ))}
                      </div>
                   </div>

                   <button
                     onClick={createRoom}
                     disabled={selectedMembers.length === 0 || (selectedMembers.length > 1 && !newGroupName.trim())}
                     className="w-full bg-[var(--accent)] text-white rounded-2xl py-4 font-black transition-all hover:bg-[var(--accent-hover)] shadow-xl shadow-indigo-100 disabled:opacity-50"
                   >
                     Criar Conversa
                   </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Group Settings Modal */}
      <AnimatePresence>
        {showGroupSettings && selectedRoom && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowGroupSettings(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-[var(--surface-card)] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-[var(--border-default)] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                   <div className="p-2 bg-[var(--accent)]/10 rounded-xl text-[var(--accent-text)]">
                      <Users size={20} />
                   </div>
                   <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight">Configurações do Grupo</h3>
                </div>
                <button onClick={() => setShowGroupSettings(false)} className="p-2 hover:bg-[var(--surface-pill)] rounded-xl transition-all">
                  <X size={20} className="text-[var(--text-tertiary)]" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Basic Group Info */}
                <div className="flex items-center gap-6">
                   <div 
                     onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.onchange = async (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) {
                            const base64 = await fileToBase64(file);
                            handleUpdateGroup({ imageUrl: base64 });
                          }
                        };
                        input.click();
                     }}
                     className="w-24 h-24 rounded-[2rem] bg-[var(--surface-pill)] border-2 border-[var(--border-default)] flex items-center justify-center cursor-pointer hover:border-[var(--accent)] transition-all overflow-hidden shrink-0 group relative"
                   >
                      {selectedRoom.imageUrl ? (
                        <img src={selectedRoom.imageUrl} className="w-full h-full object-cover" />
                      ) : (
                        <Users size={32} className="text-[var(--text-tertiary)]" />
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Plus size={24} className="text-white" />
                      </div>
                   </div>
                   <div className="flex-1 space-y-2">
                       <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Nome do Grupo</label>
                       <input 
                         type="text"
                         value={selectedRoom.name}
                         onChange={(e) => handleUpdateGroup({ name: e.target.value })}
                         className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-5 py-3 text-sm font-bold outline-none focus:border-[var(--accent)] transition-all"
                       />
                   </div>
                </div>

                {/* Galeria de ícones prontos — alternativa rápida ao upload
                    acima, ver lib/group-avatar-presets.ts. */}
                <div className="space-y-2">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Ícones prontos</label>
                  <div className="flex gap-2 flex-wrap">
                    {GROUP_AVATAR_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleUpdateGroup({ imageUrl: preset.url })}
                        title={preset.label}
                        className={cn(
                          "w-9 h-9 rounded-xl overflow-hidden transition-all hover:scale-110",
                          selectedRoom.imageUrl === preset.url ? "ring-2 ring-[var(--accent)] ring-offset-2" : "ring-1 ring-[var(--border-default)]"
                        )}
                      >
                        <img src={preset.url} alt={preset.label} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Member List */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">
                       <Users size={14} /> Membros ({new Set(selectedRoom.memberIds || []).size})
                    </div>
                    <button 
                      onClick={() => setIsAddingMember(!isAddingMember)}
                      className="flex items-center gap-2 text-[10px] font-semibold uppercase text-[var(--accent-text)] hover:text-indigo-800 tracking-widest"
                    >
                      <UserPlus size={14} /> Adicionar
                    </button>
                  </div>

                  {isAddingMember && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-[var(--surface-card)] rounded-3xl border border-[var(--border-default)] animate-in fade-in slide-in-from-top-2"
                    >
                       <p className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase mb-3 px-2">Selecionar Usuário</p>
                       <div className="max-h-[200px] overflow-y-auto space-y-1">
                          {allUsers.filter(u => !selectedRoom.memberIds?.includes(u.id)).map((user, idx) => (
                            <button 
                              key={`add-member-${user.id || idx}`}
                              onClick={() => handleAddMember(user.id)}
                              className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-[var(--surface-card)] transition-all text-left"
                            >
                               <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white text-xs font-black">
                                  {user.name.charAt(0)}
                               </div>
                               <div>
                                  <p className="text-xs font-black text-[var(--text-primary)]">{user.name}</p>
                                  <p className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter">{user.role}</p>
                               </div>
                               <Plus size={14} className="ml-auto text-[var(--accent-text)]" />
                            </button>
                          ))}
                       </div>
                    </motion.div>
                  )}

                  <div className="space-y-2">
                    {/* Set: alguns grupos antigos têm o próprio id duplicado
                        em memberIds (bug já corrigido no seletor de "Novo
                        Grupo", que deixava a pessoa se marcar como membro
                        além de já entrar sozinha na criação) — sem isso,
                        dava key repetida e o membro aparecia 2x na lista. */}
                    {[...new Set(selectedRoom.memberIds || [])].map((userId, idx) => {
                      const user = allUsers.find(u => u.id === userId) || (userId === currentUser?.id ? currentUser : null);
                      if (!user) return null;
                      return (
                        <div key={`member-${userId || idx}`} className="flex items-center gap-4 p-3 rounded-3xl hover:bg-[var(--surface-card)] transition-all group/member">
                           <div className="w-10 h-10 rounded-xl bg-[var(--surface-pill)] flex items-center justify-center overflow-hidden">
                              {user.avatarUrl ? <img src={user.avatarUrl} className="w-full h-full object-cover" /> : <span className="font-black text-[var(--text-tertiary)]">{user.name.charAt(0)}</span>}
                           </div>
                           <div className="flex-1">
                              <p className="text-sm font-black text-[var(--text-primary)]">{user.name}{userId === currentUser?.id && ' (Sua conta)'}</p>
                              <p className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter">{user.role}</p>
                           </div>
                           {userId !== currentUser?.id && (
                             <button 
                               onClick={() => handleRemoveMember(userId)}
                               className="p-2 text-slate-300 hover:text-[var(--text-danger)] opacity-0 group-hover/member:opacity-100 transition-all"
                               title="Remover Membro"
                             >
                                <UserMinus size={18} />
                             </button>
                           )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={() => {
                      handleRemoveMember(currentUser!.id);
                      setShowGroupSettings(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-4 text-[var(--text-danger)] font-black text-sm uppercase tracking-widest hover:bg-[var(--surface-danger)] rounded-2xl transition-all"
                  >
                     <Trash2 size={18} /> Sair do Grupo
                  </button>
                </div>
              </div>

              <div className="p-8 pt-0 shrink-0">
                <button 
                  onClick={() => setShowGroupSettings(false)}
                  className="w-full bg-slate-900 text-white rounded-2xl py-4 font-black transition-all hover:bg-slate-800 shadow-xl shadow-slate-100"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[var(--surface-card)] rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[var(--border-default)] flex items-center justify-between">
                <div className="flex items-center gap-3">
                   <div className="p-2 bg-[var(--accent)]/10 rounded-xl text-[var(--accent-text)]">
                      <Settings size={20} />
                   </div>
                   <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight">Personalização</h3>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-[var(--surface-pill)] rounded-xl transition-all">
                  <X size={20} className="text-[var(--text-tertiary)]" />
                </button>
              </div>

              <div className="p-8 space-y-8">
                {/* Bubble Color */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">
                     <Palette size={14} /> Cor das Bolhas
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {Object.keys(BUBBLE_COLOR_BG_CLASS).map(color => (
                       <button
                         key={color}
                         onClick={() => updatePreferences({ bubbleColor: color })}
                         className={cn(
                           "w-10 h-10 rounded-xl transition-all flex items-center justify-center border-2",
                           BUBBLE_COLOR_BG_CLASS[color],
                           bubbleColor === color ? "border-[var(--accent)] scale-110 shadow-lg" : "border-transparent opacity-80"
                         )}
                       >
                         {bubbleColor === color && <Check size={18} className="text-white" />}
                       </button>
                    ))}
                  </div>
                </div>

                {/* Avatar Size */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">
                     <Users size={14} /> Tamanho da Foto
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { id: 'xs', label: 'PP' },
                      { id: 'sm', label: 'P' },
                      { id: 'md', label: 'M' },
                      { id: 'lg', label: 'G' },
                      { id: 'none', label: 'Off' }
                    ].map(size => (
                       <button
                         key={size.id}
                         onClick={() => updatePreferences({ avatarSize: size.id as any })}
                         className={cn(
                           "py-3 rounded-xl font-bold transition-all border-2",
                           avatarSize === size.id 
                             ? "bg-[var(--accent)] border-[var(--accent)] text-white shadow-lg" 
                             : "bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]"
                         )}
                       >
                         {size.label}
                       </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)]">
                   <p className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] mb-3 tracking-widest">Prévia</p>
                   <div className="flex items-end gap-2">
                      {avatarSize !== 'none' && (
                        <div className={cn("rounded-lg bg-[var(--border-default)] shrink-0", 
                          avatarSize === 'xs' && "w-4 h-4",
                          avatarSize === 'sm' && "w-6 h-6",
                          avatarSize === 'md' && "w-8 h-8",
                          avatarSize === 'lg' && "w-10 h-10",
                        )} />
                      )}
                      <div className={cn("px-4 py-2 rounded-2xl rounded-bl-none text-xs text-white font-medium", BUBBLE_COLOR_BG_CLASS[bubbleColor] || BUBBLE_COLOR_BG_CLASS.indigo)}>
                         Exemplo de mensagem
                      </div>
                   </div>
                </div>

                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full bg-slate-900 text-white rounded-2xl py-4 font-black transition-all hover:bg-slate-800 shadow-xl shadow-slate-100"
                >
                  Confirmar Alterações
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sticker Cropper Modal */}
      <AnimatePresence>
        {isCroppingSticker && tempStickerUrl && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCroppingSticker(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-[var(--surface-card)] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[600px]"
            >
               <div className="p-8 border-b border-[var(--border-default)] flex items-center justify-between shrink-0 bg-[var(--surface-card)] z-10">
                  <div className="flex items-center gap-3">
                     <div className="p-2 bg-[var(--accent)]/10 rounded-xl text-[var(--accent-text)]">
                        <Scissors size={20} />
                     </div>
                     <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight">Criar Sticker</h3>
                  </div>
                  <button onClick={() => setIsCroppingSticker(false)} className="p-2 hover:bg-[var(--surface-pill)] rounded-xl transition-all">
                    <X size={20} className="text-[var(--text-tertiary)]" />
                  </button>
               </div>

               <div className="relative flex-1 bg-slate-900">
                  <Cropper
                    image={tempStickerUrl}
                    crop={crop}
                    zoom={zoom}
                    aspect={1}
                    onCropChange={setCrop}
                    onCropComplete={(_, croppedPixels) => setCroppedAreaPixels(croppedPixels)}
                    onZoomChange={setZoom}
                  />
                  {isTempStickerGif || (tempStickerUrl && tempStickerUrl.startsWith('data:image/gif')) ? (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
                      <div className="bg-[var(--surface-warning)]/90 backdrop-blur-md px-4 py-2 rounded-xl border border-[var(--border-alert)] flex items-center gap-3 shadow-lg">
                        <span className="text-[10px] font-semibold text-[var(--text-warning)] uppercase tracking-widest">Aviso: Recortar removerá a animação</span>
                        <button 
                          onClick={() => {
                            const updatedStickers = [...(currentUser?.chatPreferences?.personalStickers || []), tempStickerUrl];
                            updatePreferences({ personalStickers: updatedStickers });
                            setIsCroppingSticker(false);
                            setTempStickerUrl(null);
                            setShowStickerPicker(true);
                          }}
                          className="px-3 py-1 bg-[var(--accent-warning-hover)] text-white rounded-lg text-[9px] font-semibold uppercase shadow-sm hover:bg-amber-700 transition-all"
                        >
                          Usar Original (Animado)
                        </button>
                      </div>
                    </div>
                  ) : null}
               </div>

               <div className="p-8 space-y-6 shrink-0 bg-[var(--surface-card)]">
                  <div className="space-y-2">
                     <div className="flex justify-between text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
                        <span>Zoom</span>
                        <span>{Math.round(zoom * 100)}%</span>
                     </div>
                     <input 
                       type="range"
                       min={1}
                       max={3}
                       step={0.1}
                       value={zoom}
                       onChange={(e) => setZoom(Number(e.target.value))}
                       className="w-full h-2 bg-[var(--surface-pill)] rounded-full appearance-none cursor-pointer accent-[var(--accent)]"
                     />
                  </div>

                  <div className="flex gap-4">
                     <button 
                       onClick={() => setIsCroppingSticker(false)}
                       className="flex-1 px-6 py-4 rounded-2xl font-black text-sm uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-card)] transition-all"
                     >
                       Cancelar
                     </button>
                     <button 
                       onClick={async () => {
                         if (tempStickerUrl && croppedAreaPixels) {
                            try {
                              const croppedImage = await getCroppedImg(tempStickerUrl, croppedAreaPixels);
                              const updatedStickers = [...(currentUser?.chatPreferences?.personalStickers || []), croppedImage];
                              updatePreferences({ personalStickers: updatedStickers });
                              setIsCroppingSticker(false);
                              setTempStickerUrl(null);
                              setShowStickerPicker(true);
                            } catch (e) {
                              console.error(e);
                            }
                         } else if (tempStickerUrl) {
                            const updatedStickers = [...(currentUser?.chatPreferences?.personalStickers || []), tempStickerUrl];
                            updatePreferences({ personalStickers: updatedStickers });
                            setIsCroppingSticker(false);
                            setTempStickerUrl(null);
                            setShowStickerPicker(true);
                         }
                       }}
                       className="flex-1 bg-[var(--accent)] text-white rounded-2xl py-4 font-black transition-all hover:bg-[var(--accent-hover)] shadow-xl shadow-indigo-100"
                     >
                       Salvar Sticker
                     </button>
                  </div>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sticker Context Menu */}
      <AnimatePresence>
        {stickerContextMenu && (
          <div 
            className="fixed inset-0 z-[110]" 
            onClick={() => setStickerContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setStickerContextMenu(null); }}
          >
            <motion.div 
               key="sticker-context-menu"
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.95 }}
               style={{ top: stickerContextMenu.y, left: stickerContextMenu.x }}
               className="absolute bg-[var(--surface-card)] rounded-2xl shadow-2xl border border-[var(--border-default)] py-2 w-48 overflow-hidden"
               onClick={e => e.stopPropagation()}
            >
               <button 
                 onClick={() => {
                   const updated = [...(currentUser?.chatPreferences?.personalStickers || [])];
                   updated.splice(stickerContextMenu.index, 1);
                   updatePreferences({ personalStickers: updated });
                   setStickerContextMenu(null);
                 }}
                 className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-danger)] text-[var(--text-danger)] transition-colors text-sm font-bold"
               >
                  <Trash2 size={16} className="text-[var(--text-danger)]" />
                  Excluir Sticker
               </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            key={`context-menu-${contextMenu.roomId || 'global'}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-[100] w-64 bg-[var(--surface-card)] rounded-2xl shadow-2xl border border-[var(--border-default)] overflow-hidden py-2"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
             {(() => {
               const room = rooms.find(r => r.id === contextMenu.roomId);
               if (!room) return null;
               const isPinned = room.pinnedBy?.includes(currentUser?.id || '');
               const isMuted = room.mutedBy?.includes(currentUser?.id || '');
               const isReadLater = room.readLaterBy?.includes(currentUser?.id || '');
               const otherUserId = room.memberIds?.find(id => id !== currentUser?.id);

               return (
                 <>
                   <button 
                     onClick={() => {
                       toggleReadLater(room.id);
                       closeContextMenu();
                     }}
                     className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-card)] text-[var(--text-secondary)] transition-colors text-sm font-bold"
                   >
                      <Clock size={16} className="text-[var(--text-tertiary)]" />
                      {isReadLater ? 'Remover "Ler Depois"' : 'Marcar para ler depois'}
                   </button>

                   <button 
                     onClick={() => {
                        togglePin({ stopPropagation: () => {} } as any, room.id);
                        closeContextMenu();
                     }}
                     className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-card)] text-[var(--text-secondary)] transition-colors text-sm font-bold"
                   >
                      {isPinned ? <PinOff size={16} className="text-[var(--text-tertiary)]" /> : <Pin size={16} className="text-[var(--text-tertiary)]" />}
                      {isPinned ? 'Desafixar' : 'Fixar'}
                   </button>

                   {room.type === 'direct' && (
                     <button 
                       onClick={() => {
                          setIsCreatingGroup(true);
                          setSelectedMembers([otherUserId!]);
                          closeContextMenu();
                       }}
                       className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-card)] text-[var(--text-secondary)] transition-colors text-sm font-bold"
                     >
                        <UserPlus size={16} className="text-[var(--text-tertiary)]" />
                        Convidar para Grupo
                     </button>
                   )}

                   <button 
                     onClick={() => {
                        toggleMute(room.id);
                        closeContextMenu();
                     }}
                     className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-card)] text-[var(--text-secondary)] transition-colors text-sm font-bold"
                   >
                      {isMuted ? <Bell size={16} className="text-[var(--text-tertiary)]" /> : <BellOff size={16} className="text-[var(--text-tertiary)]" />}
                      {isMuted ? 'Ativar notificações' : 'Silenciar'}
                   </button>

                   <div className="h-px bg-[var(--surface-pill)] my-1 mx-2" />

                   {room.type === 'direct' && (
                     <button
                       className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-card)] text-[var(--text-secondary)] transition-colors text-sm font-bold"
                     >
                        <UserCircle size={16} className="text-[var(--text-tertiary)]" />
                        Visualizar perfil
                     </button>
                   )}

                   {otherUserId && (
                     <button 
                       onClick={() => {
                          setFindChatsWithUserId(otherUserId);
                          closeContextMenu();
                       }}
                       className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-card)] text-[var(--text-secondary)] transition-colors text-sm font-bold"
                     >
                        <SearchIcon size={16} className="text-[var(--text-tertiary)]" />
                        Encontrar conversas
                     </button>
                   )}

                   <button 
                     onClick={() => {
                        toggleHideRoom(room.id);
                        closeContextMenu();
                     }}
                     className={cn(
                       "w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-danger)] text-[var(--text-danger)] transition-colors text-sm font-bold",
                       room.hiddenBy?.includes(currentUser?.id || '') && "text-[var(--accent-text)] hover:bg-[var(--accent)]/10"
                     )}
                   >
                      {room.hiddenBy?.includes(currentUser?.id || '') ? (
                        <>
                          <Eye size={16} className="text-[var(--accent-text)]" />
                          Exibir conversa
                        </>
                      ) : (
                        <>
                          <EyeOff size={16} className="text-[var(--text-danger)]" />
                          Ocultar
                        </>
                      )}
                   </button>
                 </>
               );
             })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lightbox de imagem enviada no chat */}
      <AnimatePresence>
        {previewImageUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewImageUrl(null)}
            className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 cursor-zoom-out"
          >
            <button
              onClick={() => setPreviewImageUrl(null)}
              className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
            >
              <X size={20} />
            </button>
            <motion.img
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              src={previewImageUrl}
              alt="Imagem"
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain cursor-default"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* "Criar chamado interno" a partir de uma mensagem (menu ⋯ na barra
          flutuante de cada balão) — o de Chamado comum reaproveita o
          NewTicketModal global via AppContext, mas ticket interno não tem
          equivalente global, então o rascunho fica em estado local aqui. */}
      <NewInternalTicketModal
        isOpen={!!internalTicketDraft}
        onClose={() => setInternalTicketDraft(null)}
        initialTitle={internalTicketDraft?.title}
        initialDescription={internalTicketDraft?.description}
      />

      {currentUser && (
        <PhoneContactPanel
          phone={phoneContactPanelPhone}
          onClose={() => setPhoneContactPanelPhone(null)}
          onOpenChat={(sessionId) => {
            setActiveOmniChatId(sessionId);
            setIsOmniChatOpen(true);
          }}
          currentUserId={currentUser.id}
        />
      )}
    </div>
  );
}
