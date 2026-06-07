'use client';

import React from 'react';
import { Download, File, Image as ImageIcon, Film, Music, ExternalLink } from 'lucide-react';
import { Attachment } from '@/lib/mock-db';
import { cn } from '@/lib/utils';

interface AttachmentGalleryProps {
  attachments: Attachment[];
  title?: string;
}

export function AttachmentGallery({ attachments, title = "Todos os Anexos" }: AttachmentGalleryProps) {
  if (attachments.length === 0) {
    return (
      <div className="text-center py-20 bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-200">
        <File size={40} className="mx-auto text-slate-300 mb-4" />
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Nenhum anexo encontrado</p>
      </div>
    );
  }

  const getIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon size={20} className="text-indigo-500" />;
    if (type.startsWith('video/')) return <Film size={20} className="text-amber-500" />;
    if (type.startsWith('audio/')) return <Music size={20} className="text-emerald-500" />;
    return <File size={20} className="text-slate-500" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest">{title}</h3>
        <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{attachments.length} arquivos</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {attachments.map((file) => {
          const isImage = file.type.startsWith('image/');
          
          return (
            <div 
              key={file.id} 
              className="group relative bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-xl hover:border-indigo-200 transition-all duration-300"
            >
              {isImage ? (
                <div className="aspect-video w-full bg-slate-100 relative overflow-hidden">
                  <img 
                    src={file.url} 
                    alt={file.name} 
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                     <a 
                       href={file.url} 
                       target="_blank" 
                       rel="noopener noreferrer"
                       className="p-2 bg-white rounded-full text-slate-900 shadow-xl hover:scale-110 transition-all font-black text-[10px]"
                     >
                       <ExternalLink size={14} />
                     </a>
                  </div>
                </div>
              ) : (
                <div className="aspect-video w-full bg-slate-50 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center">
                    {getIcon(file.type)}
                  </div>
                </div>
              )}
              
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-800 truncate" title={file.name}>{file.name}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-tighter">
                      {file.type.split('/')[1] || 'FILE'} â€¢ {formatSize(file.size)}
                    </p>
                  </div>
                  <a 
                    href={file.url} 
                    download={file.name}
                    className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-all shrink-0"
                    title="Download"
                  >
                    <Download size={14} />
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
