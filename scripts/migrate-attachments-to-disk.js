#!/usr/bin/env node
/**
 * Migra os anexos que hoje estão como `data:` URL dentro do Postgres para
 * arquivos no volume de anexos (ATTACHMENTS_DIR), reescrevendo o JSON pra
 * apontar pra /api/files/....
 *
 * Precisa enxergar o volume — no servidor, rode DENTRO do container:
 *   docker compose run --rm app node scripts/migrate-attachments-to-disk.js --dry-run
 *   docker compose run --rm app node scripts/migrate-attachments-to-disk.js
 *
 * É idempotente: anexo que já está em /api/files/ é ignorado, então rodar de
 * novo depois de uma interrupção continua de onde parou. Cada linha é
 * reescrita numa transação própria — uma falha no meio não deixa metade dos
 * anexos de uma mensagem apontando pra lugar nenhum.
 *
 * ATENÇÃO: reescreve dados de produção. Faça o dump do banco antes.
 *
 * A lógica de nomeação/particionamento é a mesma de
 * lib/services/attachment-storage.ts (duplicada aqui de propósito: este script
 * é CommonJS puro, pra rodar sem passar pelo bundle do Next).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const DRY_RUN = process.argv.includes('--dry-run');
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || path.join(process.cwd(), 'data', 'attachments');
const URL_PREFIX = '/api/files/';

// Onde há anexo hoje. `jsonPath` diz se o array está na raiz da coluna
// (attachments_data) ou dentro de metadata.attachments.
const TARGETS = [
  { table: 'chat_messages', column: 'metadata', nested: 'attachments' },
  { table: 'internal_chat_messages', column: 'metadata', nested: 'attachments' },
  { table: 'ticket_messages', column: 'attachments_data', nested: null },
  { table: 'internal_ticket_messages', column: 'attachments_data', nested: null },
  { table: 'tickets', column: 'attachments_data', nested: null }
];

function extensionFor(mime, originalName) {
  const fromName = originalName ? path.extname(originalName).replace('.', '') : '';
  if (fromName && /^[a-z0-9]{1,8}$/i.test(fromName)) return fromName.toLowerCase();
  const subtype = (mime || '').split('/')[1]?.split(';')[0] || 'bin';
  return subtype.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;
  const header = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const isBase64 = /;base64/i.test(header);
  return {
    mimeType: header.split(';')[0] || 'application/octet-stream',
    buffer: isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf-8')
  };
}

function storeBuffer(buffer, mimeType, originalName, createdAt) {
  // Particiona pela data do próprio registro (não pela data da migração), pra
  // o diretório refletir quando o anexo entrou no sistema.
  const date = createdAt ? new Date(createdAt) : new Date();
  const folder = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const fileName = `${crypto.randomUUID()}.${extensionFor(mimeType, originalName)}`;
  const absoluteDir = path.join(ATTACHMENTS_DIR, folder);
  if (!DRY_RUN) {
    fs.mkdirSync(absoluteDir, { recursive: true });
    fs.writeFileSync(path.join(absoluteDir, fileName), buffer);
  }
  return { url: `${URL_PREFIX}${folder}/${fileName}`, size: buffer.byteLength };
}

async function migrateTarget(pool, target, stats) {
  const { table, column, nested } = target;

  const rowsRes = await pool.query(
    `SELECT id, ${column} AS payload, created_at
     FROM public.${table}
     WHERE ${column}::text LIKE '%data:%'
     ORDER BY created_at ASC NULLS LAST`
  );

  for (const row of rowsRes.rows) {
    const payload = row.payload;
    const list = nested ? payload?.[nested] : payload;
    if (!Array.isArray(list) || !list.length) continue;

    let changed = false;
    const migrated = list.map(attachment => {
      const parsed = attachment && parseDataUrl(attachment.url);
      if (!parsed) return attachment;
      const stored = storeBuffer(parsed.buffer, parsed.mimeType, attachment.name, row.created_at);
      changed = true;
      stats.files += 1;
      stats.bytes += parsed.buffer.byteLength;
      return {
        ...attachment,
        url: stored.url,
        type: attachment.type || parsed.mimeType,
        size: attachment.size || stored.size
      };
    });

    if (!changed) continue;
    stats.rows += 1;

    if (DRY_RUN) continue;
    const newPayload = nested ? { ...payload, [nested]: migrated } : migrated;
    await pool.query(
      `UPDATE public.${table} SET ${column} = $1::jsonb WHERE id = $2`,
      [JSON.stringify(newPayload), row.id]
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não definida.');
    process.exit(1);
  }

  console.log(`Diretório de anexos: ${ATTACHMENTS_DIR}${DRY_RUN ? ' (dry-run, nada será escrito)' : ''}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const total = { rows: 0, files: 0, bytes: 0 };

  try {
    for (const target of TARGETS) {
      const stats = { rows: 0, files: 0, bytes: 0 };
      try {
        await migrateTarget(pool, target, stats);
      } catch (err) {
        console.error(`  ${target.table}: FALHOU — ${err.message}`);
        process.exitCode = 1;
        continue;
      }
      console.log(`  ${target.table}: ${stats.rows} registro(s), ${stats.files} anexo(s), ${(stats.bytes / 1024 / 1024).toFixed(2)} MB`);
      total.rows += stats.rows;
      total.files += stats.files;
      total.bytes += stats.bytes;
    }
    console.log(`Total: ${total.rows} registro(s), ${total.files} anexo(s), ${(total.bytes / 1024 / 1024).toFixed(2)} MB movidos para disco.`);
    if (!DRY_RUN && total.files > 0) {
      console.log('Rode VACUUM FULL nas tabelas afetadas se quiser devolver o espaço ao sistema de arquivos do banco.');
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
