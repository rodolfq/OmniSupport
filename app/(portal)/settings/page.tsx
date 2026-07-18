'use client';

import React, { useState, useEffect } from 'react';
import {
  Shield, User, Lock, Save, Plus, Key, Globe, Edit2, Bell, Database, Loader2, Clock, Users, MessageCircleMore
} from 'lucide-react';
import { cn, maskPhone, safeJsonStringify } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Permission, UserRole, type WhatsappInstance } from '@/lib/types';
import { UserService } from '@/lib/services/user-service';
import { useApp } from '@/app/app-context';
import { NotificationSettingsContent } from '@/components/notification-settings';
import { SystemConfigContent } from '@/components/system-config-content';
import { AutomatedMessagesContent } from '@/components/automated-messages-content';
import { StatusHistoryPanel } from '@/components/status-history-panel';
import { TagManager } from '@/components/tag-manager';
import { ChangePasswordModal } from '@/components/change-password-modal';
import { fileToBase64, isValidImageUrl } from '@/lib/image-utils';
import { toast } from 'sonner';
import { getWhatsappInstances, saveWhatsappInstance } from '@/app/actions';
import { InternalTeamsContent } from '@/components/internal-teams-content';
import { ConfirmDialog } from '@/components/confirm-dialog';

type Tab = 'profile' | 'security' | 'whatsapp' | 'notifications' | 'system' | 'history' | 'teams' | 'automated-messages';


