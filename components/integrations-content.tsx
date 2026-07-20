'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Key, Plus, Copy, Check, ShieldOff, ShieldCheck, Loader2, ChevronRight, Play,
  Eye, EyeOff, Zap, Clock, Terminal, Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { INTEGRATION_ENDPOINTS, type EndpointDoc } from '@/lib/integration-docs';
import { RATE_LIMIT_MAX_REQUESTS } from '@/lib/integration-constants';

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface TesterResult {
  status: number;
  ok: boolean;
  latencyMs: number;
  body: string;
  rateLimitLimit: string | null;
  rateLimitRemaining: string | null;
}

const SCOPE_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: 'employees:read', label: 'Funcionários — Leitura', description: 'Listar/consultar funcionários e empresas' },
  { value: 'employees:write', label: 'Funcionários — Escrita', description: 'Cadastrar e atualizar funcionários' },
  { value: 'tickets:read', label: 'Chamados — Leitura', description: 'Consultar chamados e mensagens visíveis ao cliente' },
  { value: 'conversations:read', label: 'Conversas — Leitura', description: 'Consultar conversas (WhatsApp) e mensagens' },
];

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-[var(--surface-success)] text-[var(--text-success)]',
  POST: 'bg-[var(--accent)]/10 text-[var(--accent-text)]',
  PUT: 'bg-[var(--surface-warning)] text-[var(--text-warning)]',
};

