'use client';

import React from 'react';
import { StyledSelect } from '@/components/styled-select';
import { Volume2, Bell, BellOff, CheckCircle2, AlertTriangle, Download, Share, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { UserRole } from '@/lib/types';
import { usePwaInstall } from '@/lib/pwa-install';
import { subscribeToPush, useHasPushSubscription } from '@/hooks/use-push-subscription';

const ALL_NOTIFICATION_TOGGLES = [
  { key: 'ticket_new', label: 'Novos Chamados', audience: 'team' },
  { key: 'ticket_assigned', label: 'Chamados Atribuídos', audience: 'team' },
  { key: 'ticket_update', label: 'Atualização de Chamado', audience: 'all' },
  { key: 'ticket_closed', label: 'Chamado Encerrado', audience: 'all' },
  { key: 'chat_new', label: 'Nova Conversa WhatsApp', audience: 'team' },
  { key: 'chat_message', label: 'Novas Mensagens no Chat', audience: 'all' },
] as const;
const COMPANY_NOTIFICATION_ORDER = ['chat_message', 'ticket_closed', 'ticket_update'];

export function NotificationSettingsContent() {
  const {
    currentUser,
    notificationSettings,
    updateNotificationSettings,
    playSound,
    osNotificationPermission,
    requestOsNotificationPermission
  } = useApp();
  const { canInstall, isIOS, isStandalone, promptInstall } = usePwaInstall();
  const { hasSubscription, checking: checkingSubscription, refresh: refreshSubscription } = useHasPushSubscription();
  const [retrying, setRetrying] = React.useState(false);
  const isCompanyUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);
  const visibleToggles = ALL_NOTIFICATION_TOGGLES
    .filter(toggle => !isCompanyUser || toggle.audience === 'all')
    .sort((a, b) => isCompanyUser ? COMPANY_NOTIFICATION_ORDER.indexOf(a.key) - COMPANY_NOTIFICATION_ORDER.indexOf(b.key) : 0);

  const retrySubscription = async () => {
    setRetrying(true);
    try {
      await subscribeToPush();
      await refreshSubscription();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
       <div className="p-6 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] flex flex-col gap-4">
          <h4 className="text-[10px] font-black uppercase text-[var(--text-primary)] tracking-widest flex items-center gap-2">
            <Bell size={14} className="text-[var(--accent-text)]" /> Notificações Push
          </h4>
          <p className="text-xs text-[var(--text-tertiary)] font-medium -mt-2">
            Recebe um aviso na barra de notificações mesmo com o app fechado ou o celular bloqueado (no computador, funciona com o navegador minimizado). No celular, precisa instalar o app primeiro.
          </p>

          {isIOS && !isStandalone && (
            <div className="flex items-start gap-2 text-xs font-bold text-[var(--text-warning)] bg-[var(--surface-warning)] border border-[var(--border-alert)] rounded-xl px-4 py-3">
              <Share size={16} className="shrink-0 mt-0.5" />
              <span>No iPhone, o Safari só entrega notificações para o app instalado: toque em Compartilhar e depois em &quot;Adicionar à Tela de Início&quot; antes de ativar.</span>
            </div>
          )}

          {!isIOS && canInstall && !isStandalone && (
            <button
              onClick={promptInstall}
              className="self-start flex items-center gap-2 bg-[var(--surface-pill)] border border-[var(--border-default)] hover:border-[var(--accent)]/40 text-[var(--text-secondary)] text-xs font-bold uppercase px-4 py-2.5 rounded-xl transition-colors"
            >
              <Download size={14} /> Instalar App
            </button>
          )}

          {osNotificationPermission === 'unsupported' && (
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-tertiary)]">
              <AlertTriangle size={16} /> Este navegador não suporta notificações do sistema.
            </div>
          )}

          {osNotificationPermission === 'granted' && (
            <>
              <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-success)]">
                <CheckCircle2 size={16} /> Permissão concedida neste navegador.
              </div>

              {!checkingSubscription && hasSubscription === false && (
                <div className="flex items-center justify-between gap-3 text-xs font-bold text-[var(--text-warning)] bg-[var(--surface-warning)] border border-[var(--border-alert)] rounded-xl px-4 py-3">
                  <span className="flex items-center gap-2"><AlertTriangle size={16} className="shrink-0" /> Permissão OK, mas a assinatura push ainda não foi concluída.</span>
                  <button
                    onClick={retrySubscription}
                    disabled={retrying}
                    className="shrink-0 flex items-center gap-1.5 bg-[var(--accent)] text-white px-3 py-1.5 rounded-lg uppercase tracking-wide disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={cn(retrying && "animate-spin")} /> Tentar de novo
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between px-4 py-3 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl">
                 <span className="text-xs font-bold text-[var(--text-secondary)]">Enviar notificações do sistema</span>
                 <button
                   onClick={() => updateNotificationSettings({ osNotificationsEnabled: !notificationSettings.osNotificationsEnabled })}
                   className={cn(
                     "w-10 h-6 rounded-full transition-all flex items-center px-1",
                     notificationSettings.osNotificationsEnabled ? "bg-[var(--text-success)] justify-end" : "bg-[var(--border-default)] justify-start"
                   )}
                 >
                    <div className="w-4 h-4 bg-[var(--surface-card)] rounded-full shadow-sm" />
                 </button>
              </div>
            </>
          )}

          {osNotificationPermission === 'default' && (
            <button
              onClick={requestOsNotificationPermission}
              className="self-start flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold uppercase px-4 py-2.5 rounded-xl transition-colors"
            >
              <Bell size={14} /> Ativar notificações
            </button>
          )}

          {osNotificationPermission === 'denied' && (
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-danger)]">
              <BellOff size={16} /> Bloqueadas pelo navegador. Habilite manualmente nas permissões do site (ícone de cadeado na barra de endereço) e recarregue a página.
            </div>
          )}
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Som dos Alertas */}
          <div className="space-y-6">
            <div className="p-6 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] flex flex-col gap-4">
               <h4 className="text-[10px] font-black uppercase text-[var(--text-primary)] tracking-widest flex items-center gap-2">
                 <Volume2 size={14} className="text-[var(--accent-text)]" /> Sons do Sistema
               </h4>
               
               <div className="space-y-4">
                  <div className="space-y-1">
                     <label className="text-[9px] font-black uppercase text-[var(--text-tertiary)] tracking-widest">Alerta de Sistema</label>
                     <div className="flex gap-2">
                        <StyledSelect 
                          value={notificationSettings.systemSound}
                          onChange={(e) => updateNotificationSettings({ systemSound: e.target.value })}
                          className="flex-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-[var(--accent)]"
                        >
                           <option value="/audio/Alerta.mp3">Alerta (Padrão)</option>
                           <option value="/audio/notificação1.mp3">Notificação 1 (Curta)</option>
                           <option value="/audio/Alerta.mp3">Alerta</option>
                           <option value="/audio/Baseball.mp3">Whistle (Baseball)</option>
                           <option value="/audio/Confirmação.mp3">Confirmação</option>
                           <option value="/audio/Corda Solta.mp3">Guitarra (Corda Solta)</option>
                           <option value="/audio/Formiguinha.mp3">Formiguinha</option>
                           <option value="/audio/Nokia.mp3">Clássico (Nokia)</option>
                           <option value="/audio/Notificação de Mensagem.mp3">Mensagem WhatsApp</option>
                        </StyledSelect>
                        <button 
                          onClick={() => playSound('system')}
                          className="p-2 bg-[var(--accent)]/20 text-[var(--accent-text)] rounded-xl hover:bg-indigo-200 transition-all"
                        >
                           <Volume2 size={16} />
                        </button>
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="text-[9px] font-black uppercase text-[var(--text-tertiary)] tracking-widest">Alerta de Chat</label>
                     <div className="flex gap-2">
                        <StyledSelect 
                          value={notificationSettings.chatSound}
                          onChange={(e) => updateNotificationSettings({ chatSound: e.target.value })}
                          className="flex-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-[var(--accent)]"
                        >
                           <option value="/audio/Notificação de Mensagem.mp3">Mensagem WhatsApp (Padrão)</option>
                           <option value="/audio/Alerta.mp3">Alerta</option>
                           <option value="/audio/Baseball.mp3">Whistle (Baseball)</option>
                           <option value="/audio/Confirmação.mp3">Confirmação</option>
                           <option value="/audio/Corda Solta.mp3">Guitarra (Corda Solta)</option>
                           <option value="/audio/Formiguinha.mp3">Formiguinha</option>
                           <option value="/audio/Nokia.mp3">Clássico (Nokia)</option>
                           <option value="/audio/notificação1.mp3">Notificação 1 (Curta)</option>
                        </StyledSelect>
                        <button 
                          onClick={() => playSound('chat')}
                          className="p-2 bg-[var(--surface-success)] text-[var(--text-success)] rounded-xl hover:bg-emerald-200 transition-all"
                        >
                           <Volume2 size={16} />
                        </button>
                     </div>
                  </div>
               </div>
            </div>
          </div>

          {/* Gatilhos de Notificação */}
          <div className="space-y-4">
             <h4 className="text-[10px] font-black uppercase text-[var(--text-primary)] tracking-widest px-2">Notificações Ativas</h4>
             <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-sm divide-y divide-[var(--border-default)]">
                {visibleToggles.map(toggle => (
                  <NotificationToggle
                    key={toggle.key}
                    label={toggle.label}
                    active={notificationSettings[toggle.key]}
                    onChange={(v) => updateNotificationSettings({ [toggle.key]: v })}
                  />
                ))}
             </div>
          </div>
       </div>
    </div>
  );
}

function NotificationToggle({ label, active, onChange }: { label: string, active: boolean, onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between px-6 py-4 hover:bg-[var(--surface-card)] transition-colors">
       <span className="text-xs font-bold text-[var(--text-secondary)]">{label}</span>
       <button 
         onClick={() => onChange(!active)}
         className={cn(
           "w-10 h-6 rounded-full transition-all flex items-center px-1",
           active ? "bg-[var(--text-success)] justify-end" : "bg-[var(--border-default)] justify-start"
         )}
       >
          <div className="w-4 h-4 bg-[var(--surface-card)] rounded-full shadow-sm" />
       </button>
    </div>
  );
}


