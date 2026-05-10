import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function checkPrioritiesRLS() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Políticas RLS em 'config_priorities' ---");
    const result = await client.query(`
      SELECT policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE tablename = 'config_priorities';
    `);
    console.table(result.rows);
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

checkPrioritiesRLS();
