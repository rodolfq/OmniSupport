// Backfill de avatar_thumb_url pra quem já tem avatar_url e ainda não tem
// miniatura (coluna nova, ver migrations/profiles_avatar_thumb.sql). Dali
// pra frente a miniatura é gerada na hora certa (edição de perfil em
// app/api/users/route.ts, sync do Bitrix24 em lib/services/bitrix24-service.ts)
// — este script é só pra zerar o passivo dos perfis já existentes.
// Idempotente: só toca quem tem avatar_thumb_url NULL, então pode rodar de novo sem custo.
const { Client } = require('pg');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const THUMB_DIM = 48;
const THUMB_QUALITY = 60;

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return Buffer.from(match[2], 'base64');
}

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(
      "SELECT id, name, avatar_url FROM public.profiles WHERE avatar_url LIKE 'data:image%' AND avatar_thumb_url IS NULL"
    );

    console.log(`Perfis com foto sem miniatura: ${res.rows.length}`);

    let generated = 0;
    let failed = 0;

    for (const row of res.rows) {
      const buffer = parseDataUrl(row.avatar_url);
      if (!buffer) {
        failed++;
        console.warn(`  [${row.name}] data URL não reconhecida, pulando.`);
        continue;
      }

      try {
        const resized = await sharp(buffer)
          .resize(THUMB_DIM, THUMB_DIM, { fit: 'cover' })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: THUMB_QUALITY })
          .toBuffer();

        const thumbDataUrl = `data:image/jpeg;base64,${resized.toString('base64')}`;
        await client.query('UPDATE public.profiles SET avatar_thumb_url = $1 WHERE id = $2', [thumbDataUrl, row.id]);
        generated++;
        console.log(`  [${row.name}] miniatura gerada (${(thumbDataUrl.length / 1024).toFixed(1)}KB)`);
      } catch (err) {
        failed++;
        console.warn(`  [${row.name}] falhou ao gerar miniatura: ${err.message}`);
      }
    }

    console.log('\n--- Resumo ---');
    console.log(`Geradas: ${generated}`);
    console.log(`Falhas: ${failed}`);
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('ERRO ao gerar miniaturas de avatar:', err);
  process.exit(1);
});