export default function SettingsPage() {
  const { 
    currentUser, 
    setCurrentUser, 
    setWhatsappStatus,
    playSound,
    hasPermission
  } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [whatsappInstances, setWhatsappInstances] = useState<WhatsappInstance[]>([]);
  
  useEffect(() => {
    const loadInstances = async () => {
      const instances = await getWhatsappInstances();
      setWhatsappInstances(instances);
    };
    loadInstances();
  }, []);
  const [selectedInstance, setSelectedInstance] = useState<WhatsappInstance | null>(whatsappInstances[0] || null);
  const [qrStatus, setQrStatus] = useState<'idle' | 'generating' | 'ready' | 'connected'>(
    selectedInstance?.status === 'connected' ? 'connected' : 'idle'
  );
  const [realQr, setRealQr] = useState<string | null>(null);
  const [isNewInstanceModalOpen, setIsNewInstanceModalOpen] = useState(false);
  const [isEditInstanceModalOpen, setIsEditInstanceModalOpen] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [newInstancePhone, setNewInstancePhone] = useState('');
  const [editInstanceName, setEditInstanceName] = useState('');
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [priorities, setPriorities] = useState<any[]>([]);
  const [surveySettings, setSurveySettings] = useState<any>(null);

  useEffect(() => {
    const fetchSystemConfig = async () => {
      const { data: cat } = await supabase.from('config_categories').select('*');
      const { data: prio } = await supabase.from('config_priorities').select('*');
      const { data: survey } = await supabase.from('config_survey_settings').select('*');
      setCategories(cat || []);
      setPriorities(prio || []);
      setSurveySettings((survey && survey[0]) || null);
    }
    fetchSystemConfig();
  }, []);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && currentUser) {
      // 1. Set temporary blob for immediate preview
      const tempBlob = URL.createObjectURL(file);
      setPreviewUrl(tempBlob);
      setIsUploading(true);

      try {
        // 2. Process to more persistent format (Base64 for this demo, usually Supabase Storage)
        const base64 = await fileToBase64(file);
        
        // 3. Persist only after processing
        const { data, error } = await supabase
          .from('profiles')
          .update({ avatar_url: base64 })
          .eq('id', currentUser.id)
          .single();

        if (error) throw new Error(error.message);

        const persistedAvatar = data?.avatar_url || base64;
        const updatedUser = { ...currentUser, avatarUrl: persistedAvatar };
        setCurrentUser(updatedUser);
        setPreviewUrl(null);
        toast.success('Avatar atualizado com sucesso!');
        
        // Clean up blob to avoid memory leaks
        URL.revokeObjectURL(tempBlob);
      } catch (err) {
        console.error('Error processing avatar:', err);
        toast.error('Erro ao processar imagem.');
        setPreviewUrl(null); // Revert on failure
      } finally {
        setIsUploading(false);
      }
    }
  };

  const pollStatus = async () => {
    if (!selectedInstance) return;
    try {
      const res = await fetch(`/api/whatsapp/status?instanceId=${selectedInstance.id}`);
      if (!res.ok) return;
      const data = await res.json();
      
      console.log(`[Frontend:WA] Poll: ${data.status}, hasQR: ${!!data.qr}`);

      if (data.status === 'connected') {
        setQrStatus('connected');
        setRealQr(null);
        if (selectedInstance.status !== 'connected') {
          const updated = { ...selectedInstance, status: 'connected' as const };
          await saveWhatsappInstance(selectedInstance.id, selectedInstance.name, selectedInstance.phone, 'connected');
          const instances = await getWhatsappInstances();
          setWhatsappInstances(instances);
          setSelectedInstance(instances.find(i => i.id === selectedInstance.id) || updated);
          setWhatsappStatus('connected');
        }
      } else if (data.qr) {
        setQrStatus('ready');
        setRealQr(data.qr);
      } else if (data.status === 'connecting' || data.status === 'generating') {
        setQrStatus('generating');
      } else if (data.status === 'disconnected') {
        // If we were generating but now disconnected, Baileys might have failed
        setQrStatus('idle');
        setRealQr(null);
      }
    } catch (error) {
      console.error('Error polling status:', error);
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (selectedInstance && qrStatus !== 'connected' && qrStatus !== 'idle') {
      // Faster polling when waiting for QR or connection
      interval = setInterval(pollStatus, 2000);
      pollStatus(); 
    }
    return () => clearInterval(interval);
  }, [selectedInstance?.id, qrStatus]);

  const startLinking = async (force = false) => {
    if (!selectedInstance) return;
    setQrStatus('generating');
    setRealQr(null);
    
    try {
      const res = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: safeJsonStringify({
          instanceId: selectedInstance.id,
          name: selectedInstance.name
        })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao iniciar conexão');
      }

      toast.info(force ? 'Reiniciando conexão do zero...' : 'Iniciando pareamento... Aguarde o QR Code.');
    } catch (error: any) {
      console.error('Error starting connection:', error);
      setQrStatus('idle');
      toast.error(error.message || 'Erro de conexão com o servidor.');
    }
};

   const performDisconnect = async () => {
    if (!selectedInstance) return;
    
    try {
      await fetch('/api/whatsapp/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: safeJsonStringify({ instanceId: selectedInstance.id })
      });
      setQrStatus('idle');
      setRealQr(null);
      await saveWhatsappInstance(selectedInstance.id, selectedInstance.name, selectedInstance.phone, 'disconnected');
      const instances = await getWhatsappInstances();
      setWhatsappInstances(instances);
      setSelectedInstance(instances.find(i => i.id === selectedInstance.id) || null);
      
      if (!instances.some(i => i.status === 'connected')) setWhatsappStatus('disconnected');
    } catch (error) {
      console.error('Error disconnecting:', error);
    }
  };

  const runDisconnect = () => {
    if (selectedInstance) {
      performDisconnect();
    }
    setConfirmingDisconnect(false);
  };

  const handleUpdateInstanceName = async () => {
    if (!selectedInstance || !editInstanceName) return;
    await saveWhatsappInstance(selectedInstance.id, editInstanceName, selectedInstance.phone, selectedInstance.status);
    const instances = await getWhatsappInstances();
    setWhatsappInstances(instances);
    setSelectedInstance(instances.find(i => i.id === selectedInstance.id) || null);
    setIsEditInstanceModalOpen(false);
    toast.success('Nome do canal atualizado!');
  };

  const handleCreateInstance = async () => {
    if (!newInstanceName || !newInstancePhone) return;
    await saveWhatsappInstance(null, newInstanceName, newInstancePhone, 'disconnected');
    const instances = await getWhatsappInstances();
    setWhatsappInstances(instances);
    setSelectedInstance(instances[instances.length - 1] || null);
    setIsNewInstanceModalOpen(false);
    setNewInstanceName('');
    setNewInstancePhone('');
    toast.success('Novo canal de WhatsApp cadastrado!');
  };

  useEffect(() => {
    if (selectedInstance) {
      setQrStatus(selectedInstance.status === 'connected' ? 'connected' : 'idle');
      setRealQr(null);
    }
  }, [selectedInstance?.id]);

  return (
    <div className="space-y-8 px-6 lg:px-10 max-w-[1600px] mx-auto">
      <div>
        <h2 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Configurações</h2>
        <p className="text-[var(--text-tertiary)] font-medium">Personalize sua experiência e gerencie parâmetros do sistema</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        <aside className="md:col-span-3 lg:col-span-2 space-y-1">
          <SettingsNavLink icon={<User size={18} />} label="Perfil" active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
          <SettingsNavLink icon={<Bell size={18} />} label="Notificações" active={activeTab === 'notifications'} onClick={() => setActiveTab('notifications')} />
          <SettingsNavLink icon={<Shield size={18} />} label="Segurança" active={activeTab === 'security'} onClick={() => setActiveTab('security')} />
          {currentUser?.role === UserRole.ADMIN && (
             <>
               <SettingsNavLink icon={<Clock size={18} />} label="Ausência / Histórico" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
               <SettingsNavLink icon={<Globe size={18} />} label="WhatsApp" active={activeTab === 'whatsapp'} onClick={() => setActiveTab('whatsapp')} />
               <SettingsNavLink icon={<Users size={18} />} label="Equipes Internas" active={activeTab === 'teams'} onClick={() => setActiveTab('teams')} />
             </>
           )}
           {hasPermission(Permission.SETTINGS_SYSTEM) && (
             <SettingsNavLink icon={<Database size={18} />} label="Geral do Sistema" active={activeTab === 'system'} onClick={() => setActiveTab('system')} />
           )}
           {hasPermission(Permission.SETTINGS_SYSTEM) && (
             <SettingsNavLink icon={<MessageCircleMore size={18} />} label="Mensagens Automáticas" active={activeTab === 'automated-messages'} onClick={() => setActiveTab('automated-messages')} />
           )}
        </aside>

        <div className="md:col-span-9 lg:col-span-10 space-y-6">
          {activeTab === 'history' && currentUser && (
            <StatusHistoryPanel userId={currentUser.id} />
          )}

{activeTab === 'system' && hasPermission(Permission.SETTINGS_SYSTEM) && (
             <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <SystemConfigContent
                  categories={categories}
                  priorities={priorities}
                  setCategories={setCategories}
                  setPriorities={setPriorities}
                  surveySettings={surveySettings}
                  setSurveySettings={setSurveySettings}
                />
                <TagManager />
             </div>
           )}
           {activeTab === 'automated-messages' && hasPermission(Permission.SETTINGS_SYSTEM) && (
             <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                <AutomatedMessagesContent />
             </div>
           )}
           {activeTab === 'teams' && currentUser?.role === UserRole.ADMIN && (
             <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                <InternalTeamsContent />
             </div>
           )}
          {activeTab === 'whatsapp' && currentUser?.role === UserRole.ADMIN && (
            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] p-12 shadow-sm">
               <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-[var(--surface-success)] rounded-[1.5rem] flex items-center justify-center text-[var(--text-success)]">
                      <Globe size={32} />
                    </div>
                    <div className="flex items-center gap-2">
                       <h3 className="font-black text-xl text-[var(--text-primary)] uppercase tracking-tight">{selectedInstance?.name}</h3>
                       <button 
                         onClick={() => {
                            setEditInstanceName(selectedInstance?.name || '');
                            setIsEditInstanceModalOpen(true);
                         }}
                         className="p-1.5 hover:bg-[var(--surface-pill)] rounded-lg text-[var(--text-tertiary)] hover:text-[var(--accent-text)] transition-all"
                         title="Editar Nome do Canal"
                       >
                         <Edit2 size={16} />
                       </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex bg-[var(--surface-pill)] p-1.5 rounded-2xl gap-1">
                       {whatsappInstances.map(inst => (
                         <button 
                           key={inst.id}
                           onClick={() => setSelectedInstance(inst)}
                           className={cn(
                             "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                             selectedInstance?.id === inst.id ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:bg-[var(--surface-card)]"
                           )}
                         >
                           {inst.name}
                         </button>
                       ))}
                    </div>
                    <button 
                      onClick={() => setIsNewInstanceModalOpen(true)}
                      className="p-3 bg-[var(--accent)] text-white rounded-2xl hover:bg-[var(--accent-hover)] transition-all shadow-lg shadow-indigo-100"
                      title="Adicionar Novo Canal"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center border-t border-[var(--border-default)] pt-12">
                  <div className="space-y-6">
                    <div className="p-6 bg-[var(--surface-card)] rounded-3xl border border-[var(--border-default)]">
                      <h4 className="text-xs font-black uppercase text-[var(--text-primary)] mb-4 flex items-center gap-2">
                        <Globe size={14} className="text-[var(--accent-text)]" />
                        Instruções para {selectedInstance?.name}
                      </h4>
                      <ul className="text-xs text-[var(--text-tertiary)] space-y-3 font-medium">
                        <li className="flex gap-3">
                          <span className="w-5 h-5 rounded-full bg-[var(--surface-card)] border border-[var(--border-default)] flex items-center justify-center text-[10px] font-black shrink-0">1</span>
                          <span>Abra o WhatsApp no celular</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="w-5 h-5 rounded-full bg-[var(--surface-card)] border border-[var(--border-default)] flex items-center justify-center text-[10px] font-black shrink-0">2</span>
                          <span>Toque em <span className="text-[var(--text-primary)] font-bold">Aparelhos conectados</span></span>
                        </li>
                        <li className="flex gap-3">
                          <span className="w-5 h-5 rounded-full bg-[var(--surface-card)] border border-[var(--border-default)] flex items-center justify-center text-[10px] font-black shrink-0">3</span>
                          <span>Escaneie o QR Code ao lado</span>
                        </li>
                      </ul>
                      
                      <div className="mt-6 pt-6 border-t border-[var(--border-default)]/60">
                        <div className="p-3 bg-[var(--accent)]/10 rounded-2xl border border-[var(--accent)]/20 flex gap-3">
                           <div className="w-5 h-5 bg-[var(--accent)] rounded-full flex items-center justify-center text-white shrink-0 mt-0.5">
                              <Shield size={10} />
                           </div>
                           <div className="space-y-1">
                              <p className="text-[10px] font-black text-indigo-800 uppercase tracking-tight">Conexão Segura</p>
                              <p className="text-[10px] text-[var(--accent-text)] font-medium leading-relaxed">
                                Use o WhatsApp oficial no seu celular para escanear o código. A conexão é criptografada de ponta a ponta.
                              </p>
                           </div>
                        </div>
                      </div>
                    </div>
                    
                    {qrStatus === 'idle' && selectedInstance?.status !== 'connected' && (
                      <div className="flex flex-col gap-2">
                        <button 
                          onClick={() => startLinking()}
                          className="w-full py-4 bg-[var(--text-success)] text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
                        >
                          Gerar Autenticação
                        </button>
                        <button 
                          onClick={() => startLinking(true)}
                          className="w-full py-2 text-[10px] font-black text-[var(--text-tertiary)] hover:text-[var(--text-danger)] uppercase tracking-widest transition-all"
                        >
                          Problemas com QR? Limpar e Reiniciar
                        </button>
                      </div>
                    )}

                    {qrStatus === 'ready' && (
                      <div className="space-y-3">
                        <div className="p-4 bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-2xl">
                           <p className="text-[10px] font-black text-[var(--accent-text)] uppercase tracking-widest text-center">QR Code Gerado. Escaneie agora!</p>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => startLinking(true)}
                            className="flex-1 py-2 bg-[var(--surface-pill)] hover:bg-[var(--border-default)] text-[var(--text-secondary)] rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                          >
                            Forçar Novo QR
                          </button>
<button 
                             onClick={() => setConfirmingDisconnect(true)}
                             className="flex-1 py-2 bg-[var(--surface-card)] hover:bg-[var(--surface-danger)] text-[var(--text-danger)] rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                           >
                             Encerrar
                           </button>
                        </div>
                      </div>
                    )}

                    {qrStatus === 'generating' && (
                      <div className="space-y-4">
                        <div className="p-6 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl flex flex-col items-center gap-4 animate-pulse">
                           <Loader2 className="w-8 h-8 text-[var(--accent-text)] animate-spin" />
                           <p className="text-[10px] font-black text-[var(--text-tertiary)] uppercase tracking-widest text-center">
                             Gerando ambiente seguro...
                           </p>
                        </div>
                        <button 
                          onClick={() => startLinking(true)}
                          className="w-full py-2 text-[10px] font-black text-[var(--accent-text)] hover:underline uppercase tracking-widest"
                        >
                          Demorando muito? Tente reiniciar
                        </button>
                      </div>
                    )}

                    {qrStatus === 'connected' && (
                      <div className="p-6 bg-[var(--surface-success)] border border-[var(--text-success)]/20 rounded-2xl flex items-center gap-4">
                         <div className="w-10 h-10 bg-[var(--text-success)] rounded-full flex items-center justify-center text-white">
                           <Save size={18} />
                         </div>
                         <div>
                            <p className="text-xs font-black text-[var(--text-success)] uppercase tracking-tight">Conectado com sucesso!</p>
                         </div>
                         <button onClick={() => setConfirmingDisconnect(true)} className="ml-auto text-[10px] font-black uppercase text-[var(--text-danger)] hover:underline">Desconectar</button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-center justify-center">
                    <div className="relative w-64 h-64 bg-[var(--surface-card)] rounded-[3rem] border-4 border-[var(--border-default)] flex items-center justify-center mb-4 group overflow-hidden">
                       {qrStatus === 'idle' && <Globe size={48} className="text-slate-200" />}
                       {qrStatus === 'generating' && (
                         <div className="flex flex-col items-center gap-3">
                           <div className="w-12 h-12 border-4 border-[var(--text-success)] border-t-transparent rounded-full animate-spin" />
                           <span className="text-[10px] font-black text-[var(--text-tertiary)] uppercase tracking-widest animate-pulse">Gerando QR...</span>
                         </div>
                       )}
                       {qrStatus === 'ready' && realQr && (
                         <div className="relative">
                            <img 
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(realQr)}`} 
                              alt="QR Code" 
                              className="w-48 h-48"
                            />
                            <div className="absolute inset-0 bg-[var(--surface-card)] backdrop-blur-[2px] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all text-center p-4">
                               <div className="bg-[var(--accent)] text-white px-4 py-2 rounded-xl shadow-lg">
                                  <p className="text-[9px] font-black uppercase tracking-widest leading-tight">Escaneie com seu WhatsApp</p>
                               </div>
                            </div>
                         </div>
                       )}
                       {qrStatus === 'connected' && (
                         <div className="text-center animate-in zoom-in-50 duration-500">
                            <div className="w-20 h-20 bg-[var(--surface-success)] rounded-full flex items-center justify-center text-[var(--text-success)] mx-auto mb-4">
                               <Save size={40} />
                            </div>
                            <span className="text-[10px] font-black uppercase text-[var(--text-success)]">{selectedInstance?.name} Ativo</span>
                         </div>
                       )}
                    </div>
                    <div className="flex items-center gap-2">
                       <div className={cn(
                         "w-2 h-2 rounded-full animate-pulse",
                         qrStatus === 'connected' ? "bg-[var(--text-success)]" : "bg-[var(--text-tertiary)]"
                       )} />
                       <p className="text-[10px] text-[var(--text-tertiary)] font-black uppercase tracking-widest">Status: {qrStatus === 'connected' ? 'ONLINE' : 'OFFLINE'}</p>
                    </div>
                  </div>
               </div>
            </div>
          )}
          {activeTab === 'notifications' && (
            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-10 shadow-sm space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
               <div>
                  <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
                    <Bell className="text-[var(--accent-text)]" size={24} /> Configurações de Alerta
                  </h3>
                  <p className="text-xs text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">Gerencie como você recebe as notificações</p>
               </div>

               <div className="flex gap-4 p-6 bg-[var(--surface-card)] rounded-3xl border border-[var(--border-default)]">
                  <div className="flex-1">
                    <p className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight">Teste de Som</p>
                    <p className="text-xs text-[var(--text-tertiary)] font-medium leading-relaxed">Clique para testar os sons e desbloquear o áudio no seu navegador.</p>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => playSound('system')}
                      className="px-4 py-2 bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[var(--surface-card)] transition-all shadow-sm"
                    >
                      Sons Sistema
                    </button>
                    <button 
                      onClick={() => playSound('chat')}
                      className="px-4 py-2 bg-[var(--accent)] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all shadow-md"
                    >
                      Sons Chat
                    </button>
                  </div>
               </div>

               <NotificationSettingsContent />
            </div>
          )}
          {activeTab === 'profile' && currentUser && (
            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-8 shadow-sm">
              <h3 className="font-bold text-[var(--text-primary)] mb-6 flex items-center gap-2"><User size={20} className="text-[var(--accent-text)]" /> Informações do Perfil</h3>
              
              <div className="flex flex-col md:flex-row gap-8 mb-8 items-start">
                <div className="relative group">
                  <div className="w-32 h-32 rounded-[2.5rem] bg-[var(--surface-pill)] border-2 border-[var(--border-default)] overflow-hidden flex items-center justify-center relative">
                    {previewUrl ? (
                      <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                    ) : isValidImageUrl(currentUser.avatarUrl) ? (
                      <img src={currentUser.avatarUrl!} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-4xl font-black text-[var(--text-tertiary)]">{currentUser.name.charAt(0)}</span>
                    )}
                    
                    {isUploading && (
                      <div className="absolute inset-0 bg-[var(--surface-card)] backdrop-blur-sm flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-[var(--accent-text)] animate-spin" />
                      </div>
                    )}

                    <button 
                      onClick={() => document.getElementById('avatar-upload')?.click()}
                      disabled={isUploading}
                      className={cn(
                        "absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-[10px] font-black uppercase tracking-widest",
                        isUploading && "hidden"
                      )}
                    >
                      <Plus size={24} className="mb-1" />
                      Alterar
                    </button>
                  </div>
                  <input 
                    id="avatar-upload"
                    type="file" 
                    className="hidden" 
                    accept="image/*"
                    onChange={handleAvatarUpload}
                  />
                </div>

                <div className="flex-1 space-y-4 w-full">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest">Nome Completo</label>
                      <input 
                        type="text" 
                        defaultValue={currentUser.name}
                        onChange={(e) => {
                          setCurrentUser(prev => prev ? { ...prev, name: e.target.value } : null);
                        }}
                        className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest">Apelido</label>
                      <input type="text" defaultValue={currentUser.name.split(' ')[0]} className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest">Email Corporativo</label>
                      <input type="email" defaultValue={currentUser.email} className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold text-[var(--text-tertiary)]" disabled />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest">Telefone</label>
                      <input 
                        type="text" 
                        value={maskPhone(currentUser.phone || "")} 
                        onChange={(e) => {
                          setCurrentUser(prev => prev ? { ...prev, phone: e.target.value } : null);
                        }}
                        placeholder="(xx) xxxxx-xxxx"
                        maxLength={15}
                        className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-medium" 
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest">Bio</label>
                    <textarea 
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm min-h-[100px]" 
                      defaultValue={currentUser.role === 'Administrador' ? "Lead Product Designer focado em experiências escaláveis." : "Colaborador da equipe SSX Resolve."}
                    />
                  </div>
                </div>
              </div>
 
              <div className="mt-8 flex justify-end">
                <button 
                  onClick={async () => {
                    try {
                      await UserService.save(currentUser);
                      toast.success('Perfil salvo com sucesso!');
                    } catch (err: any) {
                      console.error("Erro ao salvar perfil:", err);
                      toast.error("Erro ao salvar perfil.");
                    }
                  }}
                  className="bg-[var(--accent)] text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-md hover:bg-[var(--accent-hover)] transition-all flex items-center gap-2"
                >
                  <Save size={16} /> Salvar Perfil
                </button>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-8 shadow-sm">
                <h3 className="font-bold text-[var(--text-primary)] mb-6 flex items-center gap-2"><Lock size={20} className="text-[var(--accent-text)]" /> Alterar Senha</h3>
                <p className="text-sm text-[var(--text-tertiary)] mb-6">Para sua segurança, recomendamos alterar sua senha periodicamente.</p>
                <button 
                  onClick={() => setIsPasswordModalOpen(true)}
                  className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-md hover:bg-slate-800 transition-all flex items-center gap-2"
                >
                  <Key size={16} /> Abrir Alteração de Senha
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <ChangePasswordModal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} />

      {isEditInstanceModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsEditInstanceModalOpen(false)} />
          <div className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 flex flex-col gap-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4">
               <div className="w-12 h-12 bg-[var(--accent)] rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
                  <Edit2 size={24} />
               </div>
               <div>
                  <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight uppercase leading-none mb-1">Editar Canal</h3>
                  <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest leading-none">Alterar Nome da Conexão</p>
               </div>
            </div>

            <div className="space-y-4">
               <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome da Conexão</label>
                  <input 
                    type="text" 
                    value={editInstanceName}
                    onChange={(e) => setEditInstanceName(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none"
                  />
               </div>
            </div>

            <div className="flex gap-3">
               <button 
                 onClick={() => setIsEditInstanceModalOpen(false)}
                 className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-card)] rounded-2xl transition-all"
               >
                 Cancelar
               </button>
               <button 
                 onClick={handleUpdateInstanceName}
                 className="flex-1 py-4 bg-[var(--accent)] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all shadow-xl shadow-indigo-100"
               >
                 Salvar Alterações
               </button>
            </div>
          </div>
        </div>
      )}

{isNewInstanceModalOpen && (
         <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsNewInstanceModalOpen(false)} />
           <div className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 flex flex-col gap-6 animate-in zoom-in-95 duration-200">
             <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-[var(--accent)] rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
                   <Plus size={24} />
                </div>
                <div>
                   <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight uppercase leading-none mb-1">Novo Canal</h3>
                   <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest leading-none">Criar Instância WhatsApp</p>
                </div>
             </div>
 
             <div className="space-y-4">
                <div className="space-y-1">
                   <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome da Conexão</label>
                   <input 
                     type="text" 
                     value={newInstanceName}
                     onChange={(e) => setNewInstanceName(e.target.value)}
                     placeholder="Ex: Comercial SP"
                     className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none"
                   />
                </div>
                <div className="space-y-1">
                   <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Número (com DDD)</label>
                   <input 
                     type="text" 
                     value={newInstancePhone}
                     onChange={(e) => setNewInstancePhone(e.target.value)}
                     placeholder="5511988880000"
                     className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none"
                   />
                </div>
             </div>
 
             <div className="flex gap-3">
                <button 
                  onClick={() => setIsNewInstanceModalOpen(false)}
                  className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-card)] rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleCreateInstance}
                  className="flex-1 py-4 bg-[var(--accent)] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all shadow-xl shadow-indigo-100"
                >
                  Cadastrar Canal
                </button>
             </div>
           </div>
         </div>
       )}

      <ConfirmDialog
        isOpen={confirmingDisconnect}
        onClose={() => setConfirmingDisconnect(false)}
        onConfirm={runDisconnect}
        title="Desconectar Sessão"
        description={`Deseja realmente desconectar e limpar a sessão de ${selectedInstance?.name || 'WhatsApp'}?`}
        confirmLabel="Desconectar"
        variant="danger"
      />
    </div>
  );
}

function SettingsNavLink({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold transition-all",
        active ? "bg-[var(--accent)]/10 text-[var(--accent-text)]" : "text-[var(--text-tertiary)] hover:bg-[var(--surface-card)] hover:text-[var(--text-secondary)]"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

