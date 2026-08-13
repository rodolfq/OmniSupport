import { Client } from 'pg';
// Adjust for potential module resolution issues if necessary, but this looks fine.
// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function checkFKs() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    // Query to get all foreign keys for the tickets table in the public schema
    const result = await client.query(`
      SELECT
        conname AS constraint_name,
        conrelid::regclass AS table_name,
        confrelid::regclass AS referenced_table_name,
        confkey AS referenced_columns
      FROM pg_constraint
      WHERE conrelid = 'public.tickets'::regclass
      AND contype = 'f';
    `);
    
    console.log(JSON.stringify(result.rows, null, 2));

  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

checkFKs();
