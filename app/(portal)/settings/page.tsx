'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  User, Lock, Save, Plus, Key, Globe, Bell, Database, Loader2, Clock, MessageCircleMore, Plug, Mail, Bot,
  UserCog, ShieldCheck, Library, RefreshCw as RefreshCwIcon, Rocket, CalendarRange
} from 'lucide-react';
import { cn, maskPhone } from '@/lib/utils';
import { Permission, UserRole } from '@/lib/types';
import { UserService } from '@/lib/services/user-service';
import { ConfigService } from '@/lib/services/config-service';
import { useApp } from '@/app/app-context';
import { NotificationSettingsContent } from '@/components/notification-settings';
import { SystemConfigContent } from '@/components/system-config-content';
import { AutomatedMessagesContent } from '@/components/automated-messages-content';
import { StatusHistoryPanel } from '@/components/status-history-panel';
import { TagManager } from '@/components/tag-manager';
import { StatusManager } from '@/components/status-manager';
import { TicketClassificationManager } from '@/components/ticket-classification-manager';
import { ChangePasswordModal } from '@/components/change-password-modal';
import { WhatsAppChannelManager } from '@/components/whatsapp-channel-manager';
import { fileToCompressedAvatarBase64, isValidImageUrl } from '@/lib/image-utils';
import { toast } from 'sonner';
import { IntegrationsContent } from '@/components/integrations-content';
import { EmailSettingsContent } from '@/components/email-settings-content';
import { AiAssistantSettingsContent } from '@/components/ai-assistant-settings-content';
import { TeamContent } from '@/components/team-content';
import { PermissionsContent } from '@/components/permissions-content';
import { QueuesContent } from '@/components/queues-content';
import { GiroContent } from '@/components/giro-content';
import { WeekendScheduleContent } from '@/components/weekend-schedule-content';
import { HotfixesContent } from '@/components/hotfixes-content';

type Tab =
  | 'profile' | 'security' | 'notifications'
  | 'team' | 'permissions' | 'history'
  | 'queues' | 'giro' | 'weekend-schedule' | 'whatsapp' | 'hotfixes'
  | 'system' | 'ai-assistant' | 'automated-messages' | 'integrations' | 'email';

const VALID_TABS: Tab[] = [
  'profile', 'security', 'notifications',
  'team', 'permissions', 'history',
  'queues', 'giro', 'weekend-schedule', 'whatsapp', 'hotfixes',
  'system', 'ai-assistant', 'automated-messages', 'integrations', 'email'
];

