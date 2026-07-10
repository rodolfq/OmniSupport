import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

const connectionString = 'postgres://postgres:3%24%295pbJ%5B8yi697_7ds%2BJk0@200.229.168.31:5432/postgres';

async function run() {
  console.log('🔄 Conectando ao banco de dados PostgreSQL:', '200.229.168.31');
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('✅ Conexão estabelecida com sucesso!');

    const schemaPath = path.join(process.cwd(), 'schema_postgres.sql');
    console.log('📖 Lendo esquema SQL de:', schemaPath);
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('🚀 Executando migração no banco de dados...');
    await client.query(sql);
    console.log('🎉 Migração concluída com sucesso! Tabelas, sequências e dados criados.');
  } catch (error) {
    console.error('❌ Erro durante a migração:', error);
  } finally {
    await client.end();
  }
}

run();
