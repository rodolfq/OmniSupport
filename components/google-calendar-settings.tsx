'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarDays, Link2, Unlink, Loader2 } from 'lucide-react';
import {
  getGoogleCalendarStatus,
  googleCalendarConnectUrl,
  disconnectGoogleCalendar,
  GoogleCalendarStatus
} from '@/lib/services/google-calendar-client';

/**
 * Card "vincular Google Agenda" — mora dentro de Configurações > Notificações
 * (components/notification-settings.tsx), porque é a origem do lembrete de
 * evento (ver components/calendar-event-reminder.tsx), não uma tela à parte.
 */
export function GoogleCalendarSettings() {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getGoogleCalendarStatus();
    if (!('error' in result)) setStatus(result);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Volta do fluxo OAuth: o callback (app/api/integrations/google-calendar/
  // callback/route.ts) redireciona pra cá com ?google_calendar=connected|error
  // na URL. Mostra o resultado uma vez só e limpa o parâmetro, pra um F5 na
  // tela não repetir o toast.
  useEffect(() => {
    const result = searchParams.get('google_calendar');
    if (!result) return;

    if (result === 'connected') {
      toast.success('Google Agenda vinculada com sucesso.');
      load();
    } else {
      const detail = searchParams.get('google_calendar_error');
      toast.error(`Não foi possível vincular o Google Agenda${detail ? `: ${detail}` : '.'}`);
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete('google_calendar');
    params.delete('google_calendar_error');
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname);
    // Só na chegada — não precisa reagir a searchParams inteiro de novo.
  }, [searchParams.get('google_calendar')]);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    const result = await disconnectGoogleCalendar();
    setDisconnecting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Google Agenda desvinculada.');
    load();
  };

  return (
    <div className="p-6 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] flex flex-col gap-4">
      <h4 className="text-[10px] font-black uppercase text-[var(--text-primary)] tracking-widest flex items-center gap-2">
        <CalendarDays size={14} className="text-[var(--accent-text)]" /> Google Agenda
      </h4>
      <p className="text-xs text-[var(--text-tertiary)] font-medium -mt-2">
        Vincule sua conta do Google para receber um lembrete aqui no SSX Desk pouco antes de cada evento da sua agenda. Só leitura — o SSX Desk nunca cria ou altera nada na sua agenda.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-tertiary)]">
          <Loader2 size={14} className="animate-spin" /> Verificando...
        </div>
      ) : status?.connected ? (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[var(--surface-success)] border border-[var(--text-success)]/20 rounded-xl">
          <span className="text-xs font-bold text-[var(--text-success)] flex items-center gap-2 min-w-0">
            <Link2 size={14} className="shrink-0" />
            <span className="truncate">Conectado{status.email ? ` como ${status.email}` : ''}</span>
          </span>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="shrink-0 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--text-danger)] hover:opacity-80 transition-opacity disabled:opacity-50"
          >
            {disconnecting ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />} Desvincular
          </button>
        </div>
      ) : (
        <a
          href={googleCalendarConnectUrl()}
          className="self-start flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-bold uppercase px-4 py-2.5 rounded-xl transition-colors"
        >
          <CalendarDays size={14} /> Vincular Google Agenda
        </a>
      )}
    </div>
  );
}
