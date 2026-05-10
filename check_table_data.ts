import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function checkData() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    console.log("\n--- Dados em 'companies' ---");
    const result = await client.query(`SELECT * FROM companies;`);
    console.table(result.rows);
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

checkData();
