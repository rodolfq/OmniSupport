import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function checkData() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Estrutura da tabela 'users' ---");
    const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public';
    `);
    console.table(result.rows);
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

checkData();
