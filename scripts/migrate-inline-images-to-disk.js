#!/usr/bin/env node
/**
 * Tira as imagens COLADAS no texto rico (descrição e notas de chamado e de
 * ticket interno) de dentro do banco: cada `<img src="data:image/...;base64,...">`
 * vira um arquivo no volume de anexos (ATTACHMENTS_DIR) e o `src` passa a
 * apontar pra /api/files/.... A imagem continua aparecendo no mesmo lugar do
 * texto — só deixa de morar no Postgres como texto gigante.
 *
 * Por que existe (2026-11-11): imagem colada no editor ia pro banco em base64
 * dentro do HTML. Isso derrubou a CPU do servidor duas vezes (o indexador de
 * embeddings travava o processo tentando processar MB de base64) e deixava
 * pesadas a lista e o detalhe de ticket interno. O código atual já converte
 * na hora de salvar (externalizeInlineImages, lib/services/attachment-storage.ts);
 * este script trata o que foi gravado ANTES disso.
 *
 * É diferente de scripts/migrate-attachments-to-disk.js, que cuida dos
 * ANEXOS (coluna attachments_data/metadata.attachments), não de imagem no
 * meio do texto.
 *
 * Precisa enxergar o volume — no servidor, rode DENTRO do container:
 *   docker compose run --rm app node scripts/migrate-inline-images-to-disk.js --dry-run
 *   docker compose run --rm app node scripts/migrate-inline-images-to-disk.js
 *
 * Seguro com a aplicação no ar:
 *   - Idempotente: o que já aponta pra /api/files/ não casa com a regex, então
 *     rodar de novo (ou depois de uma interrupção) continua de onde parou.
 *   - Cada registro é lido e reescrito sozinho. O UPDATE só acontece se o
 *     texto ainda for exatamente o que foi lido (comparação por md5) — se
 *     alguém editou aquele chamado no meio do caminho, o registro é pulado
 *     (e os arquivos que o script tinha acabado de gravar são apagados), em
 *     vez de sobrescrever a edição. Rodar de novo pega esse registro.
 *   - Um registro por vez na memória (o maior no banco de dev tinha 1,2 MB).
 *
 * Também:
 *   - Notas de chamado/ticket interno reescritas são recolocadas na fila de
 *     indexação do Agente de IA (ai_embedding_queue), pra o embedding ser
 *     recalculado sobre o texto limpo — só se o embedding estiver ligado.
 *   - Limpa o base64 que tenha ficado no texto já indexado (ai_embeddings.content),
 *     trocando por "[imagem]". Ali não há imagem a preservar: é só o texto de
 *     busca do Agente de IA.
 *
 * ATENÇÃO: reescreve dados. Faça o dump do banco antes.
 *
 * Opções:
 *   --dry-run     só conta e mostra o que faria; não grava arquivo nem banco
 *   --only=tabela limita a uma das tabelas da lista TARGETS
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice('--only='.length) || null;
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || path.join(process.cwd(), 'data', 'attachments');
const URL_PREFIX = '/api/files/';

// Onde há texto rico com imagem colada. `embedSource` = source_type na fila
// do Agente de IA (só as notas são indexadas; descrição não é).
const TARGETS = [
  { table: 'tickets', column: 'description', embedSource: null },
  { table: 'internal_tickets', column: 'description', embedSource: null },
  { table: 'ticket_messages', column: 'content', embedSource: 'ticket_message' },
  { table: 'internal_ticket_messages', column: 'content', embedSource: 'internal_ticket_message' }
];

// MESMA regex de lib/services/attachment-storage.ts (INLINE_DATA_IMAGE_RE) —
// duplicada de propósito: este script é CommonJS puro, roda sem o bundle do
// Next. Se mudar lá, mude aqui.
const INLINE_DATA_IMAGE_RE = /(<img\b[^>]{0,2000}?\bsrc\s*=\s*)(["'])(data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]*)\2/gi;

function extensionFor(mime) {
  const subtype = (mime || '').split('/')[1]?.split(';')[0] || 'bin';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  return subtype.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
}

function parseDataUrl(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;
  const header = dataUrl.slice(5, commaIndex);
  if (!/;base64/i.test(header)) return null;
  return {
    mimeType: header.split(';')[0] || 'application/octet-stream',
    buffer: Buffer.from(dataUrl.slice(commaIndex + 1).replace(/\s+/g, ''), 'base64')
  };
}

/**
 * Troca cada imagem base64 do HTML por um arquivo. Devolve o HTML novo e a
 * lista de arquivos gravados (pra poder apagar se o UPDATE não acontecer).
 * Imagem que não decodifica fica como está — perder a imagem é pior que
 * deixar o registro pesado.
 */
