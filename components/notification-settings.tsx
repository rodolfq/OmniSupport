'use client';

import React from 'react';
import { StyledSelect } from '@/components/styled-select';
import { Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { UserRole } from '@/lib/types';

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
    playSound 
  } = useApp();
  const isCompanyUser = [UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole);
  const visibleToggles = ALL_NOTIFICATION_TOGGLES
    .filter(toggle => !isCompanyUser || toggle.audience === 'all')
    .sort((a, b) => isCompanyUser ? COMPANY_NOTIFICATION_ORDER.indexOf(a.key) - COMPANY_NOTIFICATION_ORDER.indexOf(b.key) : 0);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
       <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Som dos Alertas */}
          <div className="space-y-6">
            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col gap-4">
               <h4 className="text-[10px] font-black uppercase text-slate-800 tracking-widest flex items-center gap-2">
                 <Volume2 size={14} className="text-indigo-600" /> Sons do Sistema
               </h4>
               
               <div className="space-y-4">
                  <div className="space-y-1">
                     <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Alerta de Sistema</label>
                     <div className="flex gap-2">
                        <StyledSelect 
                          value={notificationSettings.systemSound}
                          onChange={(e) => updateNotificationSettings({ systemSound: e.target.value })}
                          className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"
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
                          className="p-2 bg-indigo-100 text-indigo-600 rounded-xl hover:bg-indigo-200 transition-all"
                        >
                           <Volume2 size={16} />
                        </button>
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Alerta de Chat</label>
                     <div className="flex gap-2">
                        <StyledSelect 
                          value={notificationSettings.chatSound}
                          onChange={(e) => updateNotificationSettings({ chatSound: e.target.value })}
                          className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"
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
                          className="p-2 bg-emerald-100 text-emerald-600 rounded-xl hover:bg-emerald-200 transition-all"
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
             <h4 className="text-[10px] font-black uppercase text-slate-800 tracking-widest px-2">Notificações Ativas</h4>
             <div className="bg-white border border-slate-100 rounded-2xl shadow-sm divide-y divide-slate-100">
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
    <div className="flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors">
       <span className="text-xs font-bold text-slate-700">{label}</span>
       <button 
         onClick={() => onChange(!active)}
         className={cn(
           "w-10 h-6 rounded-full transition-all flex items-center px-1",
           active ? "bg-emerald-500 justify-end" : "bg-slate-200 justify-start"
         )}
       >
          <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
       </button>
    </div>
  );
}


