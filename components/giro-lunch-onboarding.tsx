'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Clock3, ListChecks, UtensilsCrossed, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { StyledSelect } from '@/components/styled-select';
import { GIRO_LUNCH_SLOTS, GiroChecklistItem, Permission, UserRole, countLunchOccupancy, lunchSlotsRemaining } from '@/lib/types';
import { getGiroSummary, getGiroConfig, updateGiroRow } from '@/lib/services/giro-client';

/** 30 e 5 minutos antes do horário escolhido — ordem importa: o primeiro da
 * lista cujo limiar já foi cruzado e ainda não foi avisado é o que dispara. */
const REMINDER_MINUTES = [30, 5] as const;

function alertShownKey(userId: string, date: string, minutes: number): string {
  return `omni_giro_lunch_alert_${minutes}:${userId}:${date}`;
}

/** `date` no formato AAAA-MM-DD (mesma data que a API do Giro devolve, já no
 * fuso do Brasil) + `hhmm` no formato HH:MM -> epoch ms local do navegador. */
function todayTimeToEpoch(date: string, hhmm: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

/**
 * Onboarding do Giro: pede pra quem está no Giro de hoje preencher horário de
 * almoço e checklist — e depois disso, avisa (mesmo estilo de pop-up) 30 e 5
 * minutos antes do horário escolhido. Fica de fora inteiramente pra quem não
 * está no Giro hoje (fora do rodízio, ausente, ou sem a permissão de ver o
 * Giro).
 *
 * O pop-up de horário/checklist NÃO é "uma vez só": o gate é o próprio
 * `lunch_time` salvo no servidor, não uma marca em localStorage. Fechar sem
 * preencher é permitido, mas o pop-up volta a aparecer a cada atualização de
 * tela (troca de rota dentro do portal, ou F5) até o horário ficar
 * preenchido — daí reconsultar a cada mudança de `pathname`, não só uma vez
 * por sessão. Depois de salvo, pára de aparecer (mesmo se preenchido pela
 * tela cheia do Giro em vez deste pop-up, já que a consulta é sempre ao
 * servidor). Cada horário tem um número fixo de vagas (GIRO_LUNCH_CAPACITY,
 * em lib/types.ts) — horário lotado aparece desabilitado aqui, e o servidor
 * é quem tem a palavra final (updateRow, em giro-service.ts) contra corrida
 * entre duas pessoas escolhendo a última vaga ao mesmo tempo.
 */
export function GiroLunchOnboarding() {
  const { currentUser, hasPermission } = useApp();
  const pathname = usePathname();

  const isTeam = !!currentUser && [UserRole.ADMIN, UserRole.SUPPORT, UserRole.INTERNAL].includes(currentUser.role as UserRole);
  const eligible = isTeam && (hasPermission(Permission.GIRO_VIEW) || hasPermission(Permission.GIRO_MANAGE));

  const [rowId, setRowId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  // `savedLunchTime` é o que dispara os lembretes — só muda quando o horário
  // é de fato gravado (carga inicial ou "Salvar"), nunca a cada seleção no
  // dropdown. Sem essa separação, escolher um horário e fechar sem salvar já
  // agendaria lembrete pra um horário que o servidor nunca chegou a guardar.
  const [savedLunchTime, setSavedLunchTime] = useState<string>('');
  const [draftLunchTime, setDraftLunchTime] = useState<string>('');
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [checklistItems, setChecklistItems] = useState<GiroChecklistItem[]>([]);
  const [lunchOccupancy, setLunchOccupancy] = useState<Record<string, number>>({});
  const [showSetup, setShowSetup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(null);

  useEffect(() => {
    if (!eligible || !currentUser?.id) return;

    (async () => {
      const [summary, config] = await Promise.all([getGiroSummary(), getGiroConfig()]);
      if ('error' in summary || !summary.myRowId) return;
      const myRow = summary.rows.find(r => r.id === summary.myRowId);
      if (!myRow) return;

      setRowId(myRow.id);
      setDate(summary.date);
      setSavedLunchTime(myRow.lunchTime ?? '');
      setDraftLunchTime(myRow.lunchTime ?? '');
      setChecklist(myRow.checklist ?? {});
      setLunchOccupancy(countLunchOccupancy(summary.rows));
      if (!('error' in config)) setChecklistItems(config.checklistItems.filter(i => i.isActive));

      // Verdade sempre vinda do servidor: some assim que o horário estiver
      // preenchido, volta assim que não estiver — inclusive numa tela nova.
      setShowSetup(!myRow.lunchTime);
    })();
    // Roda de novo a cada troca de rota (usuário pode navegar livremente com
    // o pop-up fechado) — não é possível navegar enquanto ele está aberto,
    // já que o overlay cobre a tela inteira, então nunca atropela edição em
    // andamento.
  }, [eligible, currentUser?.id, pathname]);

  // Lembretes de 30 e 5 minutos antes do almoço — só roda com horário
  // definido. Reavalia a cada 20s: folga suficiente pra não perder o minuto
  // exato do limiar sem ficar reconsultando o relógio à toa.
  useEffect(() => {
    if (!eligible || !currentUser?.id || !date || !savedLunchTime) return;
    const userId = currentUser.id;
    const target = todayTimeToEpoch(date, savedLunchTime);

    const check = () => {
      const now = Date.now();
      if (now >= target) return; // já é hora (ou passou) — não há mais o que avisar
      for (const minutes of REMINDER_MINUTES) {
        if (now < target - minutes * 60 * 1000) continue;
        const key = alertShownKey(userId, date, minutes);
        try {
          if (localStorage.getItem(key)) continue;
          localStorage.setItem(key, '1');
        } catch {
          continue;
        }
        setReminderMinutes(minutes);
        break;
      }
    };

    check();
    const interval = setInterval(check, 20000);
    return () => clearInterval(interval);
  }, [eligible, currentUser?.id, date, savedLunchTime]);

  useEffect(() => {
    if (!showSetup && reminderMinutes === null) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showSetup) setShowSetup(false);
      else setReminderMinutes(null);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showSetup, reminderMinutes]);

  const handleSave = async () => {
    if (!rowId) return;
    setSaving(true);
    const result = await updateGiroRow(rowId, { lunchTime: draftLunchTime || null, checklist });
    setSaving(false);
    if (result.error) {
      toast.error(result.error);
      // A vaga escolhida pode ter sido tomada entre abrir o pop-up e salvar
      // (corrida com outro analista) — busca a ocupação de novo pra tirar o
      // horário da lista antes que a pessoa tente de novo o mesmo que já foi.
      const summary = await getGiroSummary();
      if (!('error' in summary)) setLunchOccupancy(countLunchOccupancy(summary.rows));
      return;
    }
    setSavedLunchTime(draftLunchTime);
    toast.success('Informações do Giro salvas.');
    setShowSetup(false);
  };

  if (!eligible) return null;

  return (
    <>
      <AnimatePresence>
        {showSetup && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[var(--surface-card)] w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden"
            >
              <div className="relative bg-[var(--accent)] p-8 text-white text-center">
                <button
                  onClick={() => setShowSetup(false)}
                  className="absolute top-5 right-5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all"
                  title="Fechar"
                >
                  <X size={16} />
                </button>
                <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                  <UtensilsCrossed size={32} />
                </div>
                <h2 className="text-2xl font-black uppercase tracking-tight">Giro de Hoje</h2>
                <p className="text-indigo-100 dark:text-[var(--accent-soft-text)] text-sm mt-2 font-medium opacity-80">
                  Informe seu horário de almoço e o checklist do dia. Você pode fechar e preencher depois, direto no Giro.
                </p>
              </div>

              <div className="p-10 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1 flex items-center gap-1.5">
                    <Clock3 size={12} /> Horário do almoço
                  </label>
                  <StyledSelect
                    value={draftLunchTime}
                    disabled={saving}
                    onChange={e => setDraftLunchTime(e.target.value)}
                    className="w-full text-sm font-bold"
                  >
                    <option value="">Selecione...</option>
                    {GIRO_LUNCH_SLOTS.map(slot => {
                      const full = lunchSlotsRemaining(slot, lunchOccupancy, savedLunchTime) <= 0;
                      return (
                        <option key={slot} value={slot} disabled={full}>
                          {slot}{full ? ' · Lotado' : ''}
                        </option>
                      );
                    })}
                  </StyledSelect>
                </div>

                {checklistItems.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1 flex items-center gap-1.5">
                      <ListChecks size={12} /> Checklist
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {checklistItems.map(item => {
                        const checked = !!checklist[item.id];
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={saving}
                            onClick={() => setChecklist(c => ({ ...c, [item.id]: !checked }))}
                            className={cn(
                              'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-60',
                              checked
                                ? 'bg-[var(--text-success)]/15 border-[var(--text-success)]/40 text-[var(--text-success)]'
                                : 'border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--accent)]'
                            )}
                          >
                            <span className={cn(
                              'w-4 h-4 rounded-md border flex items-center justify-center shrink-0',
                              checked ? 'bg-[var(--text-success)] border-[var(--text-success)] text-white' : 'border-[var(--border-default)] text-transparent'
                            )}>
                              {checked && <Check size={10} strokeWidth={3} />}
                            </span>
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowSetup(false)}
                    disabled={saving}
                    className="flex-1 py-4 rounded-2xl border border-[var(--border-default)] text-xs font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all disabled:opacity-50"
                  >
                    Fechar
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex-1 bg-[var(--accent)] text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl hover:bg-[var(--accent-hover)] transition-all disabled:opacity-50"
                  >
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reminderMinutes !== null && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[var(--surface-card)] w-full max-w-sm rounded-[3rem] shadow-2xl overflow-hidden"
            >
              <div className="relative bg-[var(--accent)] p-8 text-white text-center">
                <button
                  onClick={() => setReminderMinutes(null)}
                  className="absolute top-5 right-5 p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all"
                  title="Fechar"
                >
                  <X size={16} />
                </button>
                <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                  <UtensilsCrossed size={32} />
                </div>
                <h2 className="text-2xl font-black uppercase tracking-tight">Hora do Almoço</h2>
                <p className="text-indigo-100 dark:text-[var(--accent-soft-text)] text-sm mt-2 font-medium opacity-80">
                  Faltam {reminderMinutes} minutos para o seu almoço, às {savedLunchTime}.
                </p>
              </div>
              <div className="p-8">
                <button
                  onClick={() => setReminderMinutes(null)}
                  className="w-full bg-[var(--accent)] text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl hover:bg-[var(--accent-hover)] transition-all"
                >
                  Entendi
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
