import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function checkFunction() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Definição da função 'handle_new_user' ---");
    const result = await client.query(`
      SELECT routine_definition 
      FROM information_schema.routines 
      WHERE routine_name = 'handle_new_user';
    `);
    console.log(result.rows[0]?.routine_definition);
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

checkFunction();
