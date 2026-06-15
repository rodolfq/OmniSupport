'use client';

import React, { useState, useEffect } from 'react';
import { 
  Shield, User, Lock, Save, Plus, Key, Globe, Edit2, Bell, Database, Loader2, Clock, Users
} from 'lucide-react';
import { cn, maskPhone, safeJsonStringify } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { UserRole, type WhatsappInstance, MockDB } from '@/lib/mock-db';
import { useApp } from '@/app/app-context';
import { NotificationSettingsContent } from '@/components/notification-settings';
import { SystemConfigContent } from '@/components/system-config-content';
import { StatusHistoryPanel } from '@/components/status-history-panel';
import { TagManager } from '@/components/tag-manager';
import { ChangePasswordModal } from '@/components/change-password-modal';
import { fileToBase64, isValidImageUrl } from '@/lib/image-utils';
import { toast } from 'sonner';
import { getWhatsappInstances, saveWhatsappInstance } from '@/app/actions';
import { InternalTeamsContent } from '@/components/internal-teams-content';
import { ConfirmDialog } from '@/components/confirm-dialog';

type Tab = 'profile' | 'security' | 'whatsapp' | 'notifications' | 'system' | 'history' | 'teams';


export default function SettingsPage() {
  const { 
    currentUser, 
    setCurrentUser, 
    setWhatsappStatus,
    playSound
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

  useEffect(() => {
    const fetchSystemConfig = async () => {
      const { data: cat } = await supabase.from('config_categories').select('*');
      const { data: prio } = await supabase.from('config_priorities').select('*');
      setCategories(cat || []);
      setPriorities(prio || []);
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
        const updatedUser = { ...currentUser, avatarUrl: base64 };
        await supabase.from('profiles').update({ avatar_url: base64 }).eq('id', currentUser.id);
        setCurrentUser(updatedUser);
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
      const res = await fetch(`/api/whatsapp/status?sessionId=${selectedInstance.id}`);
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
          sessionId: selectedInstance.id, 
          name: selectedInstance.name,
          force // We can pass force to manager if needed, but the manager logic already handles cleanup
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
        body: safeJsonStringify({ sessionId: selectedInstance.id })
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
        <h2 className="text-3xl font-black text-slate-800 tracking-tight">Configurações</h2>
        <p className="text-slate-500 font-medium">Personalize sua experiência e gerencie parâmetros do sistema</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        <aside className="md:col-span-3 lg:col-span-2 space-y-1">
          <SettingsNavLink icon={<User size={18} />} label="Perfil" active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
          <SettingsNavLink icon={<Bell size={18} />} label="Notificações" active={activeTab === 'notifications'} onClick={() => setActiveTab('notifications')} />
          <SettingsNavLink icon={<Shield size={18} />} label="Segurança" active={activeTab === 'security'} onClick={() => setActiveTab('security')} />
          <SettingsNavLink icon={<Clock size={18} />} label="Ausência / Histórico" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
{currentUser?.role === UserRole.ADMIN && (
             <>
               <SettingsNavLink icon={<Globe size={18} />} label="WhatsApp" active={activeTab === 'whatsapp'} onClick={() => setActiveTab('whatsapp')} />
               <SettingsNavLink icon={<Database size={18} />} label="Geral" active={activeTab === 'system'} onClick={() => setActiveTab('system')} />
               <SettingsNavLink icon={<Users size={18} />} label="Equipes Internas" active={activeTab === 'teams'} onClick={() => setActiveTab('teams')} />
             </>
           )}
        </aside>

        <div className="md:col-span-9 lg:col-span-10 space-y-6">
          {activeTab === 'history' && currentUser && (
            <StatusHistoryPanel userId={currentUser.id} />
          )}

{activeTab === 'system' && currentUser?.role === UserRole.ADMIN && (
             <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <SystemConfigContent 
                  categories={categories} 
                  priorities={priorities} 
                  setCategories={setCategories} 
                  setPriorities={setPriorities} 
                />
                <TagManager />
             </div>
           )}
           {activeTab === 'teams' && currentUser?.role === UserRole.ADMIN && (
             <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                <InternalTeamsContent />
             </div>
           )}
          {activeTab === 'whatsapp' && currentUser?.role === UserRole.ADMIN && (
            <div className="bg-white border border-slate-200 rounded-[2.5rem] p-12 shadow-sm">
               <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-emerald-50 rounded-[1.5rem] flex items-center justify-center text-emerald-600">
                      <Globe size={32} />
                    </div>
                    <div className="flex items-center gap-2">
                       <h3 className="font-black text-xl text-slate-800 uppercase tracking-tight">{selectedInstance?.name}</h3>
                       <button 
                         onClick={() => {
                            setEditInstanceName(selectedInstance?.name || '');
                            setIsEditInstanceModalOpen(true);
                         }}
                         className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 transition-all"
                         title="Editar Nome do Canal"
                       >
                         <Edit2 size={16} />
                       </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex bg-slate-100 p-1.5 rounded-2xl gap-1">
                       {whatsappInstances.map(inst => (
                         <button 
                           key={inst.id}
                           onClick={() => setSelectedInstance(inst)}
                           className={cn(
                             "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                             selectedInstance?.id === inst.id ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:bg-white/50"
                           )}
                         >
                           {inst.name}
                         </button>
                       ))}
                    </div>
                    <button 
                      onClick={() => setIsNewInstanceModalOpen(true)}
                      className="p-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                      title="Adicionar Novo Canal"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center border-t border-slate-100 pt-12">
                  <div className="space-y-6">
                    <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                      <h4 className="text-xs font-black uppercase text-slate-800 mb-4 flex items-center gap-2">
                        <Globe size={14} className="text-indigo-600" />
                        Instruções para {selectedInstance?.name}
                      </h4>
                      <ul className="text-xs text-slate-500 space-y-3 font-medium">
                        <li className="flex gap-3">
                          <span className="w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] font-black shrink-0">1</span>
                          <span>Abra o WhatsApp no celular</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] font-black shrink-0">2</span>
                          <span>Toque em <span className="text-slate-800 font-bold">Aparelhos conectados</span></span>
                        </li>
                        <li className="flex gap-3">
                          <span className="w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] font-black shrink-0">3</span>
                          <span>Escaneie o QR Code ao lado</span>
                        </li>
                      </ul>
                      
                      <div className="mt-6 pt-6 border-t border-slate-200/60">
                        <div className="p-3 bg-indigo-50 rounded-2xl border border-indigo-100 flex gap-3">
                           <div className="w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center text-white shrink-0 mt-0.5">
                              <Shield size={10} />
                           </div>
                           <div className="space-y-1">
                              <p className="text-[10px] font-black text-indigo-800 uppercase tracking-tight">Conexão Segura</p>
                              <p className="text-[10px] text-indigo-700 font-medium leading-relaxed">
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
                          className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
                        >
                          Gerar Autenticação
                        </button>
                        <button 
                          onClick={() => startLinking(true)}
                          className="w-full py-2 text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest transition-all"
                        >
                          Problemas com QR? Limpar e Reiniciar
                        </button>
                      </div>
                    )}

                    {qrStatus === 'ready' && (
                      <div className="space-y-3">
                        <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
                           <p className="text-[10px] font-black text-indigo-700 uppercase tracking-widest text-center">QR Code Gerado. Escaneie agora!</p>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => startLinking(true)}
                            className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                          >
                            Forçar Novo QR
                          </button>
<button 
                             onClick={() => setConfirmingDisconnect(true)}
                             className="flex-1 py-2 bg-slate-50 hover:bg-red-50 text-red-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                           >
                             Encerrar
                           </button>
                        </div>
                      </div>
                    )}

                    {qrStatus === 'generating' && (
                      <div className="space-y-4">
                        <div className="p-6 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col items-center gap-4 animate-pulse">
                           <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                             Gerando ambiente seguro...
                           </p>
                        </div>
                        <button 
                          onClick={() => startLinking(true)}
                          className="w-full py-2 text-[10px] font-black text-indigo-600 hover:underline uppercase tracking-widest"
                        >
                          Demorando muito? Tente reiniciar
                        </button>
                      </div>
                    )}

                    {qrStatus === 'connected' && (
                      <div className="p-6 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center gap-4">
                         <div className="w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center text-white">
                           <Save size={18} />
                         </div>
                         <div>
                            <p className="text-xs font-black text-emerald-800 uppercase tracking-tight">Conectado com sucesso!</p>
                         </div>
                         <button onClick={() => setConfirmingDisconnect(true)} className="ml-auto text-[10px] font-black uppercase text-red-500 hover:underline">Desconectar</button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-center justify-center">
                    <div className="relative w-64 h-64 bg-slate-50 rounded-[3rem] border-4 border-slate-100 flex items-center justify-center mb-4 group overflow-hidden">
                       {qrStatus === 'idle' && <Globe size={48} className="text-slate-200" />}
                       {qrStatus === 'generating' && (
                         <div className="flex flex-col items-center gap-3">
                           <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Gerando QR...</span>
                         </div>
                       )}
                       {qrStatus === 'ready' && realQr && (
                         <div className="relative">
                            <img 
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(realQr)}`} 
                              alt="QR Code" 
                              className="w-48 h-48"
                            />
                            <div className="absolute inset-0 bg-white/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all text-center p-4">
                               <div className="bg-indigo-600 text-white px-4 py-2 rounded-xl shadow-lg">
                                  <p className="text-[9px] font-black uppercase tracking-widest leading-tight">Escaneie com seu WhatsApp</p>
                               </div>
                            </div>
                         </div>
                       )}
                       {qrStatus === 'connected' && (
                         <div className="text-center animate-in zoom-in-50 duration-500">
                            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mx-auto mb-4">
                               <Save size={40} />
                            </div>
                            <span className="text-[10px] font-black uppercase text-emerald-600">{selectedInstance?.name} Ativo</span>
                         </div>
                       )}
                    </div>
                    <div className="flex items-center gap-2">
                       <div className={cn(
                         "w-2 h-2 rounded-full animate-pulse",
                         qrStatus === 'connected' ? "bg-emerald-500" : "bg-slate-300"
                       )} />
                       <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Status: {qrStatus === 'connected' ? 'ONLINE' : 'OFFLINE'}</p>
                    </div>
                  </div>
               </div>
            </div>
          )}
          {activeTab === 'notifications' && (
            <div className="bg-white border border-slate-200 rounded-[2rem] p-10 shadow-sm space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
               <div>
                  <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                    <Bell className="text-indigo-600" size={24} /> Configurações de Alerta
                  </h3>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Gerencie como você recebe as notificações</p>
               </div>

               <div className="flex gap-4 p-6 bg-slate-50 rounded-3xl border border-slate-100">
                  <div className="flex-1">
                    <p className="text-sm font-black text-slate-800 uppercase tracking-tight">Teste de Som</p>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">Clique para testar os sons e desbloquear o áudio no seu navegador.</p>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => playSound('system')}
                      className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
                    >
                      Sons Sistema
                    </button>
                    <button 
                      onClick={() => playSound('chat')}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-md"
                    >
                      Sons Chat
                    </button>
                  </div>
               </div>

               <NotificationSettingsContent />
            </div>
          )}
          {activeTab === 'profile' && currentUser && (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2"><User size={20} className="text-indigo-600" /> Informações do Perfil</h3>
              
              <div className="flex flex-col md:flex-row gap-8 mb-8 items-start">
                <div className="relative group">
                  <div className="w-32 h-32 rounded-[2.5rem] bg-slate-100 border-2 border-slate-200 overflow-hidden flex items-center justify-center relative">
                    {previewUrl ? (
                      <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                    ) : isValidImageUrl(currentUser.avatarUrl) ? (
                      <img src={currentUser.avatarUrl!} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-4xl font-black text-slate-400">{currentUser.name.charAt(0)}</span>
                    )}
                    
                    {isUploading && (
                      <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
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
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Nome Completo</label>
                      <input 
                        type="text" 
                        defaultValue={currentUser.name} 
                        onChange={(e) => {
                          const updatedUser = { ...currentUser, name: e.target.value };
                          MockDB.saveUser(updatedUser);
                          setCurrentUser(updatedUser);
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Apelido</label>
                      <input type="text" defaultValue={currentUser.name.split(' ')[0]} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Email Corporativo</label>
                      <input type="email" defaultValue={currentUser.email} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-400" disabled />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Telefone</label>
                      <input 
                        type="text" 
                        value={maskPhone(currentUser.phone || "")} 
                        onChange={(e) => {
                          const updatedUser = { ...currentUser, phone: e.target.value };
                          MockDB.saveUser(updatedUser);
                          setCurrentUser(updatedUser);
                        }}
                        placeholder="(xx) xxxxx-xxxx"
                        maxLength={15}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium" 
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Bio</label>
                    <textarea 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm min-h-[100px]" 
                      defaultValue={currentUser.role === 'Administrador' ? "Lead Product Designer focado em experiências escaláveis." : "Colaborador da equipe OmniSupport."} 
                    />
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button 
                  onClick={() => {
                    MockDB.saveUser(currentUser);
                    toast.success('Perfil salvo com sucesso!');
                  }}
                  className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-md hover:bg-indigo-700 transition-all flex items-center gap-2"
                >
                  <Save size={16} /> Salvar Perfil
                </button>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2"><Lock size={20} className="text-indigo-600" /> Alterar Senha</h3>
                <p className="text-sm text-slate-500 mb-6">Para sua segurança, recomendamos alterar sua senha periodicamente.</p>
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
          <div className="relative bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 flex flex-col gap-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4">
               <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
                  <Edit2 size={24} />
               </div>
               <div>
                  <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase leading-none mb-1">Editar Canal</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">Alterar Nome da Conexão</p>
               </div>
            </div>

            <div className="space-y-4">
               <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nome da Conexão</label>
                  <input 
                    type="text" 
                    value={editInstanceName}
                    onChange={(e) => setEditInstanceName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none"
                  />
               </div>
            </div>

            <div className="flex gap-3">
               <button 
                 onClick={() => setIsEditInstanceModalOpen(false)}
                 className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-50 rounded-2xl transition-all"
               >
                 Cancelar
               </button>
               <button 
                 onClick={handleUpdateInstanceName}
                 className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100"
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
           <div className="relative bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 flex flex-col gap-6 animate-in zoom-in-95 duration-200">
             <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
                   <Plus size={24} />
                </div>
                <div>
                   <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase leading-none mb-1">Novo Canal</h3>
                   <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">Criar Instância WhatsApp</p>
                </div>
             </div>
 
             <div className="space-y-4">
                <div className="space-y-1">
                   <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Nome da Conexão</label>
                   <input 
                     type="text" 
                     value={newInstanceName}
                     onChange={(e) => setNewInstanceName(e.target.value)}
                     placeholder="Ex: Comercial SP"
                     className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none"
                   />
                </div>
                <div className="space-y-1">
                   <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Número (com DDD)</label>
                   <input 
                     type="text" 
                     value={newInstancePhone}
                     onChange={(e) => setNewInstancePhone(e.target.value)}
                     placeholder="5511988880000"
                     className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-500/10 outline-none"
                   />
                </div>
             </div>
 
             <div className="flex gap-3">
                <button 
                  onClick={() => setIsNewInstanceModalOpen(false)}
                  className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-50 rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleCreateInstance}
                  className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100"
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
        active ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

