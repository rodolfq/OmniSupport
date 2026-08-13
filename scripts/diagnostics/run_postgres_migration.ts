import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

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
