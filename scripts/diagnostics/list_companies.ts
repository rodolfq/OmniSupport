import { Client } from 'pg';

const connectionString = 'postgresql://postgres:gLhm2cGBAKWGvQ*@db.edrixccffpbinvfieoyg.supabase.co:5432/postgres';

async function listCompanies() {
  const client = new Client({ connectionString });
  
  try {
    await client.connect();
    
    const result = await client.query("SELECT id, name FROM companies");
    console.table(result.rows);
    
  } catch (err) {
    console.error("Erro na inspeção:", err);
  } finally {
    await client.end();
  }
}

listCompanies();