function externalize(html, createdAt) {
  const written = [];
  let bytes = 0;
  const date = createdAt ? new Date(createdAt) : new Date();
  // Partição pela data do próprio registro, como em migrate-attachments-to-disk.js.
  const folder = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

  const out = html.replace(INLINE_DATA_IMAGE_RE, (whole, prefix, quote, dataUrl) => {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed || parsed.buffer.byteLength === 0) return whole;
    const fileName = `${crypto.randomUUID()}.${extensionFor(parsed.mimeType)}`;
    if (!DRY_RUN) {
      const dir = path.join(ATTACHMENTS_DIR, folder);
      fs.mkdirSync(dir, { recursive: true });
      const abs = path.join(dir, fileName);
      fs.writeFileSync(abs, parsed.buffer);
      written.push(abs);
    }
    bytes += parsed.buffer.byteLength;
    return `${prefix}${quote}${URL_PREFIX}${folder}/${fileName}${quote}`;
  });

  return { html: out, written, bytes, images: written.length || (DRY_RUN ? countImages(html) : 0) };
}

function countImages(html) {
  return [...html.matchAll(INLINE_DATA_IMAGE_RE)].filter(m => {
    const p = parseDataUrl(m[3]);
    return p && p.buffer.byteLength > 0;
  }).length;
}

function removeFiles(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch { /* já não existe: nada a fazer */ }
  }
}

async function embeddingsEnabled(pool) {
  // A fila só é drenada com ENABLE_AI_EMBEDDINGS=true; com ele desligado,
  // enfileirar só acumularia linha sem uso.
  if (process.env.ENABLE_AI_EMBEDDINGS !== 'true') return false;
  const r = await pool.query(`SELECT to_regclass('public.ai_embedding_queue') IS NOT NULL AS ok`);
  return !!r.rows[0]?.ok;
}

async function migrateTarget(pool, target, stats, enqueue) {
  const { table, column, embedSource } = target;

  // Só os ids primeiro — o conteúdo vem um registro por vez, logo abaixo.
  const idsRes = await pool.query(
    `SELECT id FROM public.${table}
      WHERE ${column} LIKE '%data:image/%;base64,%'
      ORDER BY created_at ASC NULLS LAST`
  );

  for (const { id } of idsRes.rows) {
    const rowRes = await pool.query(
      `SELECT ${column} AS html, created_at FROM public.${table} WHERE id = $1`,
      [id]
    );
    const row = rowRes.rows[0];
    if (!row || typeof row.html !== 'string') continue;

    const result = externalize(row.html, row.created_at);
    if (result.images === 0 || result.html === row.html) {
      // Tem "data:image/" no texto mas fora de um <img src> (ex.: alguém
      // colou o texto do base64 como texto). Não é imagem a extrair.
      stats.ignored += 1;
      continue;
    }

    stats.images += result.images;
    stats.bytes += result.bytes;
    stats.before += row.html.length;
    stats.after += result.html.length;

    if (DRY_RUN) { stats.rows += 1; continue; }

    let updated = false;
    try {
      const up = await pool.query(
        `UPDATE public.${table} SET ${column} = $1
          WHERE id = $2 AND md5(${column}) = md5($3)`,
        [result.html, id, row.html]
      );
      updated = (up.rowCount || 0) > 0;
    } catch (err) {
      removeFiles(result.written);
      throw err;
    }

    if (!updated) {
      // Editado no meio do caminho: não sobrescreve. Os arquivos gravados
      // para esta versão não são referenciados por ninguém — apaga.
      removeFiles(result.written);
      stats.skipped += 1;
      continue;
    }
    stats.rows += 1;

    if (enqueue && embedSource) {
      await pool.query(
        `INSERT INTO public.ai_embedding_queue (source_type, source_id) VALUES ($1, $2)`,
        [embedSource, id]
      ).catch(err => console.error(`  aviso: não enfileirou ${embedSource} ${id} pra reindexar — ${err.message}`));
    }
  }
}

