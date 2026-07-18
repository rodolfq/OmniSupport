'use client';

import React from 'react';
import { RotateCcw, Eye, EyeOff, Save, Clock, MessageCircleMore } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { StyledSelect } from '@/components/styled-select';
import { AUTOMATION_EVENTS, AUTOMATION_VARIABLES, renderTemplate, AutomationEventDef } from '@/lib/automation-events';
import { AutomationSetting } from '@/lib/types';

interface EditState {
  enabled: boolean;
  message: string;
  delayMinutes: number;
  firstOccurrenceOnly: boolean;
  triggerStatus: string;
  saving: boolean;
  showPreview: boolean;
}

const PREVIEW_CONTEXT: Record<string, string> = Object.fromEntries(
  AUTOMATION_VARIABLES.map(v => [v.key, v.sample])
);

function toEditState(def: AutomationEventDef, saved?: AutomationSetting): EditState {
  return {
    enabled: saved?.enabled ?? true,
    message: saved?.message ?? def.defaultMessage,
    delayMinutes: saved?.delay_minutes ?? 0,
    firstOccurrenceOnly: saved?.first_occurrence_only ?? false,
    triggerStatus: saved?.trigger_status ?? def.defaultTriggerStatus ?? '',
    saving: false,
    showPreview: false
  };
}

// Aproximação simples da formatação do WhatsApp para a prévia (negrito
// *x*, itálico _x_, riscado ~x~). Não pretende ser um parser completo.
function renderWhatsAppFormatting(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~([^~\n]+)~/g, '<del>$1</del>')
    .replace(/\n/g, '<br/>');
}

