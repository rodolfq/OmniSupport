'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/app/app-context';
import { InternalTicket, Message, User } from '@/lib/types';
import { MessageService } from '@/lib/services/ticket-service';
import { cn } from '@/lib/utils';
import { 
  Paperclip, 
  Star,
  Loader2,
  Send,
  Clock
} from 'lucide-react';
import { RichEditor } from '@/components/rich-editor';
import { toast } from 'sonner';
import { ClientTime } from '@/components/client-time';

interface Attachment {
  id: string;
  name: string;
  type: string;
  url: string;
  size: number;
}

const TEAM_OPTIONS = [
  { value: "Desenvolvimento", label: "Desenvolvimento", color: "bg-indigo-100 text-indigo-700" },
  { value: "Infraestrutura", label: "Infraestrutura", color: "bg-emerald-100 text-emerald-700" },
  { value: "QA / Testes", label: "QA / Testes", color: "bg-amber-100 text-amber-700" },
  { value: "Produto", label: "Produto", color: "bg-purple-100 text-purple-700" },
];

const KANBAN_STATUSES = [
  { value: "Novo", label: "Novo", color: "bg-blue-100 text-blue-700" },
  { value: "Em Atendimento", label: "Em Atendimento", color: "bg-amber-100 text-amber-700" },
  { value: "Pendente", label: "Pendente", color: "bg-slate-100 text-slate-700" },
  { value: "Resolvido", label: "Resolvido", color: "bg-emerald-100 text-emerald-700" },
  { value: "Fechado", label: "Fechado", color: "bg-slate-100 text-slate-500" },
];

interface InternalTicketWithExtras extends InternalTicket {
  uuid: string;
  assigneeName?: string;
  creatorName?: string;
  linkedTicketTitles?: string[];
}