async function cleanEmbeddingsContent(pool) {
  const exists = await pool.query(`SELECT to_regclass('public.ai_embeddings') IS NOT NULL AS ok`);
  if (!exists.rows[0]?.ok) return 0;
  const where = `content LIKE '%data:image/%;base64,%'`;
  if (DRY_RUN) {
    const r = await pool.query(`SELECT count(*)::int AS n FROM public.ai_embeddings WHERE ${where}`);
    return r.rows[0].n;
  }
  const r = await pool.query(
    `UPDATE public.ai_embeddings
        SET content = regexp_replace(content, 'data:image/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=[:space:]]*', '[imagem]', 'gi')
      WHERE ${where}`
  );
  return r.rowCount || 0;
}

const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não definida.');
    process.exit(1);
  }
  const targets = ONLY ? TARGETS.filter(t => t.table === ONLY) : TARGETS;
  if (ONLY && targets.length === 0) {
    console.error(`--only=${ONLY} não é uma das tabelas: ${TARGETS.map(t => t.table).join(', ')}`);
    process.exit(1);
  }

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  console.log(`Diretório de anexos: ${ATTACHMENTS_DIR}${DRY_RUN ? '  (DRY-RUN: nada será gravado)' : ''}`);

  if (!DRY_RUN) {
    // Falha cedo se o volume não aceita escrita — senão cada registro
    // falharia um por um.
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    fs.accessSync(ATTACHMENTS_DIR, fs.constants.W_OK);
  }

  try {
    const enqueue = !DRY_RUN && await embeddingsEnabled(pool);
    const total = { rows: 0, images: 0, bytes: 0, before: 0, after: 0, skipped: 0, ignored: 0 };

    for (const target of targets) {
      const stats = { rows: 0, images: 0, bytes: 0, before: 0, after: 0, skipped: 0, ignored: 0 };
      try {
        await migrateTarget(pool, target, stats, enqueue);
      } catch (err) {
        console.error(`  ${target.table}.${target.column}: FALHOU — ${err.message}`);
        process.exitCode = 1;
      }
      console.log(
        `  ${target.table}.${target.column}: ${stats.rows} registro(s), ${stats.images} imagem(ns) (${mb(stats.bytes)}); ` +
        `texto ${mb(stats.before)} -> ${mb(stats.after)}` +
        (stats.skipped ? `; ${stats.skipped} pulado(s) por edição simultânea — rode de novo` : '') +
        (stats.ignored ? `; ${stats.ignored} com "data:image" fora de <img> (não mexido)` : '')
      );
      for (const k of Object.keys(total)) total[k] += stats[k];
    }

    const emb = await cleanEmbeddingsContent(pool);
    console.log(`  ai_embeddings.content: ${emb} registro(s) ${DRY_RUN ? 'seriam limpos' : 'limpos'} (base64 -> "[imagem]")`);
    if (enqueue) console.log('  Notas reescritas foram recolocadas na fila de reindexação do Agente de IA.');

    console.log(
      `Total: ${total.rows} registro(s), ${total.images} imagem(ns) ${DRY_RUN ? 'seriam movidas' : 'movidas'} para disco ` +
      `(${mb(total.bytes)}); texto no banco ${mb(total.before)} -> ${mb(total.after)}.`
    );
    if (!DRY_RUN && total.rows > 0) {
      console.log('Para devolver o espaço ao disco do banco: VACUUM (ANALYZE) nas tabelas acima (VACUUM FULL trava a tabela enquanto roda).');
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { externalize, INLINE_DATA_IMAGE_RE };
