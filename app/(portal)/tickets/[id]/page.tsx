'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Ticket, Message, MockDB } from '@/lib/mock-db';
import { useApp } from '@/app/app-context';
import { Send, ChevronLeft, Lock, Paperclip, Eye, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

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
    const t = MockDB.getTickets().find(x => x.id === params.id);
    if (t) {
      setTicket(t);
      setMessages(MockDB.getMessages(t.id));
    }
  }, [params.id]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsInternalUploading(true);
    try {
      const file = files[0];
      const attachment = await MockDB.uploadFile(file);
      setPreviewAttachments([...previewAttachments, attachment]);
    } catch (error) {
      console.error('Falha no upload:', error);
      alert('Erro ao subir arquivo. Verifique sua conexão.');
    } finally {
      setIsInternalUploading(false);
    }
  };

  const handleSendMessage = () => {
    if ((!input.trim() && previewAttachments.length === 0) || !ticket || !currentUser) return;
    const newMessage: Message = {
      id: Math.random().toString(36).substr(2, 9),
      ticketId: ticket.id,
      senderId: currentUser.id,
      text: input,
      timestamp: new Date().toISOString(),
      isVisibleToCustomer: !isInternal,
      type: isInternal ? 'internal' : 'text',
      attachments: previewAttachments
    };
    MockDB.saveMessage(newMessage);
    setMessages([...messages, newMessage]);
    setInput('');
    setPreviewAttachments([]);
  };

  const handlePriorityUpdate = (newPriority: number) => {
    if (!ticket) return;
    const updatedTicket: Ticket = {
      ...ticket,
      priority: newPriority.toString(),
      updatedAt: new Date().toISOString()
    };
    MockDB.saveTicket(updatedTicket);
    setTicket(updatedTicket);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  if (!ticket) return <div className="p-8">Carregando...</div>;

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-xl transition-all text-slate-400 hover:text-slate-900">
            <ChevronLeft size={24} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-slate-800 tracking-tight">{ticket.title}</h1>
              <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 text-[10px] font-black uppercase tracking-tighter">{ticket.status}</span>
              <div className="flex items-center gap-1 ml-2 bg-slate-100 px-2 py-1 rounded-lg">
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
                            ? "fill-amber-400 text-amber-400" 
                            : "text-slate-300"
                        )}
                      />
                    </button>
                  );
                })}
                <span className="text-[10px] font-bold text-slate-500 ml-1 uppercase">Prioridade</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Ticket: #{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)} • Criado em {formatDate(ticket.createdAt)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-slate-50">Transferir</button>
          <button className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-md hover:bg-slate-800 transition-all flex items-center gap-2">
             Resolver Chamado
          </button>
        </div>
      </div>
      <div className="flex-1 flex gap-8 overflow-hidden">
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-700 font-bold text-sm uppercase">
                {ticket.title.charAt(0)}
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-800">{ticket.title}</h2>
                <span className="text-[10px] text-green-500 font-bold uppercase tracking-widest flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                  Conectado
                </span>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30">
            {messages.map(m => (
              <div key={m.id} className={cn("flex gap-3", m.senderId === currentUser?.id ? "flex-row-reverse" : "flex-row")}>
                <div className={cn(
                  "w-8 h-8 rounded-full text-[10px] flex items-center justify-center flex-shrink-0 font-bold uppercase",
                  m.senderId === currentUser?.id ? "bg-slate-800 text-white" : "bg-indigo-100 text-indigo-700"
                )}>
                  {m.senderId === currentUser?.id ? 'AS' : 'CL'}
                </div>
                <div className={cn(
                  "max-w-[70%] p-4 rounded-2xl shadow-sm",
                  m.senderId === currentUser?.id 
                    ? "bg-indigo-600 text-white rounded-tr-none" 
                    : "bg-white border border-slate-200 text-slate-700 rounded-tl-none",
                  m.type === 'internal' && "bg-amber-50 border border-amber-200 border-dashed text-amber-900"
                )}>
                  {m.type === 'internal' && <div className="text-[10px] uppercase font-black text-amber-600 mb-1 flex items-center gap-1"><Lock size={10} /> Nota Interna</div>}
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
                              ? "bg-indigo-500/50 hover:bg-indigo-500 text-white" 
                              : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                          )}
                        >
                          <Paperclip size={14} />
                          <span className="truncate max-w-[150px]">{att.name}</span>
                        </a>
                      ))}
                    </div>
                  )}

                  <span className={cn("text-[9px] mt-2 block font-bold uppercase tracking-widest", m.senderId === currentUser?.id ? "text-indigo-200" : "text-slate-400")}>
                    {formatDate(m.timestamp)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="p-6 border-t border-slate-200 bg-white">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-2 flex flex-col gap-2">
              <div className="flex gap-2 px-2 py-1">
                <button onClick={() => setIsInternal(false)} className={cn("text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded", !isInternal ? "text-indigo-600 bg-indigo-50" : "text-slate-400")}>Resposta Pública</button>
                <button onClick={() => setIsInternal(true)} className={cn("text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded", isInternal ? "text-amber-600 bg-amber-50" : "text-slate-400")}>Nota Interna</button>
              </div>
              <textarea 
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                placeholder={isInternal ? "Escreva uma nota interna visível apenas para a equipe..." : "Digite sua resposta para o cliente..."}
                className="bg-transparent w-full p-2 text-sm focus:outline-none resize-none min-h-[80px]" 
              />
              
              {previewAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 p-2 border-t border-slate-100">
                  {previewAttachments.map(att => (
                    <div key={att.id} className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-sm text-[10px] font-bold text-slate-600 animate-in fade-in zoom-in duration-200">
                      <Paperclip size={12} className="text-indigo-500" />
                      <span className="max-w-[100px] truncate">{att.name}</span>
                      <button onClick={() => setPreviewAttachments(prev => prev.filter(a => a.id !== att.id))} className="text-red-400 hover:text-red-600 ml-1">×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center border-t border-slate-200 pt-2 px-1">
                <div className="flex gap-3 text-slate-400">
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileSelect} 
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className={cn("transition-colors", isUploading ? "text-indigo-500 animate-pulse" : "hover:text-slate-600")}
                  >
                    <Paperclip size={18} />
                  </button>
                  <Eye size={18} className="cursor-pointer hover:text-slate-600" />
                </div>
                <button onClick={handleSendMessage} className="bg-indigo-600 text-white px-6 py-1.5 rounded-lg text-sm font-bold shadow-md hover:bg-indigo-700 transition-colors">
                  {isUploading ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <aside className="w-72 flex flex-col gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
             <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Dados do Cliente</h4>
             <div className="space-y-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Email</p>
                  <p className="text-xs font-bold text-slate-800 break-all">cliente@example.com</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Empresa</p>
                  <p className="text-xs font-bold text-slate-800">Logística S.A.</p>
                </div>
                <div className="bg-indigo-600 p-4 rounded-xl text-white shadow-lg shadow-indigo-100">
                  <p className="text-[10px] opacity-70 uppercase font-black mb-1">Nível de Suporte</p>
                  <p className="text-lg font-black italic tracking-tighter">Premium Enterprise</p>
                </div>
             </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