export default function InternalTicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { currentUser, triggerRefresh } = useApp();
  const [ticket, setTicket] = useState<InternalTicketWithExtras | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [previewAttachments, setPreviewAttachments] = useState<Attachment[]>([]);
  const [activeTab, setActiveTab] = useState<'description' | 'history' | 'attachments'>('description');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formTeam, setFormTeam] = useState('Desenvolvimento');
  const [formPriority, setFormPriority] = useState(1);
  const [formAssignee, setFormAssignee] = useState('');
  const [formStatus, setFormStatus] = useState('Novo');
  const [analysts, setAnalysts] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);

  const ticketId = params.id as string;

  const fetchTicket = useCallback(async () => {
    if (!ticketId || !currentUser) return;
    setLoading(true);
    try {
      let query;
      if (ticketId.startsWith('int-')) {
        const num = parseInt(ticketId.replace('int-', ''), 10);
        query = supabase.from('internal_tickets').select('*').eq('internal_ticket_number', num);
      } else {
        query = supabase.from('internal_tickets').select('*').eq('id', ticketId);
      }
      const { data, error } = await query.single();
      if (error) throw error;
      const { data: links } = await supabase.from('ticket_internal_links').select('ticket_id').eq('internal_ticket_id', data.id);
      const { data: regularTickets } = await supabase.from('tickets').select('id, title, public_ticket_number').in('id', (links || []).map(l => l.ticket_id));
      const profileIds = [...new Set([data.assignee_id, data.creator_id].filter(Boolean))];
      const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', profileIds);
      const profileMap = new Map((profiles || []).map(p => [p.id, p.name]));
      setTicket({ ...data, uuid: data.id, id: `int-${data.internal_ticket_number?.toString().padStart(4, '0') || data.id.slice(0, 8)}`, internalTicketNumber: data.internal_ticket_number, title: data.title, teamId: data.team_id, assigneeId: data.assignee_id, priority: data.priority, description: data.description, createdAt: data.created_at, updatedAt: data.updated_at, slaLimit: data.sla_limit, status: data.status || 'Novo', assigneeName: data.assignee_id ? profileMap.get(data.assignee_id) || null : null, creatorName: data.creator_id ? profileMap.get(data.creator_id) || null : null, linkedTicketTitles: regularTickets?.map((t: any) => `#${t.public_ticket_number || t.id.slice(0, 8)}`) || [], });
      setFormTitle(data.title || ''); setFormDescription(data.description || ''); setFormTeam(data.team_id || 'Desenvolvimento'); setFormPriority(data.priority || 1); setFormAssignee(data.assignee_id || ''); setFormStatus(data.status || 'Novo');
    } catch (error) { console.error('Error loading ticket:', error); toast.error('Erro ao carregar ticket'); }
    finally { setLoading(false); }
  }, [ticketId, currentUser]);

  const fetchAnalysts = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('id, name, email, avatar_url, role').or('role.eq.Equipe,role.eq.Administrador');
    if (!error) setAnalysts(data || []);
  }, []);

  const loadMessages = useCallback(async () => {
    if (!ticket?.uuid) return;
    try { const msgs = await MessageService.getByInternalTicket(ticket.uuid); setMessages(msgs); }
    catch (error) { console.error('Error loading messages:', error); }
  }, [ticket?.uuid]);

  useEffect(() => { fetchTicket(); fetchAnalysts(); }, [fetchTicket, fetchAnalysts]);
  useEffect(() => { if (ticket) loadMessages(); }, [ticket, loadMessages]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsUploading(true);
    try {
      for (const file of files) {
        const fileId = Math.random().toString(36).substr(2, 9);
        const fileName = `${Date.now()}-${file.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage.from('attachments').upload(fileName, file);
        if (uploadError) { toast.error(`Erro ao fazer upload de ${file.name}`); continue; }
        const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(uploadData.path);
        setPreviewAttachments(prev => [...prev, { id: fileId, name: file.name, type: file.type, url: publicUrl, size: file.size }]);
      }
    } catch (error) { toast.error('Erro no upload'); }
    finally { setIsUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const handleSendMessage = async () => {
    if ((!input.trim() && previewAttachments.length === 0) || !ticket || !currentUser) return;
    const newMessage: Message = { id: Math.random().toString(36).substr(2, 9), ticketId: ticket.uuid, senderId: currentUser.id, text: input, timestamp: new Date().toISOString(), isVisibleToCustomer: false, type: 'internal', attachments: previewAttachments.length > 0 ? previewAttachments : undefined };
    try { await MessageService.createInternal(newMessage, ticket.uuid); setInput(''); setPreviewAttachments([]); loadMessages(); triggerRefresh(); }
    catch (error) { toast.error('Erro ao enviar mensagem'); }
  };

  const handleUpdateTicket = async () => {
    if (!ticket) return;
    try { const { error } = await supabase.from('internal_tickets').update({ title: formTitle, description: formDescription, team_id: formTeam, priority: formPriority, assignee_id: formAssignee || null, status: formStatus, updated_at: new Date().toISOString() }).eq('id', ticket.uuid); if (error) throw error; toast.success('Ticket atualizado'); triggerRefresh(); }
    catch (error) { toast.error('Erro ao atualizar ticket'); }
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  if (loading || !ticket) {
    return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-amber-500 animate-spin" /></div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header superior */}
      <div className="h-15 bg-white border-b border-slate-200 flex items-center justify-between px-6">
        <div className="text-sm font-bold text-slate-800">#{ticket.id} / <span className="text-amber-600">Chamado Interno</span></div>
        <div className="flex items-center gap-1">
          {KANBAN_STATUSES.map((status) => (
            <button key={status.value} onClick={() => { setFormStatus(status.value); handleUpdateTicket(); }}
              className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-all", formStatus === status.value ? "bg-amber-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
              {status.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { if (currentUser) { setFormAssignee(currentUser.id); handleUpdateTicket(); } }} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 hover:bg-slate-50">ASSUMIR</button>
          <button onClick={() => { setFormStatus('Concluído'); handleUpdateTicket(); }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700">FINALIZAR</button>
          <button onClick={handleUpdateTicket} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-white hover:bg-amber-600">SALVAR</button>
          <button onClick={() => router.push('/internal-tickets')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>

      {/* Título do ticket */}
      <div className="px-6 py-4"><h1 className="text-2xl font-black text-slate-800">{ticket.title}</h1></div>

      {/* Área principal */}
      <div className="flex-1 flex overflow-hidden">
        {/* Conteúdo principal */}
        <div className="flex-[0.73] bg-white p-6 overflow-auto">
          <div className="grid grid-cols-2 gap-6 mb-4">
            <div className="space-y-3">
              <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Equipe</p>
                <StyledSelect value={formTeam} onChange={(e) => setFormTeam(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-800">
                  {TEAM_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </StyledSelect></div>
              <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Responsável</p>
                <StyledSelect value={formAssignee} onChange={(e) => setFormAssignee(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-800">
                  <option value="">Não atribuído</option>
                  {analysts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </StyledSelect></div>
              <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Vencimento</p><p className="text-xs font-bold text-slate-800">---</p></div>
              <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Prioridade</p>
                <div className="flex items-center gap-1">{[1, 2, 3, 4].map(star => (
                  <Star key={star} size={16} className={cn(star <= formPriority ? "fill-amber-400 text-amber-400" : "text-slate-300")} />
                ))}</div></div>
            </div>
            <div className="space-y-3">
              <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Cliente</p>
                <StyledSelect className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-800"><option value="">Selecione uma empresa</option></StyledSelect></div>
              <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Contato</p>
                <StyledSelect className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-800"><option value="">Selecione um contato</option></StyledSelect></div>
              <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Telefone</p><p className="text-xs font-bold text-slate-800">Não informado</p></div>
              <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Colaboradores</p><button className="px-3 py-1 rounded-lg text-xs font-bold border border-slate-200 text-slate-600">+ ADICIONAR</button></div>
              <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Marcadores</p><p className="text-xs font-bold text-slate-800">tags...</p></div>
            </div>
          </div>

          <div className="border-t border-slate-200"></div>

          <div className="flex items-center gap-6 px-6 py-3 border-b border-slate-200">
            {[
              { key: 'description', label: 'DESCRIÇÃO' },
              { key: 'history', label: 'HISTÓRICO', icon: Clock },
              { key: 'attachments', label: 'ANEXOS', icon: Paperclip }
            ].map(tab => {
              const TabIcon = tab.icon;
              return (<button key={tab.key} onClick={() => setActiveTab(tab.key as any)} className={cn("text-[10px] font-bold uppercase pb-2 border-b-2 transition-all flex items-center gap-1", activeTab === tab.key ? "text-amber-600 border-amber-600" : "text-slate-500 border-transparent hover:text-slate-700")}>
                {TabIcon && <TabIcon size={14} />}{tab.label}
              </button>);
            })}
          </div>

          <div className="p-6">
            {activeTab === 'description' && (
              <div><div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-black text-slate-400 uppercase">DESCRIÇÃO DO CHAMADO</h2>
                <button onClick={() => { document.getElementById('title-input')?.focus(); }} className="text-xs font-bold text-amber-600 uppercase hover:underline">EDITAR</button>
              </div>
              <p className="text-sm text-slate-700 min-h-96 whitespace-pre-wrap">{ticket.description || 'Sem descrição'}</p></div>
            )}
            {activeTab === 'history' && (
              <div className="min-h-96">
                {messages.length === 0 ? (
                  <div className="text-center py-12">
                    <Clock size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-xs text-slate-500">Nenhuma atividade registrada</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {messages.map((msg) => (
                      <div key={msg.id} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold text-amber-600">
                            <ClientTime date={msg.timestamp} showDate={true} />
                          </span>
                        </div>
                        <p className="text-sm text-slate-700">{msg.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {activeTab === 'attachments' && (
              <div className="min-h-96">
                {previewAttachments.length === 0 ? (
                  <div className="text-center py-12">
                    <Paperclip size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-xs text-slate-500">Nenhum anexo</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {previewAttachments.map((att) => (
                      <div key={att.id} className="flex items-center gap-2 bg-slate-50 rounded-lg p-3 border border-slate-200">
                        <Paperclip size={14} className="text-slate-500" />
                        <span className="text-sm text-slate-700 truncate">{att.name}</span>
                        <span className="text-[10px] text-slate-400 ml-auto">{(att.size / 1024).toFixed(1)}KB</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Painel lateral direito - UNIFICADO e estendido */}
        <div className="flex-1 border-l border-slate-200 flex flex-col h-full">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center">
            <span className="text-xs font-bold uppercase text-amber-600 border-b-2 border-amber-600 flex items-center gap-1">
              <Clock size={14} /> HISTÓRICO
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-2">
                    <svg className="w-6 h-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l3 3"/></svg>
                  </div>
                  <p className="text-xs text-slate-500">NENHUMA ATIVIDADE REGISTRADA</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id} className="bg-white rounded-lg p-3 border border-slate-200">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold text-amber-600">
                        <ClientTime date={msg.timestamp} showDate={true} />
                      </span>
                    </div>
                    <p className="text-sm text-slate-700">{msg.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-4 border-t border-slate-200">
            <RichEditor content={input} onChange={setInput} placeholder="Digite sua nota interna..." minHeight="80px" />
            <div className="flex justify-between items-center mt-3">
              <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1">
                <Paperclip size={14} /> ANEXAR
              </button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt,.zip,audio/*" onChange={handleFileSelect} className="hidden" />
              <button onClick={handleSendMessage} disabled={!input.trim() && previewAttachments.length === 0}
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1">
                <Send size={14} /> ENVIAR
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
