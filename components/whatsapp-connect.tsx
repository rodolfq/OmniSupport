"use client";

import React, { useState, useEffect } from 'react';
import { QrCode, Power, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

interface WhatsAppConnectProps {
  instanceId?: string;
}

export function WhatsAppConnect({ instanceId = 'default' }: WhatsAppConnectProps) {
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [loading, setLoading] = useState(false);
  
  const fetchQR = async () => {
    const res = await fetch(`/api/whatsapp/status?instanceId=${instanceId}`);
    const data = await res.json();
    if (data.qr) {
      setQr(data.qr);
      setStatus(data.status === 'connected' ? 'connected' : 'connecting');
    } else {
      setQr(null);
      setStatus(data.status || 'disconnected');
    }
  };
  
  const connect = async () => {
    setLoading(true);
    setStatus('connecting');
    await fetch('/api/whatsapp/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId })
    });
    fetchQR();
    setLoading(false);
  };
  
  const disconnect = async () => {
    await fetch('/api/whatsapp/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId })
    });
    setQr(null);
    setStatus('disconnected');
  };
  
  useEffect(() => {
    fetchQR();
    const interval = setInterval(fetchQR, 5000);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-black text-slate-800">WhatsApp</h3>
        <button
          onClick={status === 'connected' ? disconnect : connect}
          disabled={loading}
          className={cn(
            "p-2 rounded-xl transition-all",
            status === 'connected' ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
          )}
        >
          {status === 'connected' ? <Power size={18} /> : <RefreshCw size={18} className={loading ? "animate-spin" : ""} />}
        </button>
      </div>
      
      <AnimatePresence>
        {qr && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex flex-col items-center gap-3"
          >
            <QrCode size={24} className="text-slate-400" />
            <img 
              src={qr} 
              alt="WhatsApp QR Code" 
              className="w-48 h-48 border border-slate-200 rounded-xl"
            />
            <p className="text-xs text-slate-500">Escaneie o QR Code com o WhatsApp</p>
          </motion.div>
        )}
        
        {!qr && status === 'connected' && (
          <p className="text-sm text-emerald-600 font-bold">WhatsApp conectado!</p>
        )}
        
        {!qr && status === 'disconnected' && (
          <p className="text-sm text-slate-500">Clique para conectar o WhatsApp</p>
        )}
      </AnimatePresence>
    </div>
  );
}