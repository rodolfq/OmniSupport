import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

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