export default function SettingsPage() {
  const {
    currentUser,
    setCurrentUser,
    playSound,
    hasPermission
  } = useApp();
  // A aba WhatsApp usa WhatsAppChannelManager: canal Baileys fixo (QR Code,
  // 'default', igual ao que já funcionava em /whatsapp) + lista de canais
  // Meta Cloud API (0..N, criados/editados na própria tela — ver
  // components/whatsapp-channel-manager.tsx). A versão multi-instância
  // Baileys que existia aqui antes nunca funcionou de verdade (exigia
  // cadastrar um canal manualmente antes de mostrar qualquer QR Code, sem
  // nenhuma indicação disso na tela) e foi removida — não confundir com a
  // multi-instância Meta atual, que não tem esse problema (não depende de
  // QR Code/sessão pareada). Todas as rotas antigas (/whatsapp, /team,
  // /queues, /permissions, /hotfixes, /giro) agora só redirecionam pra cá —
  // ?tab= permite abrir direto em qualquer aba.
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<Tab>(
    VALID_TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'profile'
  );
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [categories, setCategories] = useState<any[]>([]);
  const [requestTypes, setRequestTypes] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [priorities, setPriorities] = useState<any[]>([]);
  const [surveySettings, setSurveySettings] = useState<any>(null);

  const isSystemAdmin = currentUser?.role === UserRole.ADMIN;
  const isTeamAdmin = (currentUser?.adminOfTeamIds || []).length > 0;
  const canViewTeam = isSystemAdmin || hasPermission(Permission.TEAM_READ);
  const canViewPermissions = isSystemAdmin || isTeamAdmin || hasPermission(Permission.SETTINGS_WRITE);
  const canViewGiro = hasPermission(Permission.GIRO_VIEW) || hasPermission(Permission.GIRO_MANAGE);

  useEffect(() => {
    const fetchSystemConfig = async () => {
      // Uma busca por lista, em paralelo, pelas rotas de configuração.
      const [cat, reqType, prod, prio, survey] = await Promise.all([
        // usage=1: esta é a única tela que precisa saber quantos registros
        // usam cada item — é o que decide se o botão oferecido é "arquivar"
        // ou "excluir definitivamente".
        ConfigService.getSimpleList('categories', true),
        ConfigService.getSimpleList('request-types', true),
        ConfigService.getSimpleList('products', true),
        ConfigService.getPriorities(),
        ConfigService.getSurveySettings()
      ]);
      setCategories(cat || []);
      setRequestTypes(reqType || []);
      setProducts(prod || []);
      setPriorities(prio || []);
      setSurveySettings(survey || null);
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
        // 2. Redimensiona/comprime antes de persistir — sem isso, foto de
        // celular sem tratamento vira MBs direto na coluna avatar_url, e
        // toda tela que lista usuários paga esse peso.
        const base64 = await fileToCompressedAvatarBase64(file);

        // 3. Persist only after processing
        // Via UserService: a rota gera a MINIATURA do avatar junto
        // (avatar_thumb_url) e aplica as travas de autorização. O caminho
        // anterior escrevia só avatar_url, então a foto trocada por aqui
        // ficava sem miniatura e aparecia como inicial nas listas.
        await UserService.save({ id: currentUser.id, avatarUrl: base64 });

        const persistedAvatar = base64;
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

  return (
    <div className="space-y-8 px-6 lg:px-10 max-w-[1600px] mx-auto">
      <div>
        <h2 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Configurações</h2>
        <p className="text-[var(--text-tertiary)] font-medium">Personalize sua experiência e gerencie parâmetros do sistema</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        <aside className="md:col-span-4 lg:col-span-3 xl:col-span-2">
          <nav className="md:sticky md:top-8 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[1.75rem] p-3 shadow-sm space-y-4">
            <SettingsNavGroup title="Minha Conta">
              <SettingsNavLink icon={<User size={16} />} label="Perfil" active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
              <SettingsNavLink icon={<Bell size={16} />} label="Notificações" active={activeTab === 'notifications'} onClick={() => setActiveTab('notifications')} />
              <SettingsNavLink icon={<Lock size={16} />} label="Segurança" active={activeTab === 'security'} onClick={() => setActiveTab('security')} />
            </SettingsNavGroup>

            {(canViewTeam || canViewPermissions || hasPermission(Permission.TEAM_STATUS_MANAGE)) && (
              <SettingsNavGroup title="Equipe">
                {canViewTeam && (
                  <SettingsNavLink icon={<UserCog size={16} />} label="Equipe" active={activeTab === 'team'} onClick={() => setActiveTab('team')} />
                )}
                {canViewPermissions && (
                  <SettingsNavLink icon={<ShieldCheck size={16} />} label="Equipes & Permissões" active={activeTab === 'permissions'} onClick={() => setActiveTab('permissions')} />
                )}
                {hasPermission(Permission.TEAM_STATUS_MANAGE) && (
                  <SettingsNavLink icon={<Clock size={16} />} label="Ausência / Histórico" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
                )}
              </SettingsNavGroup>
            )}

            {(hasPermission(Permission.QUEUES_MANAGE) || canViewGiro || hasPermission(Permission.WHATSAPP_MANAGE) || hasPermission(Permission.HOTFIXES_MANAGE)) && (
              <SettingsNavGroup title="Atendimento">
                {hasPermission(Permission.QUEUES_MANAGE) && (
                  <SettingsNavLink icon={<Library size={16} />} label="Filas" active={activeTab === 'queues'} onClick={() => setActiveTab('queues')} />
                )}
                {canViewGiro && (
                  <SettingsNavLink icon={<RefreshCwIcon size={16} />} label="Giro de Atendimento" active={activeTab === 'giro'} onClick={() => setActiveTab('giro')} />
                )}
                {canViewGiro && (
                  <SettingsNavLink icon={<CalendarRange size={16} />} label="Escala Fim de Semana" active={activeTab === 'weekend-schedule'} onClick={() => setActiveTab('weekend-schedule')} />
                )}
                {hasPermission(Permission.WHATSAPP_MANAGE) && (
                  <SettingsNavLink icon={<Globe size={16} />} label="WhatsApp" active={activeTab === 'whatsapp'} onClick={() => setActiveTab('whatsapp')} />
                )}
                {hasPermission(Permission.HOTFIXES_MANAGE) && (
                  <SettingsNavLink icon={<Rocket size={16} />} label="Hotfixes" active={activeTab === 'hotfixes'} onClick={() => setActiveTab('hotfixes')} />
                )}
              </SettingsNavGroup>
            )}

            {(hasPermission(Permission.SETTINGS_SYSTEM) || hasPermission(Permission.SETTINGS_AUTOMATION) || hasPermission(Permission.SETTINGS_INTEGRATIONS) || hasPermission(Permission.SETTINGS_EMAIL)) && (
              <SettingsNavGroup title="Sistema">
                {hasPermission(Permission.SETTINGS_SYSTEM) && (
                  <SettingsNavLink icon={<Database size={16} />} label="Geral do Sistema" active={activeTab === 'system'} onClick={() => setActiveTab('system')} />
                )}
                {hasPermission(Permission.SETTINGS_SYSTEM) && (
                  <SettingsNavLink icon={<Bot size={16} />} label="Agente de IA" active={activeTab === 'ai-assistant'} onClick={() => setActiveTab('ai-assistant')} />
                )}
                {hasPermission(Permission.SETTINGS_AUTOMATION) && (
                  <SettingsNavLink icon={<MessageCircleMore size={16} />} label="Mensagens Automáticas" active={activeTab === 'automated-messages'} onClick={() => setActiveTab('automated-messages')} />
                )}
                {hasPermission(Permission.SETTINGS_INTEGRATIONS) && (
                  <SettingsNavLink icon={<Plug size={16} />} label="Integrações" active={activeTab === 'integrations'} onClick={() => setActiveTab('integrations')} />
                )}
                {hasPermission(Permission.SETTINGS_EMAIL) && (
                  <SettingsNavLink icon={<Mail size={16} />} label="E-mail" active={activeTab === 'email'} onClick={() => setActiveTab('email')} />
                )}
              </SettingsNavGroup>
            )}
          </nav>
        </aside>

        <div className="md:col-span-8 lg:col-span-9 xl:col-span-10 space-y-6">
          {activeTab === 'history' && currentUser && hasPermission(Permission.TEAM_STATUS_MANAGE) && (
            <StatusHistoryPanel userId={currentUser.id} />
          )}

          {activeTab === 'team' && canViewTeam && <TeamContent />}
          {activeTab === 'permissions' && canViewPermissions && <PermissionsContent />}
          {activeTab === 'queues' && hasPermission(Permission.QUEUES_MANAGE) && <QueuesContent />}
          {activeTab === 'giro' && canViewGiro && <GiroContent />}
          {activeTab === 'weekend-schedule' && canViewGiro && <WeekendScheduleContent />}
          {activeTab === 'hotfixes' && hasPermission(Permission.HOTFIXES_MANAGE) && <HotfixesContent />}

{activeTab === 'system' && hasPermission(Permission.SETTINGS_SYSTEM) && (
             <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <SystemConfigContent
                  categories={categories}
                  requestTypes={requestTypes}
                  products={products}
                  priorities={priorities}
                  setCategories={setCategories}
                  setRequestTypes={setRequestTypes}
                  setProducts={setProducts}
                  setPriorities={setPriorities}
                  surveySettings={surveySettings}
                  setSurveySettings={setSurveySettings}
                />
                <StatusManager />
                <TicketClassificationManager />
                <TagManager />
             </div>
           )}
           {activeTab === 'ai-assistant' && hasPermission(Permission.SETTINGS_SYSTEM) && (
             <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                <AiAssistantSettingsContent />
             </div>
           )}
           {activeTab === 'automated-messages' && hasPermission(Permission.SETTINGS_AUTOMATION) && (
             <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                <AutomatedMessagesContent />
             </div>
           )}
           {activeTab === 'integrations' && hasPermission(Permission.SETTINGS_INTEGRATIONS) && (
             <IntegrationsContent />
           )}
           {activeTab === 'email' && hasPermission(Permission.SETTINGS_EMAIL) && (
             <EmailSettingsContent />
           )}
          {activeTab === 'whatsapp' && hasPermission(Permission.WHATSAPP_MANAGE) && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div>
                <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
                  <Globe className="text-[var(--accent-text)]" size={24} /> WhatsApp
                </h3>
                <p className="text-xs text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">Conecte via QR Code ou configure um canal oficial da Meta</p>
              </div>
              <WhatsAppChannelManager />
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
                      <input type="email" defaultValue={currentUser.email ?? ''} placeholder="Sem e-mail cadastrado" className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold text-[var(--text-tertiary)]" disabled />
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
                      defaultValue={currentUser.role === 'Administrador' ? "Lead Product Designer focado em experiências escaláveis." : "Colaborador da equipe SSX Desk."}
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
    </div>
  );
}

function SettingsNavGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 pt-2 first:pt-0">
      <p className="px-4 pb-1.5 text-[9px] font-black uppercase text-[var(--text-tertiary)]/70 tracking-[0.14em]">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SettingsNavLink({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-bold transition-all",
        active
          ? "bg-[var(--accent)] text-white shadow-md shadow-indigo-200"
          : "text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] hover:text-[var(--text-secondary)]"
      )}
    >
      <span className={cn("shrink-0 transition-colors", active ? "text-white" : "text-[var(--text-tertiary)]")}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
