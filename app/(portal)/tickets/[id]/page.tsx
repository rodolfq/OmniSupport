'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Ticket, Message } from '@/lib/types';
import { getTicketById, updateTicket, fetchMessages, createMessage } from '@/lib/tickets';
import { useApp } from '@/app/app-context';
import { Send, ChevronLeft, Lock, Paperclip, Eye, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { currentUser } = useApp();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [isUploading, setIsInternalUploading] = useState(false);
  const [previewAttachments, setPreviewAttachments] = useState<any[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!params.id) return;
    async function loadTicket() {
      try {
        const t = await getTicketById(params.id as string);
        if (t) {
          setTicket(t);
          const msgs = await fetchMessages(t.id);
          setMessages(msgs);
        }
      } catch (e) {
        console.error("Error loading ticket detail:", e);
      }
    }
    loadTicket();
  }, [params.id]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !ticket) return;

    setIsInternalUploading(true);
    try {
      const file = files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${ticket.id}/${crypto.randomUUID()}.${fileExt}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('attachments')
        .getPublicUrl(fileName);

      const attachment = {
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        url: publicUrlData.publicUrl,
        size: file.size
      };

      setPreviewAttachments([...previewAttachments, attachment]);
      toast.success('Arquivo anexado com sucesso!');
    } catch (error) {
      console.error('Falha no upload:', error);
      toast.error('Erro ao subir arquivo. Verifique sua conexão.');
    } finally {
      setIsInternalUploading(false);
    }
  };

  const handleSendMessage = async () => {
    if ((!input.trim() && previewAttachments.length === 0) || !ticket || !currentUser) return;
    const newMessage: Message = {
      id: crypto.randomUUID(),
      ticketId: ticket.id,
      senderId: currentUser.id,
      text: input,
      timestamp: new Date().toISOString(),
      isVisibleToCustomer: !isInternal,
      type: isInternal ? 'internal' : 'text',
      attachments: previewAttachments
    };
    try {
      await createMessage(newMessage);
      setMessages([...messages, newMessage]);
      setInput('');
      setPreviewAttachments([]);
      toast.success('Mensagem enviada!');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao enviar mensagem.');
    }
  };

  const handlePriorityUpdate = async (newPriority: number) => {
    if (!ticket) return;
    try {
      const updatedTicket: Ticket = {
        ...ticket,
        priority: newPriority.toString(),
        updatedAt: new Date().toISOString()
      };
      await updateTicket(updatedTicket);
      setTicket(updatedTicket);
      toast.success('Prioridade atualizada!');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao atualizar prioridade.');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  if (!ticket) return <div className="p-8">Carregando...</div>;

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-[var(--surface-pill)] rounded-xl transition-all text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <ChevronLeft size={24} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">{ticket.title}</h1>
              <span className="px-2 py-0.5 rounded-md bg-[var(--accent)]/10 text-[var(--accent-text)] text-[10px] font-semibold uppercase tracking-tighter">{ticket.status}</span>
              <div className="flex items-center gap-1 ml-2 bg-[var(--surface-pill)] px-2 py-1 rounded-lg">
                {[1, 2, 3].map((star) => {
                  const currentPriority = parseInt(ticket.priority as string) || 0;
                  return (
                    <button
                      key={star}
                      onClick={() => handlePriorityUpdate(star === currentPriority && star === 1 ? 0 : star)}
                      className="focus:outline-none transition-transform hover:scale-110"
                    >
                      <Star
                        size={16}
                        className={cn(
                          "transition-colors",
                          star <= currentPriority 
                            ? "fill-amber-400 text-[var(--text-warning)]" 
                            : "text-slate-300"
                        )}
                      />
                    </button>
                  );
                })}
                <span className="text-[10px] font-bold text-[var(--text-tertiary)] ml-1 uppercase">Prioridade</span>
              </div>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">Ticket: #{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)} • Criado em {formatDate(ticket.createdAt)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)] px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-[var(--surface-card)]">Transferir</button>
          <button className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md hover:bg-slate-800 transition-all flex items-center gap-2">
             Resolver Chamado
          </button>
        </div>
      </div>
      <div className="flex-1 flex gap-8 overflow-hidden">
        <div className="flex-1 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--surface-card)]/50">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-[var(--accent)]/20 rounded-xl flex items-center justify-center text-[var(--accent-text)] font-bold text-sm uppercase">
                {ticket.title.charAt(0)}
              </div>
              <div>
                <h2 className="text-sm font-bold text-[var(--text-primary)]">{ticket.title}</h2>
                <span className="text-[10px] text-[var(--text-success)] font-bold uppercase tracking-widest flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-[var(--text-success)] rounded-full"></span>
                  Conectado
                </span>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[var(--surface-card)]/30">
            {messages.map(m => (
              <div key={m.id} className={cn("flex gap-3", m.senderId === currentUser?.id ? "flex-row-reverse" : "flex-row")}>
                <div className={cn(
                  "w-8 h-8 rounded-full text-[10px] flex items-center justify-center flex-shrink-0 font-bold uppercase",
                  m.senderId === currentUser?.id ? "bg-slate-800 text-white" : "bg-[var(--accent)]/20 text-[var(--accent-text)]"
                )}>
                  {m.senderId === currentUser?.id ? 'AS' : 'CL'}
                </div>
                <div className={cn(
                  "max-w-[70%] p-4 rounded-2xl shadow-sm",
                  m.senderId === currentUser?.id 
                    ? "bg-[var(--accent)] text-white rounded-tr-none" 
                    : "bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)] rounded-tl-none",
                  m.type === 'internal' && "bg-[var(--surface-warning)] border border-[var(--border-alert)] border-dashed text-[var(--text-warning)]"
                )}>
                  {m.type === 'internal' && <div className="text-[10px] uppercase font-semibold text-[var(--text-warning)] mb-1 flex items-center gap-1"><Lock size={10} /> Nota Interna</div>}
                  <p className="text-sm leading-relaxed">{m.text}</p>
                  
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {m.attachments.map((att: any) => (
                        <a 
                          key={att.id} 
                          href={att.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className={cn(
                            "flex items-center gap-2 p-2 rounded-lg text-xs font-bold transition-colors",
                            m.senderId === currentUser?.id 
                              ? "bg-[var(--accent)]/50 hover:bg-[var(--accent)] text-white" 
                              : "bg-[var(--surface-pill)] hover:bg-[var(--border-default)] text-[var(--text-secondary)]"
                          )}
                        >
                          <Paperclip size={14} />
                          <span className="truncate max-w-[150px]">{att.name}</span>
                        </a>
                      ))}
                    </div>
                  )}

                  <span className={cn("text-[9px] mt-2 block font-bold uppercase tracking-widest", m.senderId === currentUser?.id ? "text-indigo-200" : "text-[var(--text-tertiary)]")}>
                    {formatDate(m.timestamp)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="p-6 border-t border-[var(--border-default)] bg-[var(--surface-card)]">
            <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl p-2 flex flex-col gap-2">
              <div className="flex gap-2 px-2 py-1">
                <button onClick={() => setIsInternal(false)} className={cn("text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded", !isInternal ? "text-[var(--accent-text)] bg-[var(--accent)]/10" : "text-[var(--text-tertiary)]")}>Resposta Pública</button>
                <button onClick={() => setIsInternal(true)} className={cn("text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded", isInternal ? "text-[var(--text-warning)] bg-[var(--surface-warning)]" : "text-[var(--text-tertiary)]")}>Nota Interna</button>
              </div>
              <textarea 
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                placeholder={isInternal ? "Escreva uma nota interna visível apenas para a equipe..." : "Digite sua resposta para o cliente..."}
                className="bg-transparent w-full p-2 text-sm focus:outline-none resize-none min-h-[80px]" 
              />
              
              {previewAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 p-2 border-t border-[var(--border-default)]">
                  {previewAttachments.map(att => (
                    <div key={att.id} className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-sm text-[10px] font-bold text-[var(--text-secondary)] animate-in fade-in zoom-in duration-200">
                      <Paperclip size={12} className="text-[var(--accent-text)]" />
                      <span className="max-w-[100px] truncate">{att.name}</span>
                      <button onClick={() => setPreviewAttachments(prev => prev.filter(a => a.id !== att.id))} className="text-[var(--text-danger)] hover:text-[var(--text-danger)] ml-1">×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center border-t border-[var(--border-default)] pt-2 px-1">
                <div className="flex gap-3 text-[var(--text-tertiary)]">
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileSelect} 
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className={cn("transition-colors", isUploading ? "text-[var(--accent-text)] animate-pulse" : "hover:text-[var(--text-secondary)]")}
                  >
                    <Paperclip size={18} />
                  </button>
                  <Eye size={18} className="cursor-pointer hover:text-[var(--text-secondary)]" />
                </div>
                <button onClick={handleSendMessage} className="bg-[var(--accent)] text-white px-6 py-1.5 rounded-lg text-sm font-bold shadow-md hover:bg-[var(--accent-hover)] transition-colors">
                  {isUploading ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <aside className="w-72 flex flex-col gap-6">
          <div className="bg-[var(--surface-card)] p-6 rounded-2xl border border-[var(--border-default)] shadow-sm overflow-hidden">
             <h4 className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest mb-4">Dados do Cliente</h4>
             <div className="space-y-4">
                <div className="bg-[var(--surface-card)] p-4 rounded-xl border border-[var(--border-default)]">
                  <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Email</p>
                  <p className="text-xs font-bold text-[var(--text-primary)] break-all">cliente@example.com</p>
                </div>
                <div className="bg-[var(--surface-card)] p-4 rounded-xl border border-[var(--border-default)]">
                  <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase mb-1">Empresa</p>
                  <p className="text-xs font-bold text-[var(--text-primary)]">Logística S.A.</p>
                </div>
                <div className="bg-[var(--accent)] p-4 rounded-xl text-white shadow-lg shadow-indigo-100">
                  <p className="text-[10px] opacity-70 uppercase font-semibold mb-1">Nível de Suporte</p>
                  <p className="text-lg font-black italic tracking-tighter">Premium Enterprise</p>
                </div>
             </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
