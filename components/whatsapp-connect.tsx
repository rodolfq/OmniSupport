"use client";

import React, { useState, useEffect, useRef } from 'react';
import { QrCode, Power, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

interface WhatsAppConnectProps {
  instanceId?: string;
}

const DISCONNECTED_CONFIRM_POLLS = 3;

export function WhatsAppConnect({ instanceId = 'default' }: WhatsAppConnectProps) {
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [loading, setLoading] = useState(false);
  const statusRef = useRef(status);
  const disconnectedPollsRef = useRef(0);
  const pollInFlightRef = useRef(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  
  const fetchQR = async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;

    try {
      const res = await fetch(`/api/whatsapp/status?instanceId=${instanceId}`);
      const data = await res.json();

      if (data.connected || data.status === 'connected') {
        disconnectedPollsRef.current = 0;
        setQr(null);
        setStatus('connected');
        return;
      }
      if (data.qr) {
        disconnectedPollsRef.current = 0;
        setQr(data.qr);
        setStatus('connecting');
        return;
      }
      if (data.status === 'connecting') {
        disconnectedPollsRef.current = 0;
        setQr(null);
        if (statusRef.current !== 'connected') {
          setStatus('connecting');
        }
        return;
      }

      disconnectedPollsRef.current += 1;
      if (
        statusRef.current === 'connected' &&
        disconnectedPollsRef.current < DISCONNECTED_CONFIRM_POLLS
      ) {
        return;
      }

      setQr(null);
      setStatus('disconnected');
    } finally {
      pollInFlightRef.current = false;
    }
  };
  
  const connect = async () => {
    setLoading(true);
    setStatus('connecting');
    disconnectedPollsRef.current = 0;
    await fetch('/api/whatsapp/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId })
    });

    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const res = await fetch(`/api/whatsapp/status?instanceId=${instanceId}`);
      const data = await res.json();
      if (data.qr) {
        setQr(data.qr);
        setStatus('connecting');
        setLoading(false);
        return;
      }
      if (data.connected || data.status === 'connected') {
        setQr(null);
        setStatus('connected');
        disconnectedPollsRef.current = 0;
        setLoading(false);
        return;
      }
    }

    setLoading(false);
  };
  
  const disconnect = async () => {
    await fetch('/api/whatsapp/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId })
    });
    disconnectedPollsRef.current = 0;
    setQr(null);
    setStatus('disconnected');
  };
  
  useEffect(() => {
    fetchQR();
    const interval = setInterval(fetchQR, 10000);
    return () => clearInterval(interval);
  }, [instanceId]);
  
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-black text-[var(--text-primary)]">WhatsApp</h3>
        <button
          onClick={status === 'connected' ? disconnect : connect}
          disabled={loading}
          className={cn(
            "p-2 rounded-xl transition-all",
            status === 'connected' ? "bg-[var(--surface-danger)] text-[var(--text-danger)]" : "bg-[var(--surface-success)] text-[var(--text-success)]"
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
            <QrCode size={24} className="text-[var(--text-tertiary)]" />
            <img
              src={qr}
              alt="WhatsApp QR Code"
              className="w-48 h-48 border border-[var(--border-default)] rounded-xl"
            />
            <p className="text-xs text-[var(--text-tertiary)]">Escaneie o QR Code com o WhatsApp</p>
          </motion.div>
        )}

        {!qr && status === 'connected' && (
          <p className="text-sm text-[var(--text-success)] font-bold">WhatsApp conectado!</p>
        )}

        {!qr && status === 'connecting' && (
          <p className="text-sm text-[var(--text-warning)] font-bold">
            {loading ? 'Gerando QR Code...' : 'Conectando...'}
          </p>
        )}

        {!qr && status === 'disconnected' && (
          <p className="text-sm text-[var(--text-tertiary)]">Clique para conectar o WhatsApp</p>
        )}
      </AnimatePresence>
    </div>
  );
}