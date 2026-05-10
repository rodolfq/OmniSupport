import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function getRPC() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Definicao da RPC 'create_user_account' ---");
    const result = await client.query(`
      SELECT routine_definition 
      FROM information_schema.routines 
      WHERE routine_name = 'create_user_account';
    `);
    console.log(result.rows[0]?.routine_definition);
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

getRPC();
