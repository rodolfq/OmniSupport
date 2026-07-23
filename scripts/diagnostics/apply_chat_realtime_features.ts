// Aplica as migrations de leitura persistida, reações e histórico de edição/
// exclusão do Chat Interno e do chat com cliente contra o banco real.
import { Client } from 'pg';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const MIGRATIONS = [
  'migrations/internal_chat_realtime_features.sql',
  'migrations/chat_messages_realtime_features.sql',
];

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const file of MIGRATIONS) {
      const sql = fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');
      await client.query(sql);
      console.log(`✅ Aplicado: ${file}`);
    }
    console.log('\n🎉 CONCLUÍDO');
  } catch (err: any) {
    console.error('\n❌ FALHOU:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
