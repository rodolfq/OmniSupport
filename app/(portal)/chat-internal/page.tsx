'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, 
  Plus, 
  Send, 
  Paperclip, 
  Smile, 
  Image as ImageIcon, 
  MoreVertical, 
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
  Loader2
} from 'lucide-react';
import { cn, normalizeString } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { InternalGroup, ChatMessage, User, UserRole, Permission } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { ClientTime } from '@/components/client-time';
import { InternalChatService } from '@/lib/services/chat-service';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import EmojiPicker, { Theme as EmojiTheme } from 'emoji-picker-react';
import Cropper, { Area } from 'react-easy-crop';
import { Scissors } from 'lucide-react';
import { fileToBase64 } from '@/lib/image-utils';
import { toast } from 'sonner';

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
   const { currentUser, setCurrentUser, authInitialized } = useApp();
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
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [isChatReady, setIsChatReady] = useState(false);

  const stickerInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupImageRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authInitialized || !currentUser) return;
    const canViewInternalChat = currentUser.role === UserRole.ADMIN ||
      currentUser.permissions?.includes(Permission.CHAT_INTERNAL_VIEW) === true;
    if (!canViewInternalChat) {
      router.replace('/internal-tickets');
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

  // Load messages when room is selected
  useEffect(() => {
    if (selectedRoomId) {
      InternalChatService.getMessages(selectedRoomId)
        .then(messages => {
          setRooms(prev => prev.map(r => r.id === selectedRoomId ? { ...r, messages } : r));
        })
        .catch(err => console.error('Error loading messages:', err));
    }
  }, [selectedRoomId]);

  const scrollToBottom = (instant = false) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: instant ? 'auto' : 'smooth',
        block: 'end'
      });
    }
  };

  useEffect(() => {
    if (selectedRoomId && currentUser) {
      const room = rooms.find(r => r.id === selectedRoomId);
      if (room) {
        let modified = false;
        const updatedMessages = room.messages.map(msg => {
          if (msg.senderId !== currentUser.id && (!msg.readBy || !msg.readBy.includes(currentUser.id))) {
            modified = true;
            return { ...msg, readBy: [...(msg.readBy || []), currentUser.id] };
          }
          return msg;
        });

        if (modified) {
          const updatedRoom = { ...room, messages: updatedMessages };
          setRooms(prev => prev.map(currentRoom => currentRoom.id === selectedRoomId ? updatedRoom : currentRoom));
        }
      }
    }
  }, [selectedRoomId, currentUser, rooms]);

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
        .then(() => {
          loadRooms();
          setSelectedRoomId(newRoom.id);
        });
    }
    setSearchTerm('');
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

    handleSendMessage('file', undefined, metadata);
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

  const createRoom = () => {
    if (!newGroupName.trim() || selectedMembers.length === 0 || !currentUser) return;

    const newRoom: InternalGroup = {
      id: `g-${generateId()}`,
      name: newGroupName,
      imageUrl: newGroupImage || undefined,
      type: selectedMembers.length === 1 ? 'direct' : 'group',
      memberIds: [currentUser.id, ...selectedMembers],
      messages: [
        {
          id: `sys-${generateId()}`,
          senderId: 'system',
          senderName: 'Sistema',
          text: `${currentUser.name} criou o grupo "${newGroupName}"`,
          timestamp: new Date().toISOString(),
          type: 'system' as const
        }
      ],
      lastMessageAt: new Date().toISOString()
    };

    InternalChatService.saveChat(newRoom)
      .then(() => {
        loadRooms();
        setSelectedRoomId(newRoom.id);
      })
      .catch(err => {
        console.error('Error creating room:', err);
        toast.error('Erro ao criar grupo');
      });
    setIsCreatingGroup(false);
    setNewGroupName('');
    setNewGroupImage('');
    setSelectedMembers([]);
    toast.success(`Grupo "${newRoom.name}" criado com sucesso!`);
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
      room.memberIds.every(memberId => memberId === currentUser.id);
    if (isSelfChat) return currentUser || undefined;

    const participantId = room.memberIds.find(id => id !== currentUser?.id) || room.memberIds[0];
    return allUsers.find(user => user.id === participantId) ||
      (participantId === currentUser?.id ? currentUser : undefined);
  };

  const filteredUsers = allUsers.filter(u => 
    normalizeString(u.name).includes(normalizeString(searchTerm)) &&
    !rooms.some(room => isDirectChatWith(room, u.id))
  );

  if (!isChatReady) {
    return (
      <div className="h-[calc(100vh-120px)] flex items-center justify-center bg-white dark:bg-[var(--surface-card)] rounded-3xl border border-slate-200 dark:border-[var(--border-default)] shadow-2xl">
        <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-[var(--text-tertiary)]">
          <Loader2 size={28} className="animate-spin text-indigo-600 dark:text-[var(--accent-text)]" />
          <span className="text-sm font-bold">Carregando conversas...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex bg-white dark:bg-[var(--surface-card)] rounded-3xl border border-slate-200 dark:border-[var(--border-default)] overflow-hidden shadow-2xl">
      {/* Sidebar */}
      <div className="w-[350px] border-r border-slate-100 dark:border-[var(--border-default)] flex flex-col bg-slate-50/30 dark:bg-[var(--surface-card)]/30">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black text-slate-800 dark:text-[var(--text-primary)] tracking-tight">Chat Interno</h1>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowHidden(!showHidden)}
                className={cn(
                  "p-2.5 rounded-xl transition-all border shrink-0",
                  showHidden 
                    ? "bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-200" 
                    : "bg-white dark:bg-[var(--surface-card)] border-slate-200 dark:border-[var(--border-default)] text-slate-400 dark:text-[var(--text-tertiary)] hover:text-slate-600 dark:hover:text-[var(--text-secondary)] hover:border-slate-300 dark:hover:border-[var(--border-default)]"
                )}
                title={showHidden ? "Ocultar chats arquivados" : "Mostrar chats arquivados"}
              >
                {showHidden ? <Eye size={20} /> : <EyeOff size={20} />}
              </button>
              <button 
                onClick={() => setIsCreatingGroup(true)}
                className="p-2.5 bg-indigo-600 dark:bg-[var(--accent)] text-white rounded-xl hover:bg-indigo-700 dark:hover:bg-[var(--accent-hover)] transition-all shadow-lg shadow-indigo-100 shrink-0"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[var(--text-tertiary)]" size={18} />
            <input 
              type="text"
              placeholder="Buscar pessoas ou grupos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-2xl pl-12 pr-4 py-3 text-sm font-medium outline-none focus:border-indigo-500 dark:focus:border-[var(--accent)] focus:ring-4 focus:ring-indigo-500/5 dark:focus:ring-[var(--accent)]/5 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-6">
          {findChatsWithUserId && (
            <div className="mb-2 p-3 bg-indigo-50 dark:bg-[var(--accent)]/10 border border-indigo-100 dark:border-[var(--accent)]/20 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                 <SearchIcon size={14} className="text-indigo-600 dark:text-[var(--accent-text)]" />
                 <span className="text-[10px] font-black text-indigo-600 dark:text-[var(--accent-text)] uppercase tracking-widest">
                   Filtrando por usuário
                 </span>
              </div>
              <button 
                onClick={() => setFindChatsWithUserId(null)}
                className="p-1 hover:bg-indigo-200/50 rounded-lg text-indigo-600 dark:text-[var(--accent-text)] transition-colors"
              >
                 <X size={14} />
              </button>
            </div>
          )}

          {/* Active Conversations */}
          {filteredRooms.length > 0 && (
            <div className="space-y-2">
              <p className="px-4 text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest">Conversas</p>
              {filteredRooms.map((room, roomIdx) => {
                const lastMessage = room.messages[room.messages.length - 1];
                const isActive = selectedRoomId === room.id;
                
                // For direct chats, find the other user's info
                const otherUser = getDirectChatUser(room);
                const avatar = room.type === 'group' ? room.imageUrl : (otherUser?.avatarUrl || null);
                const isPinned = room.pinnedBy?.includes(currentUser?.id || '');

                return (
                  <div 
                    key={`room-${room.id}-${roomIdx}`}
                    onClick={() => setSelectedRoomId(room.id)}
                    onContextMenu={(e) => handleContextMenu(e, room.id)}
                    className={cn(
                      "w-full flex items-center gap-4 p-4 rounded-3xl transition-all text-left group relative cursor-pointer",
                      isActive ? "bg-white dark:bg-[var(--surface-card)] shadow-xl shadow-slate-100/50 border border-slate-100 dark:border-[var(--border-default)]" : "hover:bg-white/50 dark:hover:bg-[var(--surface-card)]",
                      room.readLaterBy?.includes(currentUser?.id || '') && "border-2 border-indigo-200 dark:border-[var(--accent)]/30"
                    )}
                  >
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black overflow-hidden bg-slate-200 dark:bg-[var(--border-default)]",
                      !avatar && (room.type === 'group' ? "bg-indigo-500 dark:bg-[var(--accent)]" : "bg-emerald-500 dark:bg-[var(--text-success)]")
                    )}>
                      {avatar ? (
                        <img src={avatar} alt={room.name} className="w-full h-full object-cover" />
                      ) : (
                        room.type === 'group' ? <Users size={20} /> : room.name.charAt(0)
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-0.5 gap-2">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                           <span className="text-sm font-black text-slate-800 dark:text-[var(--text-primary)] truncate">{room.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {room.mutedBy?.includes(currentUser?.id || '') && <BellOff size={10} className="text-slate-300" />}
                          {isPinned && <Pin size={12} className="text-indigo-500 dark:text-[var(--accent-text)] fill-indigo-500 rotate-45 shrink-0" />}
                          <span className="text-[10px] font-bold text-slate-400 dark:text-[var(--text-tertiary)]">
                            {room.lastMessageAt ? new Date(room.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-[var(--text-tertiary)] truncate font-medium">
                        {lastMessage ? (
                          lastMessage.isDeleted ? (lastMessage.text || 'Mensagem apagada') :
                          lastMessage.type === 'text' ? lastMessage.text : 
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
              <p className="px-4 text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest">Contatos</p>
              {filteredUsers.map((user, uIdx) => (
                <button 
                  key={`contact-${user.id}-${uIdx}`}
                  onClick={() => startDirectChat(user)}
                  className="w-full flex items-center gap-4 p-4 rounded-3xl transition-all text-left hover:bg-white/50 dark:hover:bg-[var(--surface-card)] group"
                >
                  <div className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black overflow-hidden bg-slate-200 dark:bg-[var(--border-default)]",
                    !user.avatarUrl && "bg-emerald-500 dark:bg-[var(--text-success)]"
                  )}>
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                    ) : (
                      user.name.charAt(0)
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-black text-slate-800 dark:text-[var(--text-primary)] truncate block">{user.name}</span>
                    <p className="text-[10px] font-bold text-slate-400 dark:text-[var(--text-tertiary)] uppercase tracking-tighter">{user.role}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Window */}
      <div className="flex-1 flex flex-col bg-white dark:bg-[var(--surface-card)]">
        {selectedRoom ? (
          <>
            {/* Header */}
            <div className="px-8 py-5 border-b border-slate-100 dark:border-[var(--border-default)] flex items-center justify-between bg-white/80 dark:bg-[var(--surface-card)] backdrop-blur-xl sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black shadow-lg overflow-hidden bg-slate-200 dark:bg-[var(--border-default)]",
                  selectedRoom.type === 'group' ? "bg-indigo-500 dark:bg-[var(--accent)] shadow-indigo-100" : "bg-emerald-500 dark:bg-[var(--text-success)] shadow-emerald-100"
                )}>
                  {selectedRoom.type === 'group' ? (
                    selectedRoom.imageUrl ? <img src={selectedRoom.imageUrl} className="w-full h-full object-cover" /> : <Users size={20} />
                  ) : (
                    getDirectChatUser(selectedRoom)?.avatarUrl ? (
                      <img src={getDirectChatUser(selectedRoom)?.avatarUrl} alt={getDirectChatUser(selectedRoom)?.name || selectedRoom.name} className="w-full h-full object-cover" />
                    ) : selectedRoom.name.charAt(0)
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-800 dark:text-[var(--text-primary)] tracking-tight">{selectedRoom.name}</h2>
                  <p className="text-xs font-bold text-slate-400 dark:text-[var(--text-tertiary)] uppercase tracking-widest">
                    {selectedRoom.type === 'group' ? `${selectedRoom.memberIds?.length || 0} membros` : 'Online'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {selectedRoom.type === 'group' && (
                  <button 
                    onClick={() => setShowGroupSettings(true)}
                    className="p-3 text-slate-400 dark:text-[var(--text-tertiary)] hover:text-indigo-600 dark:hover:text-[var(--accent-text)] hover:bg-indigo-50 dark:hover:bg-[var(--accent)]/10 rounded-2xl transition-all"
                    title="Configurações do Grupo"
                  >
                      <Users size={20} />
                  </button>
                )}
                <button 
                  onClick={() => setShowSettings(true)}
                  className="p-3 text-slate-400 dark:text-[var(--text-tertiary)] hover:text-indigo-600 dark:hover:text-[var(--accent-text)] hover:bg-indigo-50 dark:hover:bg-[var(--accent)]/10 rounded-2xl transition-all"
                  title="Minhas Preferências"
                >
                    <Settings size={20} />
                </button>
                <button 
                  onClick={() => toggleMute(selectedRoom.id)}
                  className={cn(
                    "p-3 rounded-2xl transition-all",
                    selectedRoom.mutedBy?.includes(currentUser?.id || '') 
                      ? "text-rose-500 dark:text-[var(--text-danger)] bg-rose-50 dark:bg-[var(--surface-danger)] hover:bg-rose-100 dark:hover:bg-[var(--surface-danger)]" 
                      : "text-slate-400 dark:text-[var(--text-tertiary)] hover:text-indigo-600 dark:hover:text-[var(--accent-text)] hover:bg-indigo-50 dark:hover:bg-[var(--accent)]/10"
                  )}
                  title={selectedRoom.mutedBy?.includes(currentUser?.id || '') ? "Desativar Mudo" : "Silenciar"}
                >
                    {selectedRoom.mutedBy?.includes(currentUser?.id || '') ? <BellOff size={20} /> : <Bell size={20} />}
                </button>
                <div className="relative group/menu">
                  <button className="p-3 text-slate-400 dark:text-[var(--text-tertiary)] hover:text-indigo-600 dark:hover:text-[var(--accent-text)] hover:bg-indigo-50 dark:hover:bg-[var(--accent)]/10 rounded-2xl transition-all">
                    <MoreVertical size={20} />
                  </button>
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-[var(--surface-card)] border border-slate-100 dark:border-[var(--border-default)] rounded-2xl shadow-xl opacity-0 group-hover/menu:opacity-100 pointer-events-none group-hover/menu:pointer-events-auto transition-all z-50 before:absolute before:-top-4 before:-left-4 before:h-4 before:w-[calc(100%+2rem)] before:content-['']">
                    <button 
                      onClick={() => setShowPinnedOnly(!showPinnedOnly)}
                      className="w-full rounded-2xl px-4 py-3 text-left text-xs font-bold text-slate-600 dark:text-[var(--text-secondary)] hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] flex items-center gap-2"
                    >
                      <Pin size={14} className="text-indigo-500 dark:text-[var(--accent-text)]" />
                      {showPinnedOnly ? 'Ver todas as msgs' : 'Mensagens fixadas'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Pinned Messages Bar */}
            {selectedRoom.pinnedMessageIds && selectedRoom.pinnedMessageIds.length > 0 && !showPinnedOnly && (
               <div className="bg-indigo-50/50 dark:bg-[var(--accent)]/10 border-b border-indigo-100 dark:border-[var(--accent)]/20 px-8 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 overflow-hidden flex-1">
                     <Pin size={12} className="text-indigo-500 dark:text-[var(--accent-text)] shrink-0" />
                     <p className="text-[10px] font-bold text-indigo-700 dark:text-[var(--accent-text)] truncate">
                        {selectedRoom.pinnedMessageIds.length} mensagem(ns) fixada(s)
                     </p>
                  </div>
                  <button 
                    onClick={() => setShowPinnedOnly(true)}
                    className="text-[10px] font-black uppercase text-indigo-600 dark:text-[var(--accent-text)] hover:underline shrink-0"
                  >
                    Ver Tudo
                  </button>
               </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-slate-50/50 dark:bg-[var(--surface-card)]/50">
              {(showPinnedOnly ? selectedRoom.messages.filter(m => selectedRoom.pinnedMessageIds?.includes(m.id)) : selectedRoom.messages).map((msg, idx) => {
                const isMine = msg.senderId === currentUser?.id;
                const prevMsg = selectedRoom.messages[idx - 1];
                const showSender = !isMine && (!prevMsg || prevMsg.senderId !== msg.senderId);
                const isPinned = selectedRoom.pinnedMessageIds?.includes(msg.id);
                const repliedMessage = msg.replyToId ? selectedRoom.messages.find(m => m.id === msg.replyToId) : null;

                // Hidden deleted message (deleted before being read)
                if (msg.isDeleted && !msg.text) return null;

                const bubbleColorClass = isMine 
                  ? `bg-${bubbleColor}-600` 
                  : "bg-white dark:bg-[var(--surface-card)] border border-slate-100 dark:border-[var(--border-default)] text-slate-700 dark:text-[var(--text-secondary)]";
                
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
                      <span className="px-4 py-1.5 bg-slate-100 dark:bg-[var(--surface-pill)] text-slate-500 dark:text-[var(--text-tertiary)] text-[10px] font-black uppercase tracking-widest rounded-full">
                        {msg.text}
                      </span>
                    </div>
                  );
                }

                return (
                  <div 
                    key={`chat-msg-${msg.id}-${idx}`} 
                    className={cn(
                      "flex gap-3 max-w-[85%] group animate-in fade-in slide-in-from-bottom-2 duration-300",
                      isMine ? "ml-auto flex-row-reverse" : "mr-auto flex-row"
                    )}
                  >
                    {!isMine && avatarSize !== 'none' && (
                      <div className={cn("rounded-2xl bg-slate-200 dark:bg-[var(--border-default)] shrink-0 overflow-hidden mt-6 shadow-sm", avatarSizeClass)}>
                         {allUsers.find(u => u.id === msg.senderId)?.avatarUrl ? (
                           <img src={allUsers.find(u => u.id === msg.senderId)?.avatarUrl} className="w-full h-full object-cover" />
                         ) : (
                           <div className="w-full h-full flex items-center justify-center text-[10px] font-black text-slate-500 dark:text-[var(--text-tertiary)]">
                             {msg.senderName.charAt(0)}
                           </div>
                         )}
                      </div>
                    )}

                    <div className={cn("flex flex-col", isMine ? "items-end" : "items-start")}>
                      {showSender && (
                        <span className="text-[10px] font-black text-slate-400 dark:text-[var(--text-tertiary)] uppercase tracking-widest mb-1.5 ml-1">
                          {msg.senderName}
                        </span>
                      )}
                      <div className={cn(
                        "relative p-4 rounded-3xl shadow-sm text-sm font-medium",
                        isMine ? "text-white rounded-br-none" : "rounded-bl-none",
                        bubbleColorClass,
                        msg.isDeleted && "italic opacity-80",
                        isPinned && "ring-2 ring-indigo-500/20 dark:ring-[var(--accent)]/20"
                      )}>
                        {isPinned && !showPinnedOnly && (
                           <div className="absolute -top-2 -right-2 w-5 h-5 bg-indigo-600 dark:bg-[var(--accent)] rounded-full flex items-center justify-center text-white shadow-lg border border-white">
                              <Pin size={10} className="fill-white" />
                           </div>
                        )}
                        {repliedMessage && !msg.isDeleted && (
                           <div className={cn(
                             "mb-2 p-2 rounded-xl border-l-4 bg-black/5 flex flex-col gap-1",
                             isMine ? "border-white/40" : "border-indigo-500/40 dark:border-[var(--accent)]/40"
                           )}>
                             <span className="text-[10px] font-black uppercase opacity-60">
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
                              <p className="leading-relaxed">{msg.text}</p>
                            )}
                            
                            {msg.type === 'file' && (
                              <div className={cn(
                                "flex items-center gap-4 rounded-2xl p-2",
                                isMine ? "bg-white/10" : "bg-slate-50 dark:bg-[var(--surface-card)]"
                              )}>
                                <div className={cn(
                                  "w-10 h-10 rounded-xl flex items-center justify-center",
                                  isMine ? "bg-white/20" : "bg-white dark:bg-[var(--surface-card)] border border-slate-100 dark:border-[var(--border-default)]"
                                )}>
                                  <FileText size={20} />
                                </div>
                                <div className="flex-1 min-w-0 pr-4">
                                  <p className="text-xs font-black truncate">{msg.metadata?.fileName || 'Arquivo'}</p>
                                  <p className="text-[10px] font-bold opacity-60">{(msg.metadata?.fileSize || 0) / 1000} KB</p>
                                </div>
                                <button className={cn(
                                  "p-2 rounded-lg transition-all",
                                  isMine ? "hover:bg-white/20" : "hover:bg-white dark:hover:bg-[var(--surface-card)]"
                                )}>
                                  <Download size={16} />
                                </button>
                              </div>
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

                        <div className={cn(
                          "absolute -bottom-5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap",
                          isMine ? "right-1" : "left-1"
                        )}>
                          {isMine && !msg.isDeleted && (
                            <button 
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="text-[9px] font-black uppercase text-red-400 dark:text-[var(--text-danger)] hover:text-red-600 dark:hover:text-[var(--text-danger)] mr-2"
                            >
                              Excluir
                            </button>
                          )}
                          {!msg.isDeleted && (
                             <>
                                <button 
                                  onClick={() => setReplyingToId(msg.id)}
                                  className="text-[9px] font-black uppercase text-indigo-400 dark:text-[var(--accent-text)] hover:text-indigo-600 dark:hover:text-[var(--accent-text)] mr-2"
                                >
                                  Responder
                                </button>
                                <button 
                                  onClick={() => togglePinMessage(msg.id)}
                                  className={cn(
                                    "text-[9px] font-black uppercase mr-2",
                                    isPinned ? "text-indigo-600 dark:text-[var(--accent-text)]" : "text-slate-400 dark:text-[var(--text-tertiary)] hover:text-slate-600 dark:hover:text-[var(--text-secondary)]"
                                  )}
                                >
                                  {isPinned ? 'Desafixar' : 'Fixar'}
                                </button>
                             </>
                          )}
                          <span className="text-[9px] font-bold text-slate-400 dark:text-[var(--text-tertiary)]">
                            <ClientTime date={msg.timestamp} />
                          </span>
                          {isMine && (
                            msg.readBy && msg.readBy.length > (selectedRoom.type === 'group' ? 1 : 1) ? (
                              <CheckCheck size={12} className={cn("text-indigo-400 dark:text-[var(--accent-text)]", (selectedRoom.type === 'direct' ? msg.readBy?.some(id => id !== currentUser?.id) : (msg.readBy?.length || 0) >= (selectedRoom.memberIds?.length || 0)) && "text-blue-500 dark:text-[var(--text-info)]")} />
                            ) : (
                              <Check size={12} className="text-slate-300" />
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-6 bg-white dark:bg-[var(--surface-card)] border-t border-slate-100 dark:border-[var(--border-default)]">
              <div className="max-w-4xl mx-auto relative">
                {replyingToId && (
                   <div className="mb-4 bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-2xl p-4 flex items-center justify-between animate-in slide-in-from-bottom-2">
                      <div className="flex-1 min-w-0 border-l-4 border-indigo-600 dark:border-[var(--accent)] pl-4">
                         <p className="text-[10px] font-black uppercase text-indigo-600 dark:text-[var(--accent-text)] truncate">
                            Respondendo para {selectedRoom.messages.find(m => m.id === replyingToId)?.senderId === currentUser?.id ? 'você' : selectedRoom.messages.find(m => m.id === replyingToId)?.senderName}
                         </p>
                         <p className="text-xs text-slate-500 dark:text-[var(--text-tertiary)] truncate mt-0.5">
                            {selectedRoom.messages.find(m => m.id === replyingToId)?.text || 'Mídia'}
                         </p>
                      </div>
                      <button 
                        onClick={() => setReplyingToId(null)}
                        className="p-2 hover:bg-slate-200 dark:hover:bg-[var(--border-default)] rounded-xl transition-all text-slate-400 dark:text-[var(--text-tertiary)]"
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
                      className="absolute bottom-full mb-4 left-0 bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-3xl p-6 shadow-2xl z-20 w-[300px]"
                    >
                        <div className="flex items-center justify-between mb-4">
                           <p className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest">Stickers</p>
                           <button 
                             onClick={() => stickerInputRef.current?.click()}
                             className="flex items-center gap-1 text-[10px] font-black uppercase text-indigo-600 dark:text-[var(--accent-text)] hover:text-indigo-800 transition-colors"
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
                              <p className="text-[8px] font-black text-slate-300 uppercase mb-3 tracking-widest">Seus Stickers</p>
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
                                     className="aspect-square rounded-xl overflow-hidden hover:scale-110 transition-all border border-slate-100 dark:border-[var(--border-default)] relative group"
                                   >
                                     <img src={url} alt="Custom" className="w-full h-full object-contain" />
                                     <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                        <p className="text-[8px] text-white font-black uppercase">Excluir (R-Click)</p>
                                     </div>
                                   </button>
                                 ))}
                              </div>
                           </div>
                         )}

                           <p className="text-[8px] font-black text-slate-300 uppercase mb-3 tracking-widest">Padrão</p>
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
                      className="absolute bottom-full mb-4 left-0 bg-white dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-3xl p-6 shadow-2xl z-20 min-w-[320px]"
                    >
                       <div className="flex items-center gap-2 mb-4 bg-slate-100 dark:bg-[var(--surface-pill)] rounded-xl p-2 pr-4">
                          <SearchIcon size={16} className="text-slate-400 dark:text-[var(--text-tertiary)] ml-2" />
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
                              className="rounded-lg overflow-hidden h-24 hover:opacity-80 transition-all bg-slate-100 dark:bg-[var(--surface-pill)]"
                            >
                              <img src={`https://i.giphy.com/media/${id}/giphy.gif`} alt="GIF" className="w-full h-full object-cover" />
                            </button>
                          ))}
                       </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex items-center gap-4 bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-100 dark:border-[var(--border-default)] rounded-[2rem] p-3 pl-6 pr-3 shadow-inner">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        setShowEmojiPicker(!showEmojiPicker);
                        setShowStickerPicker(false);
                        setShowGifSearch(false);
                      }}
                      className={cn("p-2 rounded-full transition-all", showEmojiPicker ? "bg-indigo-100 dark:bg-[var(--accent)]/20 text-indigo-600 dark:text-[var(--accent-text)]" : "text-slate-400 dark:text-[var(--text-tertiary)] hover:text-indigo-600 dark:hover:text-[var(--accent-text)]")}
                    >
                      <Smile size={24} />
                    </button>
                    <button 
                      onClick={() => {
                        setShowStickerPicker(!showStickerPicker);
                        setShowEmojiPicker(false);
                        setShowGifSearch(false);
                      }}
                      className={cn("p-2 rounded-full transition-all", showStickerPicker ? "bg-indigo-100 dark:bg-[var(--accent)]/20 text-indigo-600 dark:text-[var(--accent-text)]" : "text-slate-400 dark:text-[var(--text-tertiary)] hover:text-indigo-600 dark:hover:text-[var(--accent-text)]")}
                    >
                      <ImageIcon size={24} />
                    </button>
                    <button 
                      onClick={() => {
                        setShowGifSearch(!showGifSearch);
                        setShowEmojiPicker(false);
                        setShowStickerPicker(false);
                      }}
                      className={cn("px-2 py-1 rounded-lg transition-all font-black text-xs", showGifSearch ? "bg-indigo-100 dark:bg-[var(--accent)]/20 text-indigo-600 dark:text-[var(--accent-text)]" : "text-slate-400 dark:text-[var(--text-tertiary)] hover:text-indigo-600 dark:hover:text-[var(--accent-text)]")}
                    >
                      GIF
                    </button>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 text-slate-400 dark:text-[var(--text-tertiary)] hover:text-indigo-600 dark:hover:text-[var(--accent-text)] transition-all"
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
                   
                   <input 
                     type="text"
                     value={message}
                     onChange={(e) => setMessage(e.target.value)}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' && !e.shiftKey) {
                         e.preventDefault();
                         handleSendMessage();
                       }
                     }}
                     placeholder="Escreva sua mensagem..."
                     className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-slate-700 dark:text-[var(--text-secondary)] mx-4"
                   />

                   <button 
                     onClick={() => handleSendMessage()}
                     disabled={!message.trim()}
                     className="w-12 h-12 bg-indigo-600 dark:bg-[var(--accent)] text-white rounded-full flex items-center justify-center hover:bg-indigo-700 dark:hover:bg-[var(--accent-hover)] transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
                   >
                     <Send size={20} />
                   </button>
                 </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-slate-50/30 dark:bg-[var(--surface-card)]/30">
            <div className="w-24 h-24 bg-white dark:bg-[var(--surface-card)] rounded-[2rem] flex items-center justify-center shadow-2xl shadow-indigo-100 mb-8 border border-slate-100 dark:border-[var(--border-default)]">
               <MessageCircle className="text-indigo-500 dark:text-[var(--accent-text)]" size={48} />
            </div>
            <h3 className="text-2xl font-black text-slate-800 dark:text-[var(--text-primary)] tracking-tight mb-3">Bem-vindo ao Chat Interno</h3>
            <p className="text-slate-500 dark:text-[var(--text-tertiary)] font-medium max-w-sm leading-relaxed">
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
               className="relative w-full max-w-md bg-white dark:bg-[var(--surface-card)] rounded-[2.5rem] shadow-2xl overflow-hidden"
             >
                <div className="p-8 border-b border-slate-100 dark:border-[var(--border-default)] flex items-center justify-between">
                   <h3 className="text-xl font-black text-slate-800 dark:text-[var(--text-primary)] tracking-tight">Novo Grupo</h3>
                   <button onClick={() => setIsCreatingGroup(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-[var(--surface-pill)] rounded-xl transition-all">
                      <X size={20} className="text-slate-400 dark:text-[var(--text-tertiary)]" />
                   </button>
                </div>

                <div className="p-8 space-y-6">
                   <div className="flex justify-center">
                      <div 
                        onClick={() => groupImageRef.current?.click()}
                        className="w-24 h-24 rounded-[2rem] bg-slate-50 dark:bg-[var(--surface-card)] border-2 border-dashed border-slate-200 dark:border-[var(--border-default)] flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 dark:hover:border-[var(--accent)] hover:bg-slate-100 dark:hover:bg-[var(--surface-pill)] transition-all overflow-hidden relative group"
                      >
                         {newGroupImage ? (
                           <img src={newGroupImage} className="w-full h-full object-cover" />
                         ) : (
                           <>
                             <ImageIcon size={24} className="text-slate-400 dark:text-[var(--text-tertiary)] mb-1" />
                             <span className="text-[10px] font-black text-slate-400 dark:text-[var(--text-tertiary)] uppercase">Logo</span>
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

                   <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest">Nome do Grupo</label>
                      <input 
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Ex: Time de Suporte, Infraestrutura..."
                        className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-200 dark:border-[var(--border-default)] rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:border-indigo-500 dark:focus:border-[var(--accent)] focus:ring-4 focus:ring-indigo-500/5 dark:focus:ring-[var(--accent)]/5 transition-all"
                      />
                   </div>

                   <div className="space-y-3">
                      <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest">Membros (Mais de 1 vira grupo)</label>
                      <div className="max-h-[300px] overflow-y-auto space-y-1 pr-2">
                         {allUsers.map((user, uIdx) => (
                           <button 
                             key={`create-group-user-${user.id}-${uIdx}`}
                             onClick={() => toggleMemberSelection(user.id)}
                             className={cn(
                               "w-full flex items-center gap-4 p-3 rounded-2xl transition-all",
                               selectedMembers.includes(user.id) ? "bg-indigo-50 dark:bg-[var(--accent)]/10" : "hover:bg-slate-50 dark:hover:bg-[var(--surface-card)]"
                             )}
                           >
                              <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center text-white font-black",
                                selectedMembers.includes(user.id) ? "bg-indigo-500 dark:bg-[var(--accent)]" : "bg-slate-400 dark:bg-[var(--text-tertiary)]"
                              )}>
                                {user.name.charAt(0)}
                              </div>
                              <div className="flex-1 text-left">
                                 <p className="text-sm font-black text-slate-800 dark:text-[var(--text-primary)]">{user.name}</p>
                                 <p className="text-[10px] font-bold text-slate-400 dark:text-[var(--text-tertiary)] uppercase tracking-tighter">{user.role}</p>
                              </div>
                              {selectedMembers.includes(user.id) && (
                                <div className="w-6 h-6 bg-indigo-500 dark:bg-[var(--accent)] rounded-full flex items-center justify-center text-white">
                                   <Check size={14} />
                                </div>
                              )}
                           </button>
                         ))}
                      </div>
                   </div>

                   <button 
                     onClick={createRoom}
                     disabled={!newGroupName.trim() || selectedMembers.length === 0}
                     className="w-full bg-indigo-600 dark:bg-[var(--accent)] text-white rounded-2xl py-4 font-black transition-all hover:bg-indigo-700 dark:hover:bg-[var(--accent-hover)] shadow-xl shadow-indigo-100 disabled:opacity-50"
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
              className="relative w-full max-w-lg bg-white dark:bg-[var(--surface-card)] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-slate-100 dark:border-[var(--border-default)] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                   <div className="p-2 bg-indigo-50 dark:bg-[var(--accent)]/10 rounded-xl text-indigo-600 dark:text-[var(--accent-text)]">
                      <Users size={20} />
                   </div>
                   <h3 className="text-xl font-black text-slate-800 dark:text-[var(--text-primary)] tracking-tight">Configurações do Grupo</h3>
                </div>
                <button onClick={() => setShowGroupSettings(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-[var(--surface-pill)] rounded-xl transition-all">
                  <X size={20} className="text-slate-400 dark:text-[var(--text-tertiary)]" />
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
                     className="w-24 h-24 rounded-[2rem] bg-slate-100 dark:bg-[var(--surface-pill)] border-2 border-slate-200 dark:border-[var(--border-default)] flex items-center justify-center cursor-pointer hover:border-indigo-500 dark:hover:border-[var(--accent)] transition-all overflow-hidden shrink-0 group relative"
                   >
                      {selectedRoom.imageUrl ? (
                        <img src={selectedRoom.imageUrl} className="w-full h-full object-cover" />
                      ) : (
                        <Users size={32} className="text-slate-400 dark:text-[var(--text-tertiary)]" />
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Plus size={24} className="text-white" />
                      </div>
                   </div>
                   <div className="flex-1 space-y-2">
                       <label className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest">Nome do Grupo</label>
                       <input 
                         type="text"
                         value={selectedRoom.name}
                         onChange={(e) => handleUpdateGroup({ name: e.target.value })}
                         className="w-full bg-slate-50 dark:bg-[var(--surface-card)] border border-slate-100 dark:border-[var(--border-default)] rounded-2xl px-5 py-3 text-sm font-bold outline-none focus:border-indigo-500 dark:focus:border-[var(--accent)] transition-all"
                       />
                   </div>
                </div>

                {/* Member List */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest">
                       <Users size={14} /> Membros ({selectedRoom.memberIds?.length || 0})
                    </div>
                    <button 
                      onClick={() => setIsAddingMember(!isAddingMember)}
                      className="flex items-center gap-2 text-[10px] font-black uppercase text-indigo-600 dark:text-[var(--accent-text)] hover:text-indigo-800 tracking-widest"
                    >
                      <UserPlus size={14} /> Adicionar
                    </button>
                  </div>

                  {isAddingMember && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-slate-50 dark:bg-[var(--surface-card)] rounded-3xl border border-slate-200 dark:border-[var(--border-default)] animate-in fade-in slide-in-from-top-2"
                    >
                       <p className="text-[10px] font-black text-slate-400 dark:text-[var(--text-tertiary)] uppercase mb-3 px-2">Selecionar Usuário</p>
                       <div className="max-h-[200px] overflow-y-auto space-y-1">
                          {allUsers.filter(u => !selectedRoom.memberIds?.includes(u.id)).map((user, idx) => (
                            <button 
                              key={`add-member-${user.id || idx}`}
                              onClick={() => handleAddMember(user.id)}
                              className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-white dark:hover:bg-[var(--surface-card)] transition-all text-left"
                            >
                               <div className="w-8 h-8 rounded-lg bg-indigo-500 dark:bg-[var(--accent)] flex items-center justify-center text-white text-xs font-black">
                                  {user.name.charAt(0)}
                               </div>
                               <div>
                                  <p className="text-xs font-black text-slate-800 dark:text-[var(--text-primary)]">{user.name}</p>
                                  <p className="text-[9px] font-bold text-slate-400 dark:text-[var(--text-tertiary)] uppercase tracking-tighter">{user.role}</p>
                               </div>
                               <Plus size={14} className="ml-auto text-indigo-500 dark:text-[var(--accent-text)]" />
                            </button>
                          ))}
                       </div>
                    </motion.div>
                  )}

                  <div className="space-y-2">
                    {(selectedRoom.memberIds || []).map((userId, idx) => {
                      const user = allUsers.find(u => u.id === userId) || (userId === currentUser?.id ? currentUser : null);
                      if (!user) return null;
                      return (
                        <div key={`member-${userId || idx}`} className="flex items-center gap-4 p-3 rounded-3xl hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] transition-all group/member">
                           <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-[var(--surface-pill)] flex items-center justify-center overflow-hidden">
                              {user.avatarUrl ? <img src={user.avatarUrl} className="w-full h-full object-cover" /> : <span className="font-black text-slate-400 dark:text-[var(--text-tertiary)]">{user.name.charAt(0)}</span>}
                           </div>
                           <div className="flex-1">
                              <p className="text-sm font-black text-slate-800 dark:text-[var(--text-primary)]">{user.name}{userId === currentUser?.id && ' (Sua conta)'}</p>
                              <p className="text-[10px] font-bold text-slate-400 dark:text-[var(--text-tertiary)] uppercase tracking-tighter">{user.role}</p>
                           </div>
                           {userId !== currentUser?.id && (
                             <button 
                               onClick={() => handleRemoveMember(userId)}
                               className="p-2 text-slate-300 hover:text-rose-500 dark:hover:text-[var(--text-danger)] opacity-0 group-hover/member:opacity-100 transition-all"
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
                    className="w-full flex items-center justify-center gap-2 py-4 text-rose-500 dark:text-[var(--text-danger)] font-black text-sm uppercase tracking-widest hover:bg-rose-50 dark:hover:bg-[var(--surface-danger)] rounded-2xl transition-all"
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
              className="relative w-full max-w-md bg-white dark:bg-[var(--surface-card)] rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 dark:border-[var(--border-default)] flex items-center justify-between">
                <div className="flex items-center gap-3">
                   <div className="p-2 bg-indigo-50 dark:bg-[var(--accent)]/10 rounded-xl text-indigo-600 dark:text-[var(--accent-text)]">
                      <Settings size={20} />
                   </div>
                   <h3 className="text-xl font-black text-slate-800 dark:text-[var(--text-primary)] tracking-tight">Personalização</h3>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-[var(--surface-pill)] rounded-xl transition-all">
                  <X size={20} className="text-slate-400 dark:text-[var(--text-tertiary)]" />
                </button>
              </div>

              <div className="p-8 space-y-8">
                {/* Bubble Color */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest">
                     <Palette size={14} /> Cor das Bolhas
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {['indigo', 'emerald', 'blue', 'rose', 'amber', 'slate', 'violet'].map(color => (
                       <button
                         key={color}
                         onClick={() => updatePreferences({ bubbleColor: color })}
                         className={cn(
                           "w-10 h-10 rounded-xl transition-all flex items-center justify-center border-2",
                           bubbleColor === color ? "border-indigo-500 dark:border-[var(--accent)] scale-110 shadow-lg" : "border-transparent opacity-80"
                         )}
                         style={{ backgroundColor: `var(--color-${color}-600)` }}
                       >
                         {bubbleColor === color && <Check size={18} className="text-white" />}
                       </button>
                    ))}
                  </div>
                </div>

                {/* Avatar Size */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] tracking-widest">
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
                             ? "bg-indigo-600 dark:bg-[var(--accent)] border-indigo-600 dark:border-[var(--accent)] text-white shadow-lg" 
                             : "bg-slate-50 dark:bg-[var(--surface-card)] border-slate-200 dark:border-[var(--border-default)] text-slate-600 dark:text-[var(--text-secondary)] hover:bg-slate-100 dark:hover:bg-[var(--surface-pill)]"
                         )}
                       >
                         {size.label}
                       </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-[var(--surface-card)] rounded-2xl border border-slate-100 dark:border-[var(--border-default)]">
                   <p className="text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)] mb-3 tracking-widest">Prévia</p>
                   <div className="flex items-end gap-2">
                      {avatarSize !== 'none' && (
                        <div className={cn("rounded-lg bg-slate-200 dark:bg-[var(--border-default)] shrink-0", 
                          avatarSize === 'xs' && "w-4 h-4",
                          avatarSize === 'sm' && "w-6 h-6",
                          avatarSize === 'md' && "w-8 h-8",
                          avatarSize === 'lg' && "w-10 h-10",
                        )} />
                      )}
                      <div className={cn("px-4 py-2 rounded-2xl rounded-bl-none text-xs text-white font-medium", `bg-${bubbleColor}-600`)}>
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
              className="relative w-full max-w-lg bg-white dark:bg-[var(--surface-card)] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[600px]"
            >
               <div className="p-8 border-b border-slate-100 dark:border-[var(--border-default)] flex items-center justify-between shrink-0 bg-white dark:bg-[var(--surface-card)] z-10">
                  <div className="flex items-center gap-3">
                     <div className="p-2 bg-indigo-50 dark:bg-[var(--accent)]/10 rounded-xl text-indigo-600 dark:text-[var(--accent-text)]">
                        <Scissors size={20} />
                     </div>
                     <h3 className="text-xl font-black text-slate-800 dark:text-[var(--text-primary)] tracking-tight">Criar Sticker</h3>
                  </div>
                  <button onClick={() => setIsCroppingSticker(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-[var(--surface-pill)] rounded-xl transition-all">
                    <X size={20} className="text-slate-400 dark:text-[var(--text-tertiary)]" />
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
                      <div className="bg-amber-100/90 dark:bg-[var(--surface-warning)]/90 backdrop-blur-md px-4 py-2 rounded-xl border border-amber-200 dark:border-[var(--border-alert)] flex items-center gap-3 shadow-lg">
                        <span className="text-[10px] font-black text-amber-800 dark:text-[var(--text-warning)] uppercase tracking-widest">Aviso: Recortar removerá a animação</span>
                        <button 
                          onClick={() => {
                            const updatedStickers = [...(currentUser?.chatPreferences?.personalStickers || []), tempStickerUrl];
                            updatePreferences({ personalStickers: updatedStickers });
                            setIsCroppingSticker(false);
                            setTempStickerUrl(null);
                            setShowStickerPicker(true);
                          }}
                          className="px-3 py-1 bg-amber-600 dark:bg-[var(--accent-warning-hover)] text-white rounded-lg text-[9px] font-black uppercase shadow-sm hover:bg-amber-700 transition-all"
                        >
                          Usar Original (Animado)
                        </button>
                      </div>
                    </div>
                  ) : null}
               </div>

               <div className="p-8 space-y-6 shrink-0 bg-white dark:bg-[var(--surface-card)]">
                  <div className="space-y-2">
                     <div className="flex justify-between text-[10px] font-black uppercase text-slate-400 dark:text-[var(--text-tertiary)]">
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
                       className="w-full h-2 bg-slate-100 dark:bg-[var(--surface-pill)] rounded-full appearance-none cursor-pointer accent-indigo-600 dark:accent-[var(--accent)]"
                     />
                  </div>

                  <div className="flex gap-4">
                     <button 
                       onClick={() => setIsCroppingSticker(false)}
                       className="flex-1 px-6 py-4 rounded-2xl font-black text-sm uppercase tracking-widest text-slate-500 dark:text-[var(--text-tertiary)] hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] transition-all"
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
                       className="flex-1 bg-indigo-600 dark:bg-[var(--accent)] text-white rounded-2xl py-4 font-black transition-all hover:bg-indigo-700 dark:hover:bg-[var(--accent-hover)] shadow-xl shadow-indigo-100"
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
               className="absolute bg-white dark:bg-[var(--surface-card)] rounded-2xl shadow-2xl border border-slate-100 dark:border-[var(--border-default)] py-2 w-48 overflow-hidden"
               onClick={e => e.stopPropagation()}
            >
               <button 
                 onClick={() => {
                   const updated = [...(currentUser?.chatPreferences?.personalStickers || [])];
                   updated.splice(stickerContextMenu.index, 1);
                   updatePreferences({ personalStickers: updated });
                   setStickerContextMenu(null);
                 }}
                 className="w-full flex items-center gap-3 px-4 py-3 hover:bg-rose-50 dark:hover:bg-[var(--surface-danger)] text-rose-600 dark:text-[var(--text-danger)] transition-colors text-sm font-bold"
               >
                  <Trash2 size={16} className="text-rose-400 dark:text-[var(--text-danger)]" />
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
            className="fixed z-[100] w-64 bg-white dark:bg-[var(--surface-card)] rounded-2xl shadow-2xl border border-slate-100 dark:border-[var(--border-default)] overflow-hidden py-2"
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
                     className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] text-slate-700 dark:text-[var(--text-secondary)] transition-colors text-sm font-bold"
                   >
                      <Clock size={16} className="text-slate-400 dark:text-[var(--text-tertiary)]" />
                      {isReadLater ? 'Remover "Ler Depois"' : 'Marcar para ler depois'}
                   </button>

                   <button 
                     onClick={() => {
                        togglePin({ stopPropagation: () => {} } as any, room.id);
                        closeContextMenu();
                     }}
                     className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] text-slate-700 dark:text-[var(--text-secondary)] transition-colors text-sm font-bold"
                   >
                      {isPinned ? <PinOff size={16} className="text-slate-400 dark:text-[var(--text-tertiary)]" /> : <Pin size={16} className="text-slate-400 dark:text-[var(--text-tertiary)]" />}
                      {isPinned ? 'Desafixar' : 'Fixar'}
                   </button>

                   {room.type === 'direct' && (
                     <button 
                       onClick={() => {
                          setIsCreatingGroup(true);
                          setSelectedMembers([otherUserId!]);
                          closeContextMenu();
                       }}
                       className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] text-slate-700 dark:text-[var(--text-secondary)] transition-colors text-sm font-bold"
                     >
                        <UserPlus size={16} className="text-slate-400 dark:text-[var(--text-tertiary)]" />
                        Convidar para Grupo
                     </button>
                   )}

                   <button 
                     onClick={() => {
                        toggleMute(room.id);
                        closeContextMenu();
                     }}
                     className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] text-slate-700 dark:text-[var(--text-secondary)] transition-colors text-sm font-bold"
                   >
                      {isMuted ? <Bell size={16} className="text-slate-400 dark:text-[var(--text-tertiary)]" /> : <BellOff size={16} className="text-slate-400 dark:text-[var(--text-tertiary)]" />}
                      {isMuted ? 'Ativar notificações' : 'Silenciar'}
                   </button>

                   <div className="h-px bg-slate-100 dark:bg-[var(--surface-pill)] my-1 mx-2" />

                   <button 
                     className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] text-slate-700 dark:text-[var(--text-secondary)] transition-colors text-sm font-bold"
                   >
                      <UserCircle size={16} className="text-slate-400 dark:text-[var(--text-tertiary)]" />
                      Visualizar perfil
                   </button>

                   {otherUserId && (
                     <button 
                       onClick={() => {
                          setFindChatsWithUserId(otherUserId);
                          closeContextMenu();
                       }}
                       className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-[var(--surface-card)] text-slate-700 dark:text-[var(--text-secondary)] transition-colors text-sm font-bold"
                     >
                        <SearchIcon size={16} className="text-slate-400 dark:text-[var(--text-tertiary)]" />
                        Encontrar conversas
                     </button>
                   )}

                   <button 
                     onClick={() => {
                        toggleHideRoom(room.id);
                        closeContextMenu();
                     }}
                     className={cn(
                       "w-full flex items-center gap-3 px-4 py-3 hover:bg-rose-50 dark:hover:bg-[var(--surface-danger)] text-rose-600 dark:text-[var(--text-danger)] transition-colors text-sm font-bold",
                       room.hiddenBy?.includes(currentUser?.id || '') && "text-indigo-600 dark:text-[var(--accent-text)] hover:bg-indigo-50 dark:hover:bg-[var(--accent)]/10"
                     )}
                   >
                      {room.hiddenBy?.includes(currentUser?.id || '') ? (
                        <>
                          <Eye size={16} className="text-indigo-400 dark:text-[var(--accent-text)]" />
                          Exibir conversa
                        </>
                      ) : (
                        <>
                          <EyeOff size={16} className="text-rose-400 dark:text-[var(--text-danger)]" />
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
    </div>
  );
}
