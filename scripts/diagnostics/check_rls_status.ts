import { Client } from 'pg';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function checkRLSStatus() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Status RLS em 'companies' ---");
    const result = await client.query(`
      SELECT relname, relrowsecurity
      FROM pg_class
      JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
      WHERE relname = 'companies' AND nspname = 'public';
    `);
    console.table(result.rows);
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

checkRLSStatus();
