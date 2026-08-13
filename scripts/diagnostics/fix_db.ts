import { Client } from 'pg';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function fixTable() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("Adicionando coluna 'view_all_company_tickets' na tabela 'profiles'...");
    await client.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS view_all_company_tickets BOOLEAN DEFAULT FALSE");
    console.log("Coluna adicionada com sucesso!");
    
  } catch (err) {
    console.error("Erro ao alterar tabela:", err);
  } finally {
    await client.end();
  }
}

fixTable();
