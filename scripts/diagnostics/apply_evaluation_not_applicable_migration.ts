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

    const sqlPath = path.join(process.cwd(), 'migrations', 'customer_evaluations_not_applicable.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('🚀 Aplicando migrations/customer_evaluations_not_applicable.sql...');
    await client.query(sql);
    console.log('🎉 Migração aplicada com sucesso.');

    const check = await client.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'customer_evaluations'
         AND column_name IN ('knowledge_score','autonomy_score','learning_score','engagement_score','organization_score','communication_score')
       ORDER BY column_name`
    );
    console.log('🔎 Verificação (todas devem estar YES):', check.rows);
  } catch (err) {
    console.error('❌ Erro ao aplicar migração:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
