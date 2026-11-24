#!/usr/bin/env node
/*
 * Importa os chamados exportados do Odoo como Tickets Internos do SSX Desk.
 * Segue o roteiro do PROMPT_MIGRACAO.md (mapeamentos de fila/status/prioridade/
 * responsável copiados de lá). Duas fases, NESSA ORDEM — é o que garante zero
 * e-mail: a API só avisa alguém quando o ticket tem criador/responsável/seguidor,
 * então a Fase A cria e ajusta status com tudo isso vazio, e só depois a Fase B
 * preenche o responsável por SQL direto (sem passar pelo código que notifica).
 *
 * Uso (a pasta --data contém chamados_odoo.json e as pastas numeradas de mídia):
 *   node scripts/importar-odoo-tickets-internos.js --data <pasta> --dry-run
 *   node scripts/importar-odoo-tickets-internos.js --data <pasta> --phase A --base-url http://localhost:3000 --key ssx_... [--only 101,102] [--limit 20]
 *   node scripts/importar-odoo-tickets-internos.js --data <pasta> --phase B
 *   node scripts/importar-odoo-tickets-internos.js --data <pasta> --rollback --confirm [--only 101,102]
 *
 * --env <arquivo> escolhe o .env com DATABASE_URL (padrão: .env da raiz). A
 * conexão com o banco é usada para resolver fila/perfil por NOME/E-MAIL (UUIDs
 * mudam entre ambientes) e para a Fase B e o rollback.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};

const DATA_DIR = opt('data');
if (!DATA_DIR) { console.error('Informe --data <pasta com chamados_odoo.json>'); process.exit(1); }
require('dotenv').config({ path: opt('env', path.join(__dirname, '..', '.env')), quiet: true });

const DRY = flag('dry-run');
const PHASE = (opt('phase', '') || '').toUpperCase();
const ROLLBACK = flag('rollback');
const BASE_URL = (opt('base-url', 'http://localhost:3000') || '').replace(/\/$/, '');
const API_KEY = opt('key', process.env.SSX_IMPORT_KEY);
const ONLY = opt('only') ? new Set(opt('only').split(',').map((s) => s.trim())) : null;
const LIMIT = opt('limit') ? parseInt(opt('limit'), 10) : null;
const LOG_FILE = opt('log', path.join(DATA_DIR, 'log_migracao.jsonl'));

// ---------- mapeamentos (PROMPT_MIGRACAO.md) ----------
const PRIORITY = { 'Low priority': 1, 'Medium priority': 2, 'High priority': 3, Urgent: 4 };

const QUEUE = {
  'Suporte': 'Suporte',
  'Fábrica de software': 'Fábrica de software',
  'Desenvolvimento - Infinity': 'Desenvolvimento - Infinity',
  'Suporte - Hardware': 'Hardware',
  'CS - Pós vendas': 'CS - Pós vendas',
  'Desenvolvimento - Web': 'Desenvolvimento - Web',
  'Desenvolvimento - Mobile': 'Desenvolvimento - Mobile',
  'Desenvolvimento - Testes': 'Desenvolvimento - Testes',
  'Infra - Banco de Dados': 'Infra - Banco de Dados',
  'Desenvolvimento - Câmeras': 'Desenvolvimento - Câmeras',
  'Infra - Rede': 'Infraestrutura',
  'Desenvolvimento - Serviços': 'Desenvolvimento - Serviços',
  'Integração - Hardware': 'Hardware',
  'IS - Pós vendas': 'CS - Pós vendas',
  'Desenvolvimento - Globalbus': 'Desenvolvimento - Globalbus',
};
const QUEUE_FALLBACK = 'Backlog';

// null = pular o PATCH (já nasce "Novo")
const STATUS = {
  'New': null,
  'Teste suporte': 'Em Andamento',
  'Concluído': 'Concluído',
  'Aguardando publicação': 'Aguardando Publicação',
  'Não aceito': 'Em Espera',
  'Entregue ao cliente': 'Resolvido',
  'Resolvido': 'Resolvido',
  'Em análise': 'Analise do Desenvolvimento',
  'Feedback ao cliente': 'Aguardando Cliente',
  'Parado': 'Em Espera',
  'Bloqueado': 'Em Espera',
  'Enviada ao comercial': 'Aguardando Alinhamento',
  'Proposta enviada - Comercial': 'Aguardando Alinhamento',
  'Standby': 'Em Espera',
  'Desenvolvimento': 'Em Andamento',
  'Teste hardware': 'Em Andamento',
  'Aprovado - Em desenvolvimento': 'Em Andamento',
  'Pendência de informação': 'Aguardando Cliente',
  'Proposta expirada': 'Em Espera',
  'Aguardando o Suporte': 'Aguardando Suporte',
  'Em teste': 'Em Andamento',
  'Aguardando Implantação': 'Aguardando Data de Hotfix',
  'Aprovado': 'Em Andamento',
  'Teste': 'Em Andamento',
  'Captura de informações': 'Aguardando Cliente',
  'Homologação': 'Em Andamento',
};

const ASSIGNEE = {
  'Pedro Czertok': 'pedro.czertok@systemsat.com.br',
  'Bernardo Fogaça': 'bernardo.fogaca@systemsat.com.br',
  'Sandro Massarani': 'sandro.massarani@systemsat.com.br',
  'Rafael Ferreira Leal': 'rafael.leal@systemsat.com.br',
  'Ana Julia': 'ana.julia@systemsat.com.br',
  'João Pedro Oliveira Sotelino de Paula': 'joao.pedro@systemsat.com.br',
  'Vinicius Saraiva': 'vinicius.saraiva@systemsat.com.br',
  'Brenno Baldino': 'brenno.baldino@systemsat.com.br',
  'Pedro Soares': 'pedro.soares@systemsat.com.br',
  'Jeferson Augusto': 'jeferson.augusto@systemsat.com.br',
  'Fabio Vasconcelos': 'fabio.vasconcelos@systemsat.com.br',
  'Daniel Souza': 'daniel.souza@systemsat.com.br',
  'Antonio Loureiro': 'antonio.loureiro@systemsat.com.br',
  'Dagoberto Guerrieri': 'dagoberto.guerrieri@systemsat.com.br',
  'Mariane Teixeira': 'mariane.teixeira@systemsat.com.br',
  'Leonardo Araújo': 'leonardo.araujo@systemsat.com.br',
  'Willian Batista': 'willian.batista@systemsat.com.br',
  'Diego Moura': 'diego.moura@systemsat.com.br',
  'Rafaela Agnelo': 'rafaela.agnelo@systemsat.com.br',
  'rafael.rodrigues@systemsat.com.br': 'rafael.rodrigues@systemsat.com.br',
  'Mauro Paula': 'mauro.paula@systemsat.com.br',
  'Mychelle Sarlo': 'mychelle.sarlo@systemsat.com.br',
  'Ericson da Silva': 'ericson.silva@systemsat.com.br',
  'Rafael Santos': 'rafael.santos@systemsat.com.br',
  'Luiz Felipe': 'luiz.felipe@systemsat.com.br',
  'Jonathas Menezes': 'jonathas.menezes@systemsat.com.br',
  'Thierri Silva': 'thierri.silva@systemsat.com.br',
  'José Almeida': 'jose.almeida@systemsat.com.br',
  'Ivan Junior': 'rodolfo.quintanilha@systemsat.com.br',
  'Leonardo Lemos': 'leonardo.lemos@systemsat.com.br',
  'Jean Ricardo': 'jean.ricardo1@systemsat.com.br',
  'Kárita Guarani': 'karita.guarani@systemsat.com.br',
  'Lucas Barreto de Azevedo Almeida': 'lucas.barreto@systemsat.com.br',
  'Clarisse Pereira': 'clarice.pereira@systemsat.com.br',
  'Thiago Kalahy': 'rodolfo.quintanilha@systemsat.com.br',
  'Raphael Prudente': 'raphael.prudente@systemsat.com.br',
  'Karen de Oliveira Carvalho': 'karen.oliveira@systemsat.com.br',
  'Gabriel Froes': 'gabriel.froes@systemsat.com.br',
  'Marcos Vieira': 'marcos.vieira@systemsat.com.br',
  'Ana Carolina Modesto': 'anacarolina.modesto@systemsat.com.br',
  'reuel.silva@systemsat.com.br': 'reuel.silva@systemsat.com.br',
  'Vitor Souza': 'vitor.souza@systemsat.com.br',
  'Bianca de Oliveira': 'bianca.oliveira@systemsat.com.br',
  'Rodolfo Quintanilha': 'rodolfo.quintanilha@systemsat.com.br',
  'Bruno Costa': 'bruno.costa@systemsat.com.br',
  'Ruan Dutra': 'rodolfo.quintanilha@systemsat.com.br',
  'Evilyn Azevedo': 'evilyn.azevedo@systemsat.com.br',
  'Gabriel Souza': 'gabriel.souza@systemsat.com.br',
  'Jeff Borges': 'jeff.borges@systemsat.com.br',
  'Pedro Henrique': 'pedro.henrique@systemsat.com.br',
  'Leonardo Martinez': 'leonardo.martinez@systemsat.com.br',
  'Lucas Nicolaci': 'lucas.nicolaci@systemsat.com.br',
  'Eduarda Melo': 'eduarda.melo@systemsat.com.br',
  'Gabriel Cintra': 'gabriel.cintra@systemsat.com.br',
};

// ---------- utilidades ----------
// UUID v5 determinístico por id do Odoo: o mesmo chamado gera sempre o mesmo
// creationRequestId, em qualquer execução — reenviar nunca duplica, e o
// rollback é recalculável só a partir do JSON.
const NAMESPACE = '6f1c2b8e-4d7a-5e3b-9c1d-0a0d0d000001';
function uuidV5(name) {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const h = crypto.createHash('sha1').update(Buffer.concat([ns, Buffer.from(String(name), 'utf8')])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Odoo exporta many2one ora como texto, ora como [id, "nome"].
const asName = (v) => {
  if (v == null || v === false || v === '') return null;
  if (Array.isArray(v)) return asName(v.filter((x) => typeof x === 'string').pop());
  if (typeof v === 'object') return asName(v.name ?? v.display_name ?? null);
  return String(v).trim() || null;
};
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(asName).filter(Boolean);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function transformDescription(ch, missing) {
  let html = String(ch['Descrição'] ?? '');
  html = html.replace(/\s+data-oe-version=("[^"]*"|'[^']*')/g, '');
  html = html.replace(/\s+data-last-history-steps=("[^"]*"|'[^']*')/g, '');
  const folder = path.join(DATA_DIR, String(ch.id));
  const files = fs.existsSync(folder) ? fs.readdirSync(folder) : [];
  let embedded = 0;
  html = html.replace(/(<img\b[^>]*?\bsrc=)(["'])(?:https?:\/\/[^"']*?)?\/web\/image\/(\d+)[^"']*\2/gi, (full, pre, q, imgId) => {
    const file = files.find((f) => f.startsWith(`${imgId}_`));
    if (!file) { missing.push({ odooId: ch.id, imageId: imgId }); return full; }
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) { missing.push({ odooId: ch.id, imageId: imgId, reason: `extensão ${path.extname(file)}` }); return full; }
    embedded++;
    return `${pre}${q}data:${mime};base64,${fs.readFileSync(path.join(folder, file)).toString('base64')}${q}`;
  });
  const cliente = asName(ch['Cliente']) || '—';
  const tel = asName(ch['Telefone']) || '—';
  const link = asName(ch['Link']);
  const header = `<div><strong>Importado do Odoo</strong> — chamado nº ${esc(ch.id)} | Cliente: ${esc(cliente)} | Telefone: ${esc(tel)} | `
    + (link ? `<a href="${esc(link)}">Ver chamado original no Odoo</a>` : 'sem link') + '</div><hr>';
  return { html: header + html, embedded };
}

function plan(ch, problems) {
  const equipe = asName(ch['Equipe']);
  const queueName = equipe ? QUEUE[equipe] : QUEUE_FALLBACK;
  if (equipe && !queueName) problems.push(`chamado ${ch.id}: Equipe "${equipe}" fora da tabela`);
  const prioRaw = asName(ch['Prioridade']);
  const priority = PRIORITY[prioRaw];
  if (!priority) problems.push(`chamado ${ch.id}: Prioridade "${prioRaw}" fora da tabela`);
  const statusRaw = asName(ch['Status']);
  if (!(statusRaw in STATUS)) problems.push(`chamado ${ch.id}: Status "${statusRaw}" fora da tabela`);
  const who = asName(ch['Atribuído a']);
  if (who && !ASSIGNEE[who]) problems.push(`chamado ${ch.id}: Atribuído a "${who}" fora da tabela`);
  return {
    odooId: ch.id,
    title: asName(ch['Assunto']) || `Chamado Odoo ${ch.id}`,
    queueName,
    priority,
    tags: asList(ch['Marcadores']),
    targetStatus: STATUS[statusRaw] ?? null,
    assigneeEmail: who ? ASSIGNEE[who] || null : null,
    creationRequestId: uuidV5(ch.id),
  };
}

async function api(method, url, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE_URL}${url}`, {
      method,
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    if (res.status === 429 && attempt < 5) { await sleep(15000); continue; }
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json).slice(0, 400)}`);
    await sleep(600); // limite da API: 120 req/min por chave
    return json;
  }
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'chamados_odoo.json'), 'utf8'));
  let chamados = Array.isArray(raw) ? raw : raw.chamados;
  if (!Array.isArray(chamados)) throw new Error('JSON sem a lista "chamados"');
  console.log(`JSON: ${chamados.length} chamados`);
  if (ONLY) chamados = chamados.filter((c) => ONLY.has(String(c.id)));
  if (LIMIT) chamados = chamados.slice(0, LIMIT);

  const problems = [];
  const plans = chamados.map((c) => plan(c, problems));

  const { Client } = require('pg');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const queues = new Map((await db.query('SELECT id, name FROM public.internal_ticket_queues WHERE is_active = true')).rows.map((r) => [r.name, r.id]));
    const emails = [...new Set(plans.map((p) => p.assigneeEmail).filter(Boolean))];
    const profiles = new Map((await db.query('SELECT id, lower(email) e FROM public.profiles WHERE lower(email) = ANY($1)', [emails])).rows.map((r) => [r.e, r.id]));
    const missingQueues = [...new Set(plans.map((p) => p.queueName).filter((n) => n && !queues.has(n)))];
    const missingEmails = emails.filter((e) => !profiles.has(e));
    if (missingQueues.length) problems.push(`filas inexistentes/inativas no banco: ${missingQueues.join(', ')}`);
    if (missingEmails.length) problems.push(`e-mails sem perfil no banco: ${missingEmails.join(', ')}`);

    if (ROLLBACK) {
      const ids = plans.map((p) => p.creationRequestId);
      const found = await db.query('SELECT count(*)::int n FROM public.internal_tickets WHERE creation_request_id = ANY($1::uuid[])', [ids]);
      console.log(`Rollback: ${found.rows[0].n} ticket(s) desta importação no banco.`);
      if (!flag('confirm')) { console.log('Nada apagado (use --confirm).'); return; }
      const del = await db.query('DELETE FROM public.internal_tickets WHERE creation_request_id = ANY($1::uuid[])', [ids]);
      console.log(`Apagados: ${del.rowCount}`);
      return;
    }

    if (DRY || !PHASE) {
      const missingImgs = [];
      let embedded = 0, bytes = 0;
      for (const ch of chamados) { const d = transformDescription(ch, missingImgs); embedded += d.embedded; bytes += d.html.length; }
      const by = (k) => plans.reduce((m, p) => ((m[p[k] ?? '(nenhum)'] = (m[p[k] ?? '(nenhum)'] || 0) + 1), m), {});
      console.log('Filas:', by('queueName'));
      console.log('Status alvo:', by('targetStatus'));
      console.log('Prioridade:', by('priority'));
      console.log(`Sem responsável: ${plans.filter((p) => !p.assigneeEmail).length}`);
      console.log(`Imagens embutidas: ${embedded} | sem arquivo: ${missingImgs.length} | descrições somam ${(bytes / 1048576).toFixed(1)} MB`);
      if (missingImgs.length) console.log('Imagens sem arquivo:', JSON.stringify(missingImgs));
      console.log(problems.length ? `PROBLEMAS (${problems.length}):\n - ${problems.join('\n - ')}` : 'Nenhum problema de mapeamento.');
      return;
    }

    if (problems.length) { console.error(`Corrija antes de importar:\n - ${problems.join('\n - ')}`); process.exitCode = 1; return; }

    if (PHASE === 'A') {
      if (!API_KEY) throw new Error('Informe --key ssx_... (escopos internal-tickets:read/write)');
      const missingImgs = [];
      let ok = 0;
      for (const p of plans) {
        const ch = chamados.find((c) => c.id === p.odooId);
        const { html } = transformDescription(ch, missingImgs);
        const created = await api('POST', '/api/integrations/v1/internal-tickets', {
          title: p.title, description: html, queueId: queues.get(p.queueName), priority: p.priority, tags: p.tags, creationRequestId: p.creationRequestId,
        });
        const t = created.data;
        if (t.assigneeId || t.creatorId) throw new Error(`ticket ${t.id} (Odoo ${p.odooId}) já tem responsável/criador — parando para não disparar e-mail`);
        if (p.targetStatus && t.subStatus !== p.targetStatus && t.status !== p.targetStatus) {
          await api('PATCH', `/api/integrations/v1/internal-tickets?id=${encodeURIComponent(t.id)}`, { status: p.targetStatus });
        }
        fs.appendFileSync(LOG_FILE, JSON.stringify({ odooId: p.odooId, internalTicketId: t.id, internalTicketNumber: t.ticketNumber, creationRequestId: p.creationRequestId, status: 'created', at: new Date().toISOString() }) + '\n');
        ok++;
        console.log(`✓ Odoo ${p.odooId} → ${t.ticketNumber ?? t.id}${p.targetStatus ? ` [${p.targetStatus}]` : ''}`);
      }
      console.log(`Fase A: ${ok}/${plans.length} ok. Imagens sem arquivo: ${missingImgs.length}`);
      if (missingImgs.length) console.log(JSON.stringify(missingImgs));
      return;
    }

    if (PHASE === 'B') {
      const ids = plans.map((p) => p.creationRequestId);
      const existing = await db.query('SELECT creation_request_id::text cr FROM public.internal_tickets WHERE creation_request_id = ANY($1::uuid[])', [ids]);
      const have = new Set(existing.rows.map((r) => r.cr));
      const notYet = plans.filter((p) => !have.has(p.creationRequestId));
      if (notYet.length) { console.error(`Fase A incompleta: ${notYet.length} chamado(s) ainda não criados (ex.: ${notYet.slice(0, 5).map((p) => p.odooId).join(', ')}). Fase B não roda.`); process.exitCode = 1; return; }
      const pairs = plans.filter((p) => p.assigneeEmail).map((p) => [p.creationRequestId, profiles.get(p.assigneeEmail)]);
      // Só toca quem ainda está sem responsável: rodar duas vezes não muda nada.
      const res = await db.query(
        `UPDATE public.internal_tickets it SET assignee_id = v.assignee_id::uuid
           FROM unnest($1::uuid[], $2::uuid[]) AS v(cr, assignee_id)
          WHERE it.creation_request_id = v.cr AND it.assignee_id IS NULL`,
        [pairs.map((x) => x[0]), pairs.map((x) => x[1])]
      );
      console.log(`Fase B: responsável preenchido em ${res.rowCount} ticket(s) (${plans.length - pairs.length} ficam sem responsável).`);
      return;
    }
    throw new Error('Use --dry-run, --phase A, --phase B ou --rollback');
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
