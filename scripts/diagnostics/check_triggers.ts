import { Client } from 'pg';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function checkTriggers() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Triggers na tabela 'auth.users' ---");
    const result = await client.query(`
      SELECT trigger_name, event_manipulation, action_statement 
      FROM information_schema.triggers 
      WHERE event_object_table = 'users' AND event_object_schema = 'auth';
    `);
    console.table(result.rows);
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

checkTriggers();