function buildQueryString(endpoint: EndpointDoc, values: Record<string, string>) {
  const parts = endpoint.params
    .filter(p => p.in === 'query' && values[p.name]?.trim())
    .map(p => `${encodeURIComponent(p.name)}=${encodeURIComponent(values[p.name].trim())}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function buildBodyObject(endpoint: EndpointDoc, values: Record<string, string>) {
  const bodyObj: Record<string, string> = {};
  endpoint.params
    .filter(p => p.in === 'body' && values[p.name]?.trim())
    .forEach(p => { bodyObj[p.name] = values[p.name].trim(); });
  return bodyObj;
}

function buildCurl(endpoint: EndpointDoc, baseUrl: string, apiKey: string, values: Record<string, string>) {
  const qs = buildQueryString(endpoint, values);
  const url = `${baseUrl}${endpoint.path}${qs}`;
  const keyDisplay = apiKey.trim() || '<sua_chave>';
  const lines = [`curl -X ${endpoint.method} '${url}' \\`, `  -H 'Authorization: Bearer ${keyDisplay}'`];
  const hasBodyParams = endpoint.params.some(p => p.in === 'body');
  if (hasBodyParams && endpoint.method !== 'GET') {
    const bodyObj = buildBodyObject(endpoint, values);
    const preview = Object.keys(bodyObj).length
      ? bodyObj
      : Object.fromEntries(endpoint.params.filter(p => p.in === 'body').map(p => [p.name, p.placeholder || '']));
    lines[1] += ' \\';
    lines.push(`  -H 'Content-Type: application/json' \\`);
    lines.push(`  -d '${JSON.stringify(preview, null, 2)}'`);
  }
  return lines.join('\n');
}

export function IntegrationsContent() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingKey, setRevokingKey] = useState<ApiKeyRow | null>(null);
  const [deletingKey, setDeletingKey] = useState<ApiKeyRow | null>(null);
  const [baseUrl, setBaseUrl] = useState('');

  // Explorador/testador de endpoints
  const [selectedId, setSelectedId] = useState(INTEGRATION_ENDPOINTS[0].id);
  const selected = useMemo(() => INTEGRATION_ENDPOINTS.find(e => e.id === selectedId)!, [selectedId]);
  const [testerKey, setTesterKey] = useState('');
  const [showTesterKey, setShowTesterKey] = useState(false);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [testerLoading, setTesterLoading] = useState(false);
  const [testerResult, setTesterResult] = useState<TesterResult | null>(null);
  const [curlCopied, setCurlCopied] = useState(false);

  useEffect(() => {
    setBaseUrl(window.location.origin);
    fetchKeys();
  }, []);

  useEffect(() => {
    setParamValues({});
    setTesterResult(null);
  }, [selectedId]);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/integrations/keys');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setKeys(json.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao carregar chaves de integração.');
    } finally {
      setLoading(false);
    }
  };

  const toggleScope = (scope: string) => {
    setNewKeyScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim() || newKeyScopes.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch('/api/integrations/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim(), scopes: newKeyScopes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setKeys(prev => [{ ...json.data, keyPrefix: json.data.keyPrefix }, ...prev]);
      setRevealedKey(json.data.key);
      setIsNewModalOpen(false);
      setNewKeyName('');
      setNewKeyScopes([]);
      toast.success('Chave de integração criada!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar chave.');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (key: ApiKeyRow, isActive: boolean) => {
    try {
      const res = await fetch('/api/integrations/keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: key.id, isActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setKeys(prev => prev.map(k => k.id === key.id ? { ...k, isActive } : k));
      toast.success(isActive ? 'Chave reativada.' : 'Chave revogada.');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao atualizar chave.');
    }
  };

  const handleDeleteKey = async (key: ApiKeyRow) => {
    try {
      const res = await fetch(`/api/integrations/keys?id=${key.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setKeys(prev => prev.filter(k => k.id !== key.id));
      toast.success('Chave excluída.');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao excluir chave.');
    }
  };

  const copyKey = async () => {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCurl = async () => {
    await navigator.clipboard.writeText(buildCurl(selected, baseUrl, testerKey, paramValues));
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 2000);
  };

  const handleExecute = async () => {
    if (!testerKey.trim()) {
      toast.error('Informe uma chave de API para testar.');
      return;
    }
    setTesterLoading(true);
    setTesterResult(null);
    const start = performance.now();
    try {
      const qs = buildQueryString(selected, paramValues);
      const init: RequestInit = {
        method: selected.method,
        headers: { Authorization: `Bearer ${testerKey.trim()}` },
      };
      const hasBodyParams = selected.params.some(p => p.in === 'body');
      if (hasBodyParams && selected.method !== 'GET') {
        init.headers = { ...init.headers, 'Content-Type': 'application/json' };
        init.body = JSON.stringify(buildBodyObject(selected, paramValues));
      }
      const res = await fetch(`${selected.path}${qs}`, init);
      const latencyMs = Math.round(performance.now() - start);
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* corpo vazio ou não-JSON */ }
      setTesterResult({
        status: res.status,
        ok: res.ok,
        latencyMs,
        body: pretty,
        rateLimitLimit: res.headers.get('x-ratelimit-limit'),
        rateLimitRemaining: res.headers.get('x-ratelimit-remaining'),
      });
    } catch (err: any) {
      setTesterResult({
        status: 0,
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        body: err.message || 'Erro de rede ao chamar o endpoint.',
        rateLimitLimit: null,
        rateLimitRemaining: null,
      });
    } finally {
      setTesterLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-10 shadow-sm space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
              <Key className="text-[var(--accent-text)]" size={24} /> Integração / API Externa
            </h3>
            <p className="text-xs text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
              Gerencie chaves de acesso para plataformas externas
            </p>
          </div>
          <button
            onClick={() => setIsNewModalOpen(true)}
            className="px-4 py-2.5 bg-[var(--accent)] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all shadow-md flex items-center gap-2"
          >
            <Plus size={16} /> Nova Chave
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 text-[var(--accent-text)] animate-spin" />
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center py-10 text-sm text-[var(--text-tertiary)] font-medium">
            Nenhuma chave de integração criada ainda.
          </div>
        ) : (
          <div className="space-y-3">
            {keys.map(key => (
              <div
                key={key.id}
                className="flex items-center justify-between p-5 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[var(--text-primary)]">{key.name}</span>
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full",
                      key.isActive ? "bg-[var(--surface-success)] text-[var(--text-success)]" : "bg-[var(--surface-danger)] text-[var(--text-danger)]"
                    )}>
                      {key.isActive ? 'Ativa' : 'Revogada'}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] font-mono">{key.keyPrefix}••••••••••••••••••••••••••••••••</p>
                  <div className="flex flex-wrap gap-1.5">
                    {key.scopes.map(scope => (
                      <span key={scope} className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-[var(--surface-pill)] text-[var(--text-secondary)]">
                        {scope}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)] font-medium">
                    Criada em {new Date(key.createdAt).toLocaleDateString('pt-BR')}
                    {key.lastUsedAt ? ` · Último uso em ${new Date(key.lastUsedAt).toLocaleString('pt-BR')}` : ' · Nunca utilizada'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {key.isActive && (
                    <button
                      onClick={() => { setTesterKey(''); toast.info('Por segurança, a chave não fica salva no sistema — cole a chave que você copiou na criação no testador abaixo.'); }}
                      className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-all hidden md:block"
                    >
                      Testar abaixo ↓
                    </button>
                  )}
                  <button
                    onClick={() => key.isActive ? setRevokingKey(key) : handleToggleActive(key, true)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                      key.isActive
                        ? "bg-[var(--surface-card)] hover:bg-[var(--surface-danger)] text-[var(--text-danger)] border border-[var(--border-default)]"
                        : "bg-[var(--surface-card)] hover:bg-[var(--surface-success)] text-[var(--text-success)] border border-[var(--border-default)]"
                    )}
                  >
                    {key.isActive ? <><ShieldOff size={14} /> Revogar</> : <><ShieldCheck size={14} /> Reativar</>}
                  </button>
                  <button
                    onClick={() => setDeletingKey(key)}
                    title="Excluir chave"
                    className="p-2.5 rounded-xl text-[var(--text-tertiary)] hover:bg-[var(--surface-danger)] hover:text-[var(--text-danger)] border border-[var(--border-default)] transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Guia + testador de endpoints */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-10 shadow-sm space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h4 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
              <Terminal size={16} className="text-[var(--accent-text)]" /> Guia da API
            </h4>
            <p className="text-xs text-[var(--text-tertiary)] font-medium mt-1 max-w-2xl">
              Envie a chave no header <code className="px-1.5 py-0.5 bg-[var(--surface-pill)] rounded font-mono text-[11px]">Authorization: Bearer &lt;chave&gt;</code>.
              Chamadas devem partir do backend da plataforma externa — nunca do navegador do usuário final, pois a chave ficaria exposta.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] bg-[var(--surface-pill)] px-3 py-2 rounded-xl">
            <Clock size={12} /> {RATE_LIMIT_MAX_REQUESTS} req/min por chave
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
          {/* Lista de endpoints */}
          <div className="space-y-1">
            {INTEGRATION_ENDPOINTS.map(ep => (
              <button
                key={ep.id}
                onClick={() => setSelectedId(ep.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all",
                  selectedId === ep.id ? "bg-[var(--accent)]/10 border border-[var(--accent)]/30" : "border border-transparent hover:bg-[var(--surface-pill)]"
                )}
              >
                <span className={cn("text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0", METHOD_COLORS[ep.method])}>
                  {ep.method}
                </span>
                <span className="text-xs font-bold text-[var(--text-primary)] leading-tight">{ep.summary}</span>
                <ChevronRight size={14} className={cn("ml-auto shrink-0 text-[var(--text-tertiary)] transition-transform", selectedId === ep.id && "rotate-90")} />
              </button>
            ))}
          </div>

          {/* Detalhe do endpoint selecionado */}
          <div className="space-y-6 min-w-0">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg", METHOD_COLORS[selected.method])}>
                  {selected.method}
                </span>
                <code className="text-xs font-mono text-[var(--text-primary)] bg-[var(--surface-pill)] px-2 py-1 rounded-lg break-all">{selected.path}</code>
                <span className={cn(
                  "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg",
                  selected.scope ? "bg-[var(--surface-warning)] text-[var(--text-warning)]" : "bg-[var(--surface-success)] text-[var(--text-success)]"
                )}>
                  {selected.scope ? `escopo: ${selected.scope}` : 'sem escopo — qualquer chave ativa'}
                </span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] font-medium leading-relaxed">{selected.description}</p>
            </div>

            {selected.params.length > 0 && (
              <div className="space-y-3">
                {(['query', 'body'] as const).map(location => {
                  const list = selected.params.filter(p => p.in === location);
                  if (list.length === 0) return null;
                  return (
                    <div key={location}>
                      <p className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest mb-1.5">
                        {location === 'query' ? 'Parâmetros de query' : 'Campos do corpo (JSON)'}
                      </p>
                      <div className="border border-[var(--border-default)] rounded-2xl overflow-hidden">
                        <table className="w-full text-xs">
                          <tbody>
                            {list.map((p, i) => (
                              <tr key={p.name} className={i > 0 ? "border-t border-[var(--border-default)]" : ""}>
                                <td className="px-3 py-2 font-mono font-bold text-[var(--text-primary)] whitespace-nowrap align-top">
                                  {p.name}{p.required && <span className="text-[var(--text-danger)]">*</span>}
                                </td>
                                <td className="px-3 py-2 font-mono text-[var(--text-tertiary)] whitespace-nowrap align-top">{p.type}</td>
                                <td className="px-3 py-2 text-[var(--text-secondary)] align-top">{p.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <p className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest mb-1.5">Exemplo de resposta (200)</p>
              <pre className="p-4 bg-slate-900 text-slate-100 rounded-2xl overflow-x-auto text-[11px] leading-relaxed"><code>{selected.exampleResponse}</code></pre>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest mb-1.5">Possíveis erros</p>
              <div className="border border-[var(--border-default)] rounded-2xl overflow-hidden">
                <table className="w-full text-xs">
                  <tbody>
                    {selected.errors.map((err, i) => (
                      <tr key={err.status + err.code} className={i > 0 ? "border-t border-[var(--border-default)]" : ""}>
                        <td className="px-3 py-2 font-mono font-black text-[var(--text-danger)] whitespace-nowrap align-top">{err.status}</td>
                        <td className="px-3 py-2 font-mono text-[var(--text-tertiary)] whitespace-nowrap align-top">{err.code}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)] align-top">{err.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Testador interativo */}
            <div className="p-5 bg-[var(--surface-pill)] rounded-2xl border border-[var(--border-default)] space-y-4">
              <p className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest flex items-center gap-1.5">
                <Zap size={12} className="text-[var(--accent-text)]" /> Testar agora
              </p>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Chave de API</label>
                <div className="relative">
                  <input
                    type={showTesterKey ? 'text' : 'password'}
                    value={testerKey}
                    onChange={(e) => setTesterKey(e.target.value)}
                    placeholder="ssx_..."
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl pl-4 pr-10 py-2.5 text-xs font-mono focus:ring-4 focus:ring-[var(--accent)]/10 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTesterKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  >
                    {showTesterKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {revealedKey && (
                  <button
                    onClick={() => setTesterKey(revealedKey)}
                    className="text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] hover:underline ml-1"
                  >
                    Usar chave recém-gerada
                  </button>
                )}
              </div>

              {selected.params.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selected.params.map(p => (
                    <div key={p.name} className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">
                        {p.name}{p.required && <span className="text-[var(--text-danger)]">*</span>}
                        <span className="normal-case font-medium text-[9px] text-[var(--text-tertiary)]/70"> ({p.in})</span>
                      </label>
                      <input
                        type="text"
                        value={paramValues[p.name] || ''}
                        onChange={(e) => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                        placeholder={p.placeholder || p.type}
                        className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2 text-xs font-mono focus:ring-4 focus:ring-[var(--accent)]/10 outline-none"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Equivalente em curl</label>
                  <button onClick={copyCurl} className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent-text)] flex items-center gap-1">
                    {curlCopied ? <Check size={12} /> : <Copy size={12} />} Copiar
                  </button>
                </div>
                <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl overflow-x-auto text-[10px] leading-relaxed"><code>{buildCurl(selected, baseUrl, testerKey, paramValues)}</code></pre>
              </div>

              <button
                onClick={handleExecute}
                disabled={testerLoading}
                className="w-full py-3 bg-[var(--accent)] text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {testerLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {testerLoading ? 'Executando...' : 'Executar'}
              </button>

              {testerResult && (
                <div className="space-y-2 pt-2 border-t border-[var(--border-default)]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      "text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg",
                      testerResult.ok ? "bg-[var(--surface-success)] text-[var(--text-success)]" : "bg-[var(--surface-danger)] text-[var(--text-danger)]"
                    )}>
                      HTTP {testerResult.status || 'ERRO'}
                    </span>
                    <span className="text-[10px] font-bold text-[var(--text-tertiary)]">{testerResult.latencyMs}ms</span>
                    {testerResult.rateLimitRemaining && (
                      <span className="text-[10px] font-bold text-[var(--text-tertiary)]">
                        · {testerResult.rateLimitRemaining}/{testerResult.rateLimitLimit} requisições restantes
                      </span>
                    )}
                  </div>
                  <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl overflow-x-auto text-[11px] leading-relaxed max-h-64"><code>{testerResult.body}</code></pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {isNewModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsNewModalOpen(false)} />
          <div className="relative bg-[var(--surface-card)] w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 flex flex-col gap-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[var(--accent)] rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
                <Key size={24} />
              </div>
              <div>
                <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight uppercase leading-none mb-1">Nova Chave</h3>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest leading-none">Acesso para plataforma externa</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome da Integração</label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Ex: CRM Comercial"
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Permissões (escopos)</label>
                {SCOPE_OPTIONS.map(opt => (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition-all",
                      newKeyScopes.includes(opt.value) ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border-default)]"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={newKeyScopes.includes(opt.value)}
                      onChange={() => toggleScope(opt.value)}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-xs font-black text-[var(--text-primary)]">{opt.label}</p>
                      <p className="text-[11px] text-[var(--text-tertiary)] font-medium">{opt.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setIsNewModalOpen(false)}
                className="flex-1 py-4 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-card)] rounded-2xl transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateKey}
                disabled={creating || !newKeyName.trim() || newKeyScopes.length === 0}
                className="flex-1 py-4 bg-[var(--accent)] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all shadow-xl shadow-indigo-100 disabled:opacity-50"
              >
                {creating ? 'Gerando...' : 'Gerar Chave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {revealedKey && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
          <div className="relative bg-[var(--surface-card)] w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 flex flex-col gap-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[var(--text-success)] rounded-2xl flex items-center justify-center text-white shadow-lg">
                <Check size={24} />
              </div>
              <div>
                <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight uppercase leading-none mb-1">Chave Gerada</h3>
                <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest leading-none">Copie agora — não será exibida de novo</p>
              </div>
            </div>

            <div className="p-4 bg-[var(--surface-pill)] rounded-2xl border border-[var(--border-default)] flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-[var(--text-primary)] break-all">{revealedKey}</code>
              <button
                onClick={copyKey}
                className="p-2.5 bg-[var(--accent)] text-white rounded-xl hover:bg-[var(--accent-hover)] transition-all shrink-0"
                title="Copiar"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>

            <div className="p-3 bg-[var(--accent)]/10 rounded-2xl border border-[var(--accent)]/20">
              <p className="text-[11px] text-[var(--accent-text)] font-medium leading-relaxed">
                Repasse essa chave apenas para a plataforma externa de confiança. Se ela for perdida ou exposta, revogue e gere uma nova.
              </p>
            </div>

            <button
              onClick={() => setRevealedKey(null)}
              className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
            >
              Já copiei, fechar
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!revokingKey}
        onClose={() => setRevokingKey(null)}
        onConfirm={() => {
          if (revokingKey) handleToggleActive(revokingKey, false);
          setRevokingKey(null);
        }}
        title="Revogar Chave"
        description={`Deseja realmente revogar a chave "${revokingKey?.name}"? A plataforma externa perderá acesso imediatamente. Você pode reativá-la depois, se precisar.`}
        confirmLabel="Revogar"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={!!deletingKey}
        onClose={() => setDeletingKey(null)}
        onConfirm={() => {
          if (deletingKey) handleDeleteKey(deletingKey);
          setDeletingKey(null);
        }}
        title="Excluir Chave"
        description={`Excluir a chave "${deletingKey?.name}" é permanente e não pode ser desfeito — diferente de revogar, ela some da lista e não poderá ser reativada. A plataforma externa perde o acesso imediatamente.`}
        confirmLabel="Excluir"
        variant="danger"
      />
    </div>
  );
}
