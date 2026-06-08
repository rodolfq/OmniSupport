'use client';

import React from 'react';
import { Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';

export function NotificationSettingsContent() {
  const { 
    notificationSettings,
    updateNotificationSettings,
    playSound 
  } = useApp();

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
                        <select 
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
                        </select>
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
                        <select 
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
                        </select>
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
                <NotificationToggle 
                  label="Novos Chamados" 
                  active={notificationSettings.ticket_new} 
                  onChange={(v) => updateNotificationSettings({ ticket_new: v })} 
                />
                <NotificationToggle 
                  label="Chamados Atribuídos" 
                  active={notificationSettings.ticket_assigned} 
                  onChange={(v) => updateNotificationSettings({ ticket_assigned: v })} 
                />
                <NotificationToggle 
                  label="Atualização de Chamado" 
                  active={notificationSettings.ticket_update} 
                  onChange={(v) => updateNotificationSettings({ ticket_update: v })} 
                />
                <NotificationToggle 
                  label="Chamado Encerrado" 
                  active={notificationSettings.ticket_closed} 
                  onChange={(v) => updateNotificationSettings({ ticket_closed: v })} 
                />
                <NotificationToggle 
                  label="Nova Conversa WhatsApp" 
                  active={notificationSettings.chat_new} 
                  onChange={(v) => updateNotificationSettings({ chat_new: v })} 
                />
                <NotificationToggle 
                  label="Novas Mensagens no Chat" 
                  active={notificationSettings.chat_message} 
                  onChange={(v) => updateNotificationSettings({ chat_message: v })} 
                />
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


