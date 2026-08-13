import { Client } from 'pg';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function fixTicketRLS() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Criando política para 'tickets' ---");
    // Ensure enabled
    await client.query(`ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;`);
    
    // Drop existing if any, to avoid conflicts
    await client.query(`DROP POLICY IF EXISTS "Allow all for authenticated users" ON tickets;`);
    
    await client.query(`
      CREATE POLICY "Allow all for authenticated users" ON tickets
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
    `);
    console.log("Política 'tickets' criada com sucesso.");
  } catch (err) {
    console.error("Erro ao criar política:", err);
  } finally {
    await client.end();
  }
}

fixTicketRLS();
