import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

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