export function AutomatedMessagesContent() {
  const [statuses, setStatuses] = React.useState<{ id: string; label: string }[]>([]);
  const [editState, setEditState] = React.useState<Record<string, EditState>>(
    Object.fromEntries(AUTOMATION_EVENTS.map(def => [def.key, toEditState(def)]))
  );
  const [loaded, setLoaded] = React.useState(false);
  const [focusedEventKey, setFocusedEventKey] = React.useState<string | null>(null);
  const textareaRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({});

  React.useEffect(() => {
    const load = async () => {
      try {
        const [settingsRes, statusesRes] = await Promise.all([
          fetch('/api/config?type=automation-settings'),
          fetch('/api/config?type=statuses')
        ]);
        const settings: AutomationSetting[] = await settingsRes.json();
        const statusList = await statusesRes.json();
        setStatuses(statusList || []);

        const byKey = new Map(settings.map(s => [s.event_key, s]));
        setEditState(
          Object.fromEntries(AUTOMATION_EVENTS.map(def => [def.key, toEditState(def, byKey.get(def.key))]))
        );
      } catch (err) {
        console.error('Erro ao carregar mensagens automáticas:', err);
        toast.error('Erro ao carregar mensagens automáticas');
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, []);

  const patchEvent = (key: string, patch: Partial<EditState>) => {
    setEditState(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const insertVariable = (varKey: string) => {
    const key = focusedEventKey || AUTOMATION_EVENTS[0].key;
    const textarea = textareaRefs.current[key];
    const current = editState[key];
    if (!current) return;
    const token = `{{${varKey}}}`;

    if (textarea) {
      const start = textarea.selectionStart ?? current.message.length;
      const end = textarea.selectionEnd ?? current.message.length;
      const next = current.message.slice(0, start) + token + current.message.slice(end);
      patchEvent(key, { message: next });
      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + token.length;
        textarea.setSelectionRange(cursor, cursor);
      });
    } else {
      patchEvent(key, { message: current.message + token });
    }
  };

  const restoreDefault = (def: AutomationEventDef) => {
    patchEvent(def.key, { message: def.defaultMessage });
    toast.success('Texto padrão restaurado. Clique em Salvar para confirmar.');
  };

  const saveEvent = async (def: AutomationEventDef) => {
    const state = editState[def.key];
    patchEvent(def.key, { saving: true });
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'automation-settings',
          eventKey: def.key,
          settings: {
            enabled: state.enabled,
            message: state.message,
            delayMinutes: state.delayMinutes,
            firstOccurrenceOnly: state.firstOccurrenceOnly,
            triggerStatus: def.statusConfigurable ? (state.triggerStatus || null) : null
          }
        })
      });
      if (!res.ok) throw new Error('Falha ao salvar');
      toast.success(`"${def.label}" salvo com sucesso`);
    } catch (err) {
      console.error(err);
      toast.error(`Erro ao salvar "${def.label}"`);
    } finally {
      patchEvent(def.key, { saving: false });
    }
  };

  if (!loaded) {
    return <div className="text-sm text-[var(--text-tertiary)] p-8">Carregando mensagens automáticas...</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 items-start">
      <div className="space-y-6">
        {AUTOMATION_EVENTS.map(def => {
          const state = editState[def.key];
          if (!state) return null;
          const preview = renderTemplate(state.message, PREVIEW_CONTEXT);

          return (
            <div key={def.key} className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight">{def.label}</h4>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">{def.description}</p>
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] cursor-pointer select-none shrink-0">
                  <input
                    type="checkbox"
                    checked={state.enabled}
                    onChange={(e) => patchEvent(def.key, { enabled: e.target.checked })}
                    className="w-4 h-4 accent-[var(--accent)]"
                  />
                  {state.enabled ? 'Ativo' : 'Inativo'}
                </label>
              </div>

              {def.statusConfigurable && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Status que dispara este evento</span>
                  <StyledSelect
                    value={state.triggerStatus}
                    onChange={(e) => patchEvent(def.key, { triggerStatus: e.target.value })}
                    className="text-xs font-bold text-[var(--text-secondary)] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-2 py-1 cursor-pointer"
                  >
                    {statuses.map(s => (
                      <option key={s.id} value={s.label}>{s.label}</option>
                    ))}
                  </StyledSelect>
                </div>
              )}

              <textarea
                ref={(el) => { textareaRefs.current[def.key] = el; }}
                value={state.message}
                onFocus={() => setFocusedEventKey(def.key)}
                onChange={(e) => patchEvent(def.key, { message: e.target.value })}
                rows={8}
                className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm resize-y font-mono"
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => restoreDefault(def)}
                  className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] px-3 py-1.5 rounded-lg border border-[var(--border-default)] transition-colors"
                >
                  <RotateCcw size={12} /> Restaurar padrão
                </button>
                <button
                  onClick={() => patchEvent(def.key, { showPreview: !state.showPreview })}
                  className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-[var(--accent-text)] hover:bg-[var(--accent)]/10 px-3 py-1.5 rounded-lg border border-[var(--accent)]/20 transition-colors"
                >
                  {state.showPreview ? <EyeOff size={12} /> : <Eye size={12} />} {state.showPreview ? 'Ocultar prévia' : 'Visualizar'}
                </button>
              </div>

              {state.showPreview && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] bg-[#dcf8c6] text-[#111b21] rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed shadow-sm whitespace-pre-wrap"
                       dangerouslySetInnerHTML={{ __html: renderWhatsAppFormatting(preview) }} />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[var(--border-default)]">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-[var(--text-tertiary)]" />
                    <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] cursor-pointer">
                      <input
                        type="radio"
                        name={`delay-${def.key}`}
                        checked={state.delayMinutes === 0}
                        onChange={() => patchEvent(def.key, { delayMinutes: 0 })}
                      />
                      Imediato
                    </label>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] cursor-pointer">
                      <input
                        type="radio"
                        name={`delay-${def.key}`}
                        checked={state.delayMinutes > 0}
                        onChange={() => patchEvent(def.key, { delayMinutes: state.delayMinutes > 0 ? state.delayMinutes : 5 })}
                      />
                      Após
                    </label>
                    <input
                      type="number"
                      min={1}
                      disabled={state.delayMinutes === 0}
                      value={state.delayMinutes || ''}
                      onChange={(e) => patchEvent(def.key, { delayMinutes: Math.max(1, parseInt(e.target.value) || 1) })}
                      className="w-16 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg px-2 py-1 text-xs font-bold disabled:opacity-40"
                    />
                    <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase">minutos</span>
                  </div>

                  <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={state.firstOccurrenceOnly}
                      onChange={(e) => patchEvent(def.key, { firstOccurrenceOnly: e.target.checked })}
                      className="w-4 h-4 accent-[var(--accent)]"
                    />
                    Enviar somente na primeira ocorrência
                  </label>
                </div>

                <button
                  onClick={() => saveEvent(def)}
                  disabled={state.saving}
                  className="flex items-center gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white text-xs font-bold uppercase px-4 py-2 rounded-lg transition-colors"
                >
                  <Save size={14} /> {state.saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="lg:sticky lg:top-4 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-5 space-y-3 h-fit">
        <div className="flex items-center gap-2 text-[var(--text-primary)]">
          <MessageCircleMore size={16} />
          <h4 className="text-sm font-black uppercase tracking-tight">Variáveis</h4>
        </div>
        <p className="text-[10px] text-[var(--text-tertiary)]">
          Clique em uma variável para inserir no texto do evento em edição{focusedEventKey ? '' : ' (clique num campo de texto primeiro)'}.
        </p>
        <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
          {AUTOMATION_VARIABLES.map(v => (
            <button
              key={v.key}
              onClick={() => insertVariable(v.key)}
              className="w-full text-left bg-[var(--surface-card)] hover:bg-[var(--accent)]/10 border border-[var(--border-default)] rounded-lg px-3 py-2 transition-colors"
            >
              <div className="text-xs font-mono font-bold text-[var(--accent-text)]">{`{{${v.key}}}`}</div>
              <div className="text-[10px] text-[var(--text-tertiary)]">{v.label}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
