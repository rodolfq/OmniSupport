#!/usr/bin/env node
/**
 * Move as fotos de perfil (profiles.avatar_url) de `data:` URL em base64 para
 * arquivo no volume de anexos (ATTACHMENTS_DIR/avatars/<sha1>.<ext>), e grava
 * no banco só o endereço /api/files/avatars/... — 2026-11-12, economia de
 * espaço: ~65 MB de fotos no banco de produção (105 perfis), que também
 * entravam em todo dump de backup.
 *
 * A foto continua aparecendo igual: quem serve é /api/users/<id>/avatar, que
 * aceita as duas formas. As miniaturas (avatar_thumb_url / avatar_medium_url,
 * poucos KB cada) ficam como estão, em `data:` URL, de propósito.
 *
 * Mesma regra de nome de lib/services/attachment-storage.ts
 * (storeAvatarDataUrl): hash do CONTEÚDO, então rodar de novo não duplica
 * arquivo e duas pessoas com a mesma foto compartilham o arquivo.
 *
 * Precisa enxergar o volume — no servidor, rode DENTRO do container:
 *   docker compose run --rm -T app node scripts/migrate-avatars-to-disk.js --dry-run
 *   docker compose run --rm -T app node scripts/migrate-avatars-to-disk.js
 * (o -T evita que o docker compose consuma a entrada padrão do shell)
 *
 * Seguro com a aplicação no ar: idempotente (o que já é /api/files/ é
 * ignorado) e o UPDATE só acontece se a foto ainda for a que foi lida (md5) —
 * se a pessoa trocou a foto no meio do caminho, o perfil é pulado.
 *
 * ATENÇÃO: reescreve dados. Faça o dump do banco antes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRY_RUN = process.argv.includes('--dry-run');
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || path.join(process.cwd(), 'data', 'attachments');
const URL_PREFIX = '/api/files/';

// Igual a extensionFor() de attachment-storage.ts (sem nome original).
function extensionFor(mime) {
  const subtype = (mime || '').split('/')[1]?.split(';')[0] || 'bin';
  return subtype.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
}

function parseDataUrl(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;
  const header = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  return {
    mimeType: header.split(';')[0] || 'application/octet-stream',
    buffer: /;base64/i.test(header) ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf-8')
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não definida.');
    process.exit(1);
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  console.log(`Diretório de anexos: ${ATTACHMENTS_DIR}${DRY_RUN ? '  (DRY-RUN: nada será gravado)' : ''}`);
  if (!DRY_RUN) {
    fs.mkdirSync(path.join(ATTACHMENTS_DIR, 'avatars'), { recursive: true });
    fs.accessSync(path.join(ATTACHMENTS_DIR, 'avatars'), fs.constants.W_OK);
  }

  const stats = { profiles: 0, files: 0, reused: 0, bytes: 0, skipped: 0, invalid: 0 };
  try {
    const ids = await pool.query(`SELECT id FROM public.profiles WHERE avatar_url LIKE 'data:image/%' ORDER BY id`);
    for (const { id } of ids.rows) {
      const row = (await pool.query('SELECT avatar_url FROM public.profiles WHERE id = $1', [id])).rows[0];
      if (!row || typeof row.avatar_url !== 'string' || !row.avatar_url.startsWith('data:image/')) continue;
      const parsed = parseDataUrl(row.avatar_url);
      if (!parsed || parsed.buffer.byteLength === 0) { stats.invalid += 1; continue; }

      const hash = crypto.createHash('sha1').update(parsed.buffer).digest('hex');
      const fileName = `${hash}.${extensionFor(parsed.mimeType)}`;
      const absolute = path.join(ATTACHMENTS_DIR, 'avatars', fileName);
      const url = `${URL_PREFIX}avatars/${fileName}`;
      stats.bytes += row.avatar_url.length;

      if (DRY_RUN) { stats.profiles += 1; continue; }

      let wrote = false;
      if (fs.existsSync(absolute)) stats.reused += 1;
      else { fs.writeFileSync(absolute, parsed.buffer); wrote = true; stats.files += 1; }

      const up = await pool.query(
        `UPDATE public.profiles SET avatar_url = $1 WHERE id = $2 AND md5(avatar_url) = md5($3)`,
        [url, id, row.avatar_url]
      );
      if (!up.rowCount) {
        // Foto trocada no meio do caminho: não sobrescreve. Arquivo recém
        // gravado e sem dono é apagado (um já existente pode ser de outro perfil).
        if (wrote) { try { fs.unlinkSync(absolute); } catch { /* nada */ } stats.files -= 1; }
        stats.skipped += 1;
        continue;
      }
      stats.profiles += 1;
    }
    const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';
    console.log(`Perfis ${DRY_RUN ? 'a migrar' : 'migrados'}: ${stats.profiles} (${mb(stats.bytes)} de base64 saindo do banco)`);
    if (!DRY_RUN) console.log(`Arquivos gravados: ${stats.files}; reaproveitados (mesma foto): ${stats.reused}`);
    if (stats.skipped) console.log(`Pulados por troca de foto simultânea: ${stats.skipped} — rode de novo`);
    if (stats.invalid) console.log(`Ignorados (data: URL inválida): ${stats.invalid}`);
    if (!DRY_RUN && stats.profiles) console.log('Depois: VACUUM (ANALYZE) public.profiles; pra o espaço ser reaproveitado.');
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
