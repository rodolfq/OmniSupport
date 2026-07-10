import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

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
