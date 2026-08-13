import { Client } from 'pg';

// Conexao vinha embutida aqui, com a senha do banco em texto puro num
// arquivo versionado. Agora sai do ambiente, como no resto do projeto.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Defina DATABASE_URL antes de rodar este script de diagnostico.');
  process.exit(1);
}

async function fixPrioritiesRLSExplicit() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Ajustando RLS explicita para 'config_priorities' ---");
    
    // Drop existing
    await client.query(`DROP POLICY IF EXISTS "Allow authenticated read/write" ON config_priorities;`);
    
    // Explicit policies to be safe
    await client.query(`CREATE POLICY "Allow select" ON config_priorities FOR SELECT TO authenticated USING (true);`);
    await client.query(`CREATE POLICY "Allow insert" ON config_priorities FOR INSERT TO authenticated WITH CHECK (true);`);
    await client.query(`CREATE POLICY "Allow update" ON config_priorities FOR UPDATE TO authenticated USING (true) WITH CHECK (true);`);
    await client.query(`CREATE POLICY "Allow delete" ON config_priorities FOR DELETE TO authenticated USING (true);`);
    
    console.log("Políticas RLS criadas com sucesso.");
  } catch (err) {
    console.error("Erro ao criar políticas:", err);
  } finally {
    await client.end();
  }
}

fixPrioritiesRLSExplicit();
