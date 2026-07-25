const { Client } = require('pg');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const MAX_DIM = 256;
const QUALITY = 82;
const MIN_SIZE_TO_TOUCH = 20 * 1024; // não mexe em avatar que já é pequeno

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(
      "SELECT id, name, avatar_url FROM public.profiles WHERE avatar_url LIKE 'data:image%'"
    );

    console.log(`Avatares em base64 encontrados: ${res.rows.length}`);

    let touched = 0;
    let skippedSmall = 0;
    let skippedNoGain = 0;
    let failed = 0;
    let bytesBefore = 0;
    let bytesAfter = 0;

    for (const row of res.rows) {
      const original = row.avatar_url;
      const parsed = parseDataUrl(original);
      if (!parsed) { failed++; console.warn(`  [${row.name}] data URL não reconhecida, pulando.`); continue; }

      if (parsed.buffer.length < MIN_SIZE_TO_TOUCH) {
        skippedSmall++;
        continue;
      }

      try {
        const resized = await sharp(parsed.buffer)
          .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' }) // achata transparência antes do JPEG
          .jpeg({ quality: QUALITY })
          .toBuffer();

        const newDataUrl = `data:image/jpeg;base64,${resized.toString('base64')}`;

        if (newDataUrl.length >= original.length) {
          skippedNoGain++;
          continue;
        }

        await client.query('UPDATE public.profiles SET avatar_url = $1 WHERE id = $2', [newDataUrl, row.id]);
        touched++;
        bytesBefore += original.length;
        bytesAfter += newDataUrl.length;
        console.log(`  [${row.name}] ${(original.length / 1024).toFixed(0)}KB -> ${(newDataUrl.length / 1024).toFixed(0)}KB`);
      } catch (err) {
        failed++;
        console.warn(`  [${row.name}] falhou ao reprocessar: ${err.message}`);
      }
    }

    console.log('\n--- Resumo ---');
    console.log(`Reduzidos: ${touched}`);
    console.log(`Já pequenos (ignorados): ${skippedSmall}`);
    console.log(`Sem ganho de tamanho (ignorados): ${skippedNoGain}`);
    console.log(`Falhas: ${failed}`);
    if (touched > 0) {
      console.log(`Total antes: ${(bytesBefore / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Total depois: ${(bytesAfter / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Economia: ${(100 - (bytesAfter / bytesBefore) * 100).toFixed(1)}%`);
    }
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('ERRO ao encolher avatares:', err);
  process.exit(1);
});
