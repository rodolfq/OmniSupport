import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL não definida no .env');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('✅ Conectado ao banco.');

    const sqlPath = path.join(process.cwd(), 'migrations', 'customer_evaluations_company_scope.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('🚀 Aplicando migrations/customer_evaluations_company_scope.sql...');
    await client.query(sql);
    console.log('🎉 Migração aplicada com sucesso.');

    const check = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'radar_sync'
       UNION ALL
       SELECT column_name FROM information_schema.columns WHERE table_name = 'customer_evaluations' AND column_name = 'company_id'
       UNION ALL
       SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'radar_sync'`
    );
    console.log('🔎 Verificação (deve ter 2 linhas, sem radar_sync em profiles):', check.rows);
  } catch (err) {
    console.error('❌ Erro ao aplicar migração:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
